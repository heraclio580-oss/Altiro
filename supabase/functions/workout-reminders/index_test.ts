// Run with: ALTIRO_REMINDERS_TEST=1 deno test supabase/functions/workout-reminders/index_test.ts
// (tests/run-all.js runs it too when `deno` is installed.) The database and the push services are faked;
// each push is decrypted here the way a browser would (RFC 8291), and its VAPID signature checked, so the
// encryption is tested for real.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { b64url, dueReminders, localNow, makeHandler, unb64url, type Deps, type ReminderRow, type Subscription } from "./index.ts";

const enc = new TextEncoder();
const concat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

// A fake browser: its own push keys, and the receiving half of RFC 8291.
async function makeBrowser() {
  const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    p256dh: b64url(uaPublic),
    auth: b64url(auth),
    async decrypt(body: Uint8Array): Promise<string> {
      const salt = body.slice(0, 16);
      const idlen = body[20];
      const asPublic = body.slice(21, 21 + idlen);
      const cipher = body.slice(21 + idlen);
      const asKey = await crypto.subtle.importKey("raw", asPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, keys.privateKey, 256));
      const ikm = await hmac(await hmac(auth, ecdh), concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
      const prk = await hmac(salt, ikm);
      const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
      const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
      const aes = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["decrypt"]);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aes, cipher as BufferSource));
      assertEquals(plain[plain.length - 1], 2, "last-record delimiter");
      return new TextDecoder().decode(plain.slice(0, -1));
    },
  };
}

async function vapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { privateKey: jwk.d!, publicKey: b64url(pub), verifyKey: kp.publicKey };
}

// 2026-10-01 11:05 UTC = 7:05 AM in New York (EDT), 4:05 AM in Los Angeles, 1:05 PM in Madrid.
const NOW = Date.parse("2026-10-01T11:05:00Z");
const SCHEDULE = {
  "2026-10-01": { title: "Today: Leg Day", body: "45 min" },
  "2026-10-02": { title: "Today: Easy Run", body: "3 mi" },
};

Deno.test("local time in a user's own time zone", () => {
  assertEquals(localNow(NOW, "America/New_York"), { date: "2026-10-01", minutes: 7 * 60 + 5 });
  assertEquals(localNow(NOW, "America/Los_Angeles"), { date: "2026-10-01", minutes: 4 * 60 + 5 });
  assertEquals(localNow(Date.parse("2026-10-02T02:30:00Z"), "America/New_York").date, "2026-10-01");
});

Deno.test("who is due: reminder time reached today, a workout today, not reminded yet", () => {
  const row = (o: Partial<ReminderRow>): ReminderRow => ({ user_id: "u", enabled: true, remind_at: "07:00", time_zone: "America/New_York", schedule: SCHEDULE, last_sent_on: null, ...o });
  const ids = (rows: ReminderRow[]) => dueReminders(rows, NOW).map((d) => d.userId);
  assertEquals(dueReminders([row({})], NOW), [{ userId: "u", date: "2026-10-01", title: "Today: Leg Day", body: "45 min" }]);
  assertEquals(ids([row({ remind_at: "07:30" })]), [], "not yet 7:30");
  assertEquals(ids([row({ time_zone: "America/Los_Angeles" })]), [], "4 AM there");
  assertEquals(ids([row({ remind_at: "03:00" })]), [], "more than 3 hours late: skip rather than send");
  assertEquals(ids([row({ last_sent_on: "2026-10-01" })]), [], "already reminded today");
  assertEquals(ids([row({ last_sent_on: "2026-09-30" })]), ["u"], "yesterday's doesn't count");
  assertEquals(ids([row({ schedule: { "2026-10-02": SCHEDULE["2026-10-02"] } })]), [], "rest day today");
  assertEquals(ids([row({ enabled: false })]), []);
  assertEquals(ids([row({ time_zone: "Not/AZone", remind_at: "11:00" })]), ["u"], "a bad time zone falls back to UTC");
});

function setup(rows: ReminderRow[], subs: Subscription[], statusFor: (endpoint: string) => number = () => 201) {
  const sentOn: Record<string, string> = {};
  const deleted: string[] = [];
  const pushes: { endpoint: string; headers: Headers; body: Uint8Array }[] = [];
  return {
    sentOn, deleted, pushes,
    deps: (keys: { privateKey: string; publicKey: string }): Deps => ({
      now: () => NOW,
      env: (n) => ({ REMINDERS_CRON_SECRET: "cron-secret", VAPID_PRIVATE_KEY: keys.privateKey, VAPID_PUBLIC_KEY: keys.publicKey } as Record<string, string>)[n],
      fetch: async (input, init) => {
        pushes.push({ endpoint: String(input), headers: new Headers(init.headers), body: init.body as Uint8Array });
        return new Response("", { status: statusFor(String(input)) });
      },
      db: {
        enabledReminders: async () => rows.filter((r) => r.enabled),
        subscriptionsFor: async (ids) => subs.filter((s) => ids.includes(s.user_id)),
        markSent: async (u, d) => { sentOn[u] = d; },
        deleteSubscription: async (id) => { deleted.push(id); },
      },
    }),
  };
}
const call = (handler: (r: Request) => Promise<Response>, secret = "cron-secret") =>
  handler(new Request("https://x/functions/v1/workout-reminders", { method: "POST", headers: { "x-cron-secret": secret } }));

