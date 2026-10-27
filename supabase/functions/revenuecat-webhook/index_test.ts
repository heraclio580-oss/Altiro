// Run with: ALTIRO_REVENUECAT_TEST=1 deno test supabase/functions/revenuecat-webhook/index_test.ts
// (tests/run-all.js runs it too when `deno` is installed.) The database is faked.
import { assertEquals } from "jsr:@std/assert@1";
import { makeHandler, type Deps, type SubscriptionRow } from "./index.ts";

const USER = "0b3f2a9e-5c1d-4e7a-9b2f-1a2b3c4d5e6f";
const AUTH = "Bearer test-secret";

function setup(existing: { updated_at: string | null; status: string | null } | null = null) {
  const saved: SubscriptionRow[] = [];
  let cur = existing;
  const deps: Deps = {
    auth: AUTH,
    db: {
      current: async () => cur,
      save: async (row) => { saved.push(row); cur = { updated_at: row.updated_at, status: row.status }; },
    },
  };
  const call = (event: Record<string, unknown>, headers: Record<string, string> = { Authorization: AUTH }) =>
    makeHandler(deps)(new Request("https://x/functions/v1/revenuecat-webhook", { method: "POST", headers, body: JSON.stringify({ api_version: "1.0", event }) }));
  return { saved, call };
}
const ev = (type: string, extra: Record<string, unknown> = {}) => ({
  type, app_user_id: USER, product_id: "altiro_pro_yearly", store: "PLAY_STORE", entitlement_ids: ["pro"],
  event_timestamp_ms: Date.parse("2026-11-01T10:00:00Z"), expiration_at_ms: Date.parse("2027-11-01T10:00:00Z"), ...extra,
});

Deno.test("a purchase gives Pro until it runs out", async () => {
  const t = setup();
  const res = await t.call(ev("INITIAL_PURCHASE"));
  assertEquals(res.status, 200);
  assertEquals(t.saved.length, 1);
  assertEquals(t.saved[0].user_id, USER);
  assertEquals(t.saved[0].status, "active");
  assertEquals(t.saved[0].store, "play_store");
  assertEquals(t.saved[0].product_id, "altiro_pro_yearly");
  assertEquals(t.saved[0].expires_at, "2027-11-01T10:00:00.000Z");
});

Deno.test("a cancellation keeps the expiry (Pro until then); an expiration ends it", async () => {
  const t = setup();
  await t.call(ev("CANCELLATION", { event_timestamp_ms: Date.parse("2026-12-01T00:00:00Z") }));
  assertEquals(t.saved[0].status, "cancelled");
  assertEquals(t.saved[0].expires_at, "2027-11-01T10:00:00.000Z");
  await t.call(ev("EXPIRATION", { event_timestamp_ms: Date.parse("2027-11-01T10:00:01Z") }));
  assertEquals(t.saved[1].status, "expired");
});

Deno.test("an older event arriving late doesn't undo a newer one", async () => {
  const t = setup({ updated_at: "2027-01-01T00:00:00Z", status: "expired" });
  const res = await t.call(ev("RENEWAL"));
  assertEquals((await res.json()).ignored, "older_event");
  assertEquals(t.saved.length, 0);
});

Deno.test("a lifetime grant is never replaced", async () => {
  const t = setup({ updated_at: null, status: "lifetime" });
  await t.call(ev("EXPIRATION"));
  assertEquals(t.saved.length, 0);
});

Deno.test("without RevenueCat's header (or with no secret set), nothing is saved", async () => {
  const t = setup();
  assertEquals((await t.call(ev("INITIAL_PURCHASE"), { Authorization: "Bearer wrong" })).status, 401);
  assertEquals((await t.call(ev("INITIAL_PURCHASE"), {})).status, 401);
  const noSecret = makeHandler({ auth: undefined, db: { current: async () => null, save: async () => { throw new Error("no"); } } });
  assertEquals((await noSecret(new Request("https://x", { method: "POST", headers: { Authorization: "" }, body: "{}" }))).status, 401);
  assertEquals(t.saved.length, 0);
});

Deno.test("RevenueCat's test event, other event types and anonymous buyers are fine but change nothing", async () => {
  const t = setup();
  assertEquals((await (await t.call({ type: "TEST" })).json()).test, true);
  assertEquals((await (await t.call(ev("TRANSFER"))).json()).ignored, "TRANSFER");
  assertEquals((await (await t.call(ev("INITIAL_PURCHASE", { app_user_id: "$RCAnonymousID:abc", aliases: [] }))).json()).ignored, "no_altiro_user");
  assertEquals((await (await t.call(ev("INITIAL_PURCHASE", { entitlement_ids: ["other"] }))).json()).ignored, "not_pro");
  assertEquals(t.saved.length, 0);
});

Deno.test("a purchase made before signing in is matched through its aliases", async () => {
  const t = setup();
  await t.call(ev("INITIAL_PURCHASE", { app_user_id: "$RCAnonymousID:abc", aliases: ["$RCAnonymousID:abc", USER] }));
  assertEquals(t.saved[0].user_id, USER);
});
