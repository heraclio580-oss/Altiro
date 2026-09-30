// Workout reminders for Altiro -- a Supabase Edge Function, run every 15 minutes by pg_cron.
//
// The plan is worked out in the app, not on the server, so the app saves what's coming up -- the next
// few weeks of workouts, already worded in the user's language -- to reminder_settings.schedule
// ({"2026-10-01": {"title": "Today: Leg Day", "body": "45 min"}}), along with their reminder time and
// time zone. Each run, this function finds everyone whose reminder time has come today (in their own
// time zone), who has a workout today and hasn't been reminded yet, and sends a push notification to
// each of their devices (push_subscriptions). Rest days and days already done aren't in the schedule,
// so they never get a reminder. A device that has gone away (its browser answers 404/410) is removed.
//
// Web push is done here directly with WebCrypto -- VAPID (RFC 8292) to identify the sender, and
// aes128gcm (RFC 8291) to encrypt the message -- so there's no Node library to break in Deno.
//
// Called only by the cron job, with an x-cron-secret header. "Verify JWT" must be OFF for this function
// (Edge Functions -> workout-reminders -> Settings); the secret is the check instead.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets): VAPID_PRIVATE_KEY, REMINDERS_CRON_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, and also in www/index.html -- the browser subscribes with it, so it must match the private key.
export const VAPID_PUBLIC_KEY = "BJkJAEMuNRrW_XdlrdwO0NrPp-XkztJMZLQkD9ldgMniGd5boxzkhRQaoxqGkGKSBbhWxBtcwwnqp7n_9vcW4h0";
const VAPID_SUBJECT = "mailto:altiro580@gmail.com";
// A reminder that's late (the job was down, or the phone was off) still goes out for a few hours, but
// never lands in the middle of the night.
const LATE_WINDOW_MIN = 180;

export type ReminderRow = {
  user_id: string;
  enabled: boolean;
  remind_at: string | null; // "07:00"
  time_zone: string | null; // "America/New_York"
  schedule: Record<string, { title: string; body?: string }> | null;
  last_sent_on: string | null; // "2026-10-01", in the user's own time zone
};
export type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

export type Db = {
  enabledReminders(): Promise<ReminderRow[]>;
  subscriptionsFor(userIds: string[]): Promise<Subscription[]>;
  markSent(userId: string, localDate: string): Promise<void>;
  deleteSubscription(id: string): Promise<void>;
};
export type Deps = {
  db: Db;
  env(name: string): string | undefined;
  fetch(input: string, init: RequestInit): Promise<Response>;
  now(): number;
};

// ---------------- who is due ----------------

// The date ("2026-10-01") and minutes past midnight right now in a time zone.
export function localNow(nowMs: number, timeZone: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function dueReminders(rows: ReminderRow[], nowMs: number) {
  const due: { userId: string; date: string; title: string; body: string }[] = [];
  for (const r of rows) {
    if (!r.enabled || !r.schedule) continue;
    let local;
    try { local = localNow(nowMs, r.time_zone || "UTC"); } catch { local = localNow(nowMs, "UTC"); }
    const [h, m] = String(r.remind_at || "07:00").split(":").map(Number);
    const at = (h || 0) * 60 + (m || 0);
    if (local.minutes < at || local.minutes >= at + LATE_WINDOW_MIN) continue;
    if (r.last_sent_on === local.date) continue;
    const today = r.schedule[local.date];
    if (!today || !today.title) continue;
    due.push({ userId: r.user_id, date: local.date, title: today.title, body: today.body || "" });
  }
  return due;
}

// ---------------- web push ----------------

const enc = new TextEncoder();
export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

// A signed VAPID token ("vapid t=..., k=...") for the push service that owns `endpoint`.
export async function vapidAuthorization(endpoint: string, privateKeyB64: string, publicKeyB64: string, nowMs: number) {
  const pub = unb64url(publicKeyB64);
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", d: privateKeyB64, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: VAPID_SUBJECT,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${publicKeyB64}`;
}

// Encrypts `payload` for one browser (its p256dh key and auth secret), as an aes128gcm body.
export async function encryptPayload(payload: string, p256dhB64: string, authB64: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPublic = unb64url(p256dhB64);
  const authSecret = unb64url(authB64);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  // RFC 8291 section 3.4: combine the shared secret with the browser's auth secret...
  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  // ...then RFC 8188: the content key and nonce for this salt.
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 2 = the last (only) record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aes, plain as BufferSource));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

async function sendPush(deps: Deps, sub: Subscription, message: Record<string, string>, privateKey: string, publicKey: string) {
  const body = await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth);
  return deps.fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, privateKey, publicKey, deps.now()),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(6 * 3600), // not delivered within 6 hours (phone off all day): drop it
      Urgency: "normal",
    },
    body: body as BodyInit,
  });
}

// ---------------- the job ----------------

export function makeHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const secret = deps.env("REMINDERS_CRON_SECRET");
    if (!secret || req.headers.get("x-cron-secret") !== secret) return Response.json({ error: "forbidden" }, { status: 403 });
    const privateKey = deps.env("VAPID_PRIVATE_KEY");
    if (!privateKey) return Response.json({ error: "not_configured" }, { status: 500 });
    const publicKey = deps.env("VAPID_PUBLIC_KEY") || VAPID_PUBLIC_KEY;

    const due = dueReminders(await deps.db.enabledReminders(), deps.now());
    if (!due.length) return Response.json({ due: 0, sent: 0 });
    const subs = await deps.db.subscriptionsFor(due.map((d) => d.userId));
    let sent = 0, removed = 0, failed = 0;
    for (const d of due) {
      for (const sub of subs.filter((s) => s.user_id === d.userId)) {
        try {
          const res = await sendPush(deps, sub, { title: d.title, body: d.body, tag: `altiro-${d.date}`, url: "./" }, privateKey, publicKey);
          if (res.ok) sent++;
          else if (res.status === 404 || res.status === 410) { await deps.db.deleteSubscription(sub.id); removed++; }
          else { failed++; console.log(JSON.stringify({ push_failed: res.status, text: (await res.text()).slice(0, 200) })); }
        } catch (e) {
          failed++;
          console.log(JSON.stringify({ push_error: String((e as Error).message || e) }));
        }
      }
      // Marked either way, so a device that keeps failing doesn't get retried every 15 minutes all morning.
      await deps.db.markSent(d.userId, d.date);
    }
    return Response.json({ due: due.length, sent, removed, failed });
  };
}

function supabaseDb(): Db {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const check = ({ error }: { error: unknown }) => { if (error) throw error; };
  return {
    async enabledReminders() {
      const { data, error } = await admin.from("reminder_settings").select("*").eq("enabled", true);
      if (error) throw error;
      return data || [];
    },
    async subscriptionsFor(userIds) {
      const { data, error } = await admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", userIds);
      if (error) throw error;
      return data || [];
    },
    async markSent(userId, localDate) {
      check(await admin.from("reminder_settings").update({ last_sent_on: localDate }).eq("user_id", userId));
    },
    async deleteSubscription(id) {
      check(await admin.from("push_subscriptions").delete().eq("id", id));
    },
  };
}

if (!Deno.env.get("ALTIRO_REMINDERS_TEST")) {
  Deno.serve(makeHandler({
    db: supabaseDb(),
    env: (name) => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
  }));
}
