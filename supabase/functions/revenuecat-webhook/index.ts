// Altiro Pro subscriptions -- a Supabase Edge Function that RevenueCat calls.
//
// RevenueCat runs the App Store and Google Play subscriptions; whenever one starts, renews, changes,
// is cancelled or runs out, it POSTs an event here (RevenueCat -> Project -> Integrations -> Webhooks,
// with this function's URL and an Authorization header value of your choosing). This keeps the
// user's row in `subscriptions` up to date, which is how Pro reaches the website too (the store apps
// also ask RevenueCat directly). See docs/pro-setup.md.
//
// The app signs users in to RevenueCat with their Supabase user id, so an event's app_user_id is that
// id. A cancelled subscription still has Pro until it runs out, so the row keeps its expiry date and
// the app compares that with the time.
//
// Secrets: REVENUECAT_WEBHOOK_AUTH -- the exact Authorization value set in RevenueCat (for example
// "Bearer <a long random string>"). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided
// automatically. Turn "Verify JWT" off for this function: RevenueCat sends its own header, not a
// Supabase token.

import { createClient } from "jsr:@supabase/supabase-js@2";

export type SubscriptionRow = {
  user_id: string;
  revenuecat_app_user_id: string;
  entitlement: string;
  status: "active" | "cancelled" | "expired" | "billing_issue";
  product_id: string | null;
  store: string | null;
  expires_at: string | null;
  updated_at: string;
};
export type Db = {
  /** The row as it is now (to ignore an older event arriving late). */
  current(userId: string): Promise<{ updated_at: string | null; status: string | null } | null>;
  save(row: SubscriptionRow): Promise<void>;
};
export type Deps = { db: Db; auth: string | undefined; now?: () => number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// What each event means for Pro.
const STATUS: Record<string, SubscriptionRow["status"]> = {
  INITIAL_PURCHASE: "active",
  RENEWAL: "active",
  PRODUCT_CHANGE: "active",
  UNCANCELLATION: "active",
  NON_RENEWING_PURCHASE: "active",
  SUBSCRIPTION_EXTENDED: "active",
  TEMPORARY_ENTITLEMENT_GRANT: "active",
  CANCELLATION: "cancelled",
  BILLING_ISSUE: "billing_issue",
  EXPIRATION: "expired",
};
const STORES: Record<string, string> = { APP_STORE: "app_store", MAC_APP_STORE: "app_store", PLAY_STORE: "play_store", STRIPE: "stripe" };

function json(body: unknown, status = 200) {
  console.log(JSON.stringify({ status, ...(body as Record<string, unknown>) }));
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function makeHandler(deps: Deps) {
  const now = deps.now || (() => Date.now());
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    // Only RevenueCat knows the header; without the secret set, nothing is accepted.
    if (!deps.auth || req.headers.get("Authorization") !== deps.auth) return json({ error: "unauthorized" }, 401);
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    const ev = (body.event || {}) as Record<string, unknown>;
    const type = String(ev.type || "");
    if (type === "TEST") return json({ ok: true, test: true });
    const status = STATUS[type];
    if (!status) return json({ ok: true, ignored: type || "no_type" }); // (TRANSFER, SUBSCRIPTION_PAUSED, ...)
    // The Supabase user: app_user_id, or one of its aliases (a purchase made before signing in).
    const ids = [ev.app_user_id, ev.original_app_user_id, ...((ev.aliases as unknown[]) || [])].map(String);
    const userId = ids.find((id) => UUID.test(id));
    if (!userId) return json({ ok: true, ignored: "no_altiro_user" });
    const ents = (ev.entitlement_ids as string[]) || (ev.entitlement_id ? [String(ev.entitlement_id)] : []);
    if (ents.length && !ents.includes("pro")) return json({ ok: true, ignored: "not_pro" });
    const at = Number(ev.event_timestamp_ms) || now();
    const exp = Number(ev.expiration_at_ms);
    const row: SubscriptionRow = {
      user_id: userId,
      revenuecat_app_user_id: String(ev.app_user_id || userId),
      entitlement: "pro",
      status,
      product_id: ev.product_id ? String(ev.product_id) : null,
      store: STORES[String(ev.store || "")] || (ev.store ? String(ev.store).toLowerCase() : null),
      expires_at: exp ? new Date(exp).toISOString() : null,
      updated_at: new Date(at).toISOString(),
    };
    try {
      const cur = await deps.db.current(userId);
      // A lifetime grant (given by hand, see docs/pro-setup.md) is never replaced by a store event.
      if (cur && cur.status === "lifetime") return json({ ok: true, ignored: "lifetime" });
      // Events can arrive out of order: an older one doesn't undo a newer one.
      if (cur && cur.updated_at && Date.parse(cur.updated_at) > at) return json({ ok: true, ignored: "older_event" });
      await deps.db.save(row);
      return json({ ok: true, user_id: userId, subscription: status, expires_at: row.expires_at });
    } catch (e) {
      // RevenueCat retries a failed delivery.
      return json({ error: "save_failed", detail: String((e as Error).message || e) }, 500);
    }
  };
}

function supabaseDb(): Db {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  return {
    async current(userId) {
      const { data } = await admin.from("subscriptions").select("updated_at, status").eq("user_id", userId).maybeSingle();
      return data ?? null;
    },
    async save(row) {
      const { error } = await admin.from("subscriptions").upsert(row, { onConflict: "user_id" });
      if (error) throw error;
    },
  };
}

if (!Deno.env.get("ALTIRO_REVENUECAT_TEST")) {
  Deno.serve(makeHandler({ db: supabaseDb(), auth: Deno.env.get("REVENUECAT_WEBHOOK_AUTH") }));
}