Deno.test("only the cron job can run it", async () => {
  const keys = await vapidKeys();
  const t = setup([], []);
  assertEquals((await call(makeHandler(t.deps(keys)), "wrong")).status, 403);
  assertEquals((await call(makeHandler(t.deps(keys)))).status, 200);
});

Deno.test("sends an encrypted, signed reminder to each of the user's devices", async () => {
  const keys = await vapidKeys();
  const phone = await makeBrowser(), laptop = await makeBrowser(), other = await makeBrowser();
  const t = setup(
    [
      { user_id: "sam", enabled: true, remind_at: "07:00", time_zone: "America/New_York", schedule: SCHEDULE, last_sent_on: null },
      { user_id: "lee", enabled: true, remind_at: "07:00", time_zone: "America/Los_Angeles", schedule: SCHEDULE, last_sent_on: null },
    ],
    [
      { id: "s1", user_id: "sam", endpoint: "https://fcm.googleapis.com/fcm/send/abc", ...phone },
      { id: "s2", user_id: "sam", endpoint: "https://updates.push.services.mozilla.com/wpush/v2/def", ...laptop },
      { id: "s3", user_id: "lee", endpoint: "https://web.push.apple.com/ghi", ...other },
    ],
  );
  const res = await (await call(makeHandler(t.deps(keys)))).json();
  assertEquals(res, { due: 1, sent: 2, removed: 0, failed: 0 });
  assertEquals(t.pushes.map((p) => p.endpoint), ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/def"]);
  assertEquals(t.sentOn, { sam: "2026-10-01" }, "Lee (4 AM in LA) isn't due yet");

  const msg = JSON.parse(await phone.decrypt(t.pushes[0].body));
  assertEquals(msg, { title: "Today: Leg Day", body: "45 min", tag: "altiro-2026-10-01", url: "./" });
  assertEquals(JSON.parse(await laptop.decrypt(t.pushes[1].body)).title, "Today: Leg Day");

  const h = t.pushes[0].headers;
  assertEquals(h.get("content-encoding"), "aes128gcm");
  assertEquals(h.get("ttl"), "21600");
  const [, token, k] = h.get("authorization")!.match(/^vapid t=([^,]+), k=(.+)$/)!;
  assertEquals(k, keys.publicKey);
  const [head, claims, sig] = token.split(".");
  const c = JSON.parse(new TextDecoder().decode(unb64url(claims)));
  assertEquals(c.aud, "https://fcm.googleapis.com");
  assertEquals(c.sub, "mailto:altiro580@gmail.com");
  assert(c.exp > NOW / 1000 && c.exp <= NOW / 1000 + 24 * 3600);
  assert(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.verifyKey, unb64url(sig) as BufferSource, enc.encode(`${head}.${claims}`)), "VAPID signature");
  assertEquals(JSON.parse(new TextDecoder().decode(unb64url(t.pushes[1].headers.get("authorization")!.match(/t=[^.]+\.([^.]+)\./)![1]))).aud, "https://updates.push.services.mozilla.com");
});

Deno.test("a device that has gone away is removed; nobody is reminded twice", async () => {
  const keys = await vapidKeys();
  const gone = await makeBrowser(), ok = await makeBrowser();
  const rows: ReminderRow[] = [{ user_id: "sam", enabled: true, remind_at: "07:00", time_zone: "America/New_York", schedule: SCHEDULE, last_sent_on: null }];
  const t = setup(rows, [
    { id: "old", user_id: "sam", endpoint: "https://fcm.googleapis.com/fcm/send/old", ...gone },
    { id: "new", user_id: "sam", endpoint: "https://fcm.googleapis.com/fcm/send/new", ...ok },
  ], (e) => e.endsWith("/old") ? 410 : 201);
  const res = await (await call(makeHandler(t.deps(keys)))).json();
  assertEquals(res, { due: 1, sent: 1, removed: 1, failed: 0 });
  assertEquals(t.deleted, ["old"]);
  rows[0].last_sent_on = t.sentOn.sam;
  const again = await (await call(makeHandler(t.deps(keys)))).json();
  assertEquals(again, { due: 0, sent: 0 });
});
