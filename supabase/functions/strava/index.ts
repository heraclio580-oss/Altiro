// Strava connection for Altiro -- a Supabase Edge Function.
//
// Why this runs server-side at all: exchanging Strava's sign-in code for tokens (and refreshing them
// later) needs the Strava app's client SECRET, which must never ship inside the web app. The browser
// only ever calls this function (as the signed-in user); tokens live in strava_connections, which has
// no RLS policies, so only this function (service role) can read them.
//
// This function only COLLECTS runs: `sync` pulls recent runs from Strava into strava_activities. The
// app itself then files each new one onto the right day (matching it to that day's planned run),
// using the same logging code as everything else -- see importStravaActivities() in www/index.html.
//
// Actions (POST JSON body {action, ...}, called with the user's Supabase session):
//   authorize_url {redirect_uri}  -> {url}   Strava's "Authorize Altiro" page for this app
//   connect {code, scope}         -> {connected, athlete_name}   finish sign-in, then sync
//   sync                          -> {connected, athlete_name, fetched}
//   disconnect                    -> {connected:false}
//
// "Verify JWT" (Edge Functions -> strava -> Settings) can be on or off. The app sends the user's token in
// an x-altiro-user header and the project's anon key in Authorization -- see invokeFunction() in
// www/index.html -- because Supabase's built-in gateway check rejects user tokens signed with the newer
// JWT signing keys (a 401 before the function even runs) but accepts the anon key. The function checks
// the user's token itself, through Supabase Auth, which understands every key.
//
// Strava also tells Altiro about new runs as they arrive (its webhook), so they're waiting in
// strava_activities before the app is even opened -- see handleWebhook() below:
//   GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...  Strava checking this URL
//   POST {object_type, aspect_type, object_id, owner_id, ...}         an activity was created/changed/deleted
//   GET  ?setup=webhook&key=<STRAVA_WEBHOOK_TOKEN>                    one-time: subscribe Altiro to the webhook
// For those, "Verify JWT" must be OFF for this function (Strava sends no Supabase token).
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets): STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, and
// STRAVA_WEBHOOK_TOKEN (any long random string; it proves a webhook request came from our own setup).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "jsr:@supabase/supabase-js@2";

const STRAVA = "https://www.strava.com";
const RUN_TYPES = ["Run", "TrailRun", "VirtualRun"];
const DAY_SEC = 24 * 60 * 60;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-altiro-user",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Connection = {
  user_id: string;
  athlete_id: number;
  athlete_name: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
  last_synced_at: string | null;
};

export type Db = {
  userIdFromJwt(jwt: string): Promise<string | null>;
  getConnection(userId: string): Promise<Connection | null>;
  getConnectionByAthlete(athleteId: number): Promise<Connection | null>;
  saveConnection(row: Partial<Connection> & { user_id: string }): Promise<void>;
  deleteConnection(userId: string): Promise<void>;
  // Inserts only activities not already stored, so a run the app has already filed (applied_at set)
  // is never reset to "new" and imported twice.
  insertNewActivities(rows: Record<string, unknown>[]): Promise<void>;
  deleteUnappliedActivities(userId: string): Promise<void>;
  deleteUnappliedActivity(activityId: number): Promise<void>;
};

export type Deps = {
  db: Db;
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  now: () => number; // ms
  // Runs work after the response has been sent (Strava wants its webhook answered within 2 seconds).
  waitUntil?: (p: Promise<unknown>) => void;
};

function json(body: unknown, status = 200) {
  // Every outcome is also written to the function's Logs, so a failed connection has an answer there.
  console.log(JSON.stringify({ status, ...(body as Record<string, unknown>) }));
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function stravaToken(deps: Deps, params: Record<string, string>) {
  const res = await deps.fetch(`${STRAVA}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: deps.env("STRAVA_CLIENT_ID"),
      client_secret: deps.env("STRAVA_CLIENT_SECRET"),
      ...params,
    }),
  });
  if (!res.ok) throw new Error(`strava_token_${res.status}`);
  return await res.json();
}

// A connection's access token only lasts ~6 hours -- swap it for a fresh one shortly before it expires.
async function freshConnection(deps: Deps, conn: Connection): Promise<Connection> {
  if (new Date(conn.expires_at).getTime() - deps.now() > 60_000) return conn;
  const t = await stravaToken(deps, { grant_type: "refresh_token", refresh_token: conn.refresh_token });
  const updated = {
    ...conn,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(t.expires_at * 1000).toISOString(),
  };
  await deps.db.saveConnection(updated);
  return updated;
}

// deno-lint-ignore no-explicit-any
const isRun = (a: any) => RUN_TYPES.includes(a.sport_type || a.type);
// deno-lint-ignore no-explicit-any
function runRow(a: any, userId: string) {
  return {
    id: a.id,
    user_id: userId,
    name: a.name,
    sport_type: a.sport_type || a.type,
    start_date: a.start_date,
    // Strava's start_date_local is the wall-clock time where the run happened (it's labelled "Z"
    // but isn't UTC) -- its date part is the calendar day the run belongs on.
    local_date: String(a.start_date_local).slice(0, 10),
    distance_m: a.distance,
    moving_time_s: a.moving_time,
    elapsed_time_s: a.elapsed_time,
  };
}

// ---------------- Strava's webhook: new runs arrive on their own ----------------
// deno-lint-ignore no-explicit-any
async function handleWebhookEvent(deps: Deps, ev: any) {
  const conn0 = ev.owner_id ? await deps.db.getConnectionByAthlete(Number(ev.owner_id)) : null;
  if (!conn0) return { handled: false, reason: "unknown_athlete" };
  // The athlete removed Altiro from their Strava settings.
  if (ev.object_type === "athlete") {
    if (ev.updates && String(ev.updates.authorized) === "false") {
      await deps.db.deleteConnection(conn0.user_id);
      await deps.db.deleteUnappliedActivities(conn0.user_id);
      return { handled: true, deauthorized: true };
    }
    return { handled: false };
  }
  if (ev.object_type !== "activity") return { handled: false };
  if (ev.aspect_type === "delete") {
    await deps.db.deleteUnappliedActivity(Number(ev.object_id));
    return { handled: true, deleted: ev.object_id };
  }
  // create, or an update (a run's type or privacy can change after upload): fetch it and keep it if it's a run.
  let conn: Connection;
  try { conn = await freshConnection(deps, conn0); } catch { return { handled: false, reason: "token" }; }
  const res = await deps.fetch(`${STRAVA}/api/v3/activities/${encodeURIComponent(String(ev.object_id))}`, {
    headers: { Authorization: `Bearer ${conn.access_token}` },
  });
  if (!res.ok) return { handled: false, reason: `strava_activity_${res.status}` };
  const a = await res.json();
  if (!isRun(a)) return { handled: true, run: false };
  await deps.db.insertNewActivities([runRow(a, conn.user_id)]);
  return { handled: true, run: true, id: a.id };
}
// One-time setup, from a browser: subscribes Altiro to Strava's webhook with this function as the address.
async function subscribeWebhook(deps: Deps) {
  const callback = `${String(deps.env("SUPABASE_URL") || "").replace(/\/$/, "")}/functions/v1/strava`;
  const form = new URLSearchParams({
    client_id: deps.env("STRAVA_CLIENT_ID")!,
    client_secret: deps.env("STRAVA_CLIENT_SECRET")!,
    callback_url: callback,
    verify_token: deps.env("STRAVA_WEBHOOK_TOKEN")!,
  });
  const res = await deps.fetch(`${STRAVA}/api/v3/push_subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await res.text();
  if (res.ok) return json({ subscribed: true, callback, strava: JSON.parse(text || "{}") });
  // Only one subscription per Strava app: if there already is one, show it.
  const list = await deps.fetch(`${STRAVA}/api/v3/push_subscriptions?client_id=${encodeURIComponent(deps.env("STRAVA_CLIENT_ID")!)}&client_secret=${encodeURIComponent(deps.env("STRAVA_CLIENT_SECRET")!)}`);
  const existing = list.ok ? await list.json() : null;
  return json({ subscribed: Array.isArray(existing) && existing.length > 0, callback, existing, strava_error: text.slice(0, 300) }, Array.isArray(existing) && existing.length ? 200 : 502);
}

// Pulls recent runs into strava_activities. Looks back a week on every sync (a run can reach Strava
// hours after it happened, once the watch syncs), or further if the app hasn't synced in longer than
// that -- capped at 60 days.
async function syncRuns(deps: Deps, userId: string) {
  const stored = await deps.db.getConnection(userId);
  if (!stored) return { connected: false };
  let conn: Connection;
  try {
    conn = await freshConnection(deps, stored);
  } catch (e) {
    // A refresh the user revoked from Strava's own settings fails with 400/401 -- the connection is gone.
    if (String(e).includes("strava_token_4")) {
      await deps.db.deleteConnection(userId);
      return { connected: false };
    }
    throw e;
  }
  const nowSec = Math.floor(deps.now() / 1000);
  const lastSec = conn.last_synced_at ? Math.floor(new Date(conn.last_synced_at).getTime() / 1000) : nowSec;
  const after = Math.max(nowSec - 60 * DAY_SEC, Math.min(nowSec - 7 * DAY_SEC, lastSec - 2 * DAY_SEC));

  const res = await deps.fetch(`${STRAVA}/api/v3/athlete/activities?after=${after}&per_page=100`, {
    headers: { Authorization: `Bearer ${conn.access_token}` },
  });
  if (res.status === 401) {
    await deps.db.deleteConnection(userId);
    return { connected: false };
  }
  if (!res.ok) throw new Error(`strava_activities_${res.status}`);
  const activities = await res.json();
  const runs = (Array.isArray(activities) ? activities : [])
    .filter(isRun)
    .map((a) => runRow(a, userId));
  if (runs.length) await deps.db.insertNewActivities(runs);
  await deps.db.saveConnection({ ...conn, last_synced_at: new Date(deps.now()).toISOString() });
  return { connected: true, athlete_name: conn.athlete_name, fetched: runs.length };
}

export function makeHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (!deps.env("STRAVA_CLIENT_ID") || !deps.env("STRAVA_CLIENT_SECRET")) {
      return json({ error: "not_configured" }, 500);
    }
    const url = new URL(req.url);
    const hookToken = deps.env("STRAVA_WEBHOOK_TOKEN");
    if (req.method === "GET") {
      // Strava checking the webhook address when it's subscribed.
      if (url.searchParams.get("hub.mode") === "subscribe") {
        if (!hookToken || url.searchParams.get("hub.verify_token") !== hookToken) return json({ error: "forbidden" }, 403);
        return new Response(JSON.stringify({ "hub.challenge": url.searchParams.get("hub.challenge") }), { headers: { "Content-Type": "application/json" } });
      }
      if (url.searchParams.get("setup") === "webhook") {
        if (!hookToken || url.searchParams.get("key") !== hookToken) return json({ error: "forbidden" }, 403);
        return await subscribeWebhook(deps);
      }
      return json({ error: "method_not_allowed" }, 405);
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    // A webhook event from Strava: answered right away, handled after.
    if (!req.headers.get("x-altiro-user")) {
      let peek: Record<string, unknown> | null = null;
      try { peek = await req.clone().json(); } catch { /* not JSON */ }
      if (peek && "object_type" in peek && "owner_id" in peek && "aspect_type" in peek) {
        const work = handleWebhookEvent(deps, peek)
          .then((r) => console.log(JSON.stringify({ webhook: peek, ...r })))
          .catch((e) => console.log(JSON.stringify({ webhook_error: String((e as Error).message || e) })));
        if (deps.waitUntil) deps.waitUntil(work); else await work;
        return json({ received: true });
      }
    }
    // The app sends the user's token in x-altiro-user (Authorization then carries the anon key, which gets
    // past Supabase's "Verify JWT" gateway whether it's on or off); plain Authorization also works.
    const jwt = req.headers.get("x-altiro-user") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const userId = jwt ? await deps.db.userIdFromJwt(jwt) : null;
    if (!userId) return json({ error: "not_signed_in", detail: jwt ? "token rejected by Supabase Auth" : "no Authorization header" }, 401);

    let body: Record<string, string> = {};
    try { body = await req.json(); } catch { /* empty body */ }

    try {
      switch (body.action) {
        case "authorize_url": {
          if (!body.redirect_uri) return json({ error: "missing_redirect_uri" }, 400);
          const q = new URLSearchParams({
            client_id: deps.env("STRAVA_CLIENT_ID")!,
            response_type: "code",
            redirect_uri: body.redirect_uri,
            approval_prompt: "auto",
            // activity:read_all, not just activity:read -- Garmin uploads are often "Only You" on
            // Strava, and those are left out without it.
            scope: "read,activity:read_all",
          });
          return json({ url: `${STRAVA}/oauth/authorize?${q}` });
        }
        case "connect": {
          if (!body.code) return json({ error: "missing_code" }, 400);
          // The athlete can untick "View data about your activities" on Strava's consent page --
          // without it there's nothing to import, so say so instead of connecting uselessly.
          if (body.scope && !/activity:read/.test(body.scope)) return json({ error: "missing_activity_scope" }, 400);
          const t = await stravaToken(deps, { grant_type: "authorization_code", code: body.code });
          const athlete = t.athlete || {};
          await deps.db.saveConnection({
            user_id: userId,
            athlete_id: athlete.id,
            athlete_name: [athlete.firstname, athlete.lastname].filter(Boolean).join(" ") || null,
            access_token: t.access_token,
            refresh_token: t.refresh_token,
            expires_at: new Date(t.expires_at * 1000).toISOString(),
            scope: body.scope || null,
            last_synced_at: null,
          });
          return json(await syncRuns(deps, userId));
        }
        case "sync":
          return json(await syncRuns(deps, userId));
        case "disconnect": {
          const conn = await deps.db.getConnection(userId);
          if (conn) {
            // Best-effort: also revoke Altiro's access on Strava's side.
            try {
              await deps.fetch(`${STRAVA}/oauth/deauthorize`, {
                method: "POST",
                headers: { Authorization: `Bearer ${conn.access_token}` },
              });
            } catch { /* still disconnect locally */ }
            await deps.db.deleteConnection(userId);
            await deps.db.deleteUnappliedActivities(userId);
          }
          return json({ connected: false });
        }
        default:
          return json({ error: "unknown_action" }, 400);
      }
    } catch (e) {
      return json({ error: String((e as Error).message || e) }, 502);
    }
  };
}

function supabaseDb(): Db {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const check = ({ error }: { error: unknown }) => { if (error) throw error; };
  return {
    async userIdFromJwt(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error) console.log(JSON.stringify({ auth_error: error.message }));
      return data?.user?.id ?? null;
    },
    async getConnectionByAthlete(athleteId) {
      const { data, error } = await admin.from("strava_connections").select("*").eq("athlete_id", athleteId).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
    async getConnection(userId) {
      const { data, error } = await admin.from("strava_connections").select("*").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return data;
    },
    async saveConnection(row) {
      check(await admin.from("strava_connections").upsert(row, { onConflict: "user_id" }));
    },
    async deleteConnection(userId) {
      check(await admin.from("strava_connections").delete().eq("user_id", userId));
    },
    async insertNewActivities(rows) {
      check(await admin.from("strava_activities").upsert(rows, { onConflict: "id", ignoreDuplicates: true }));
    },
    async deleteUnappliedActivities(userId) {
      check(await admin.from("strava_activities").delete().eq("user_id", userId).is("applied_at", null));
    },
    async deleteUnappliedActivity(activityId) {
      check(await admin.from("strava_activities").delete().eq("id", activityId).is("applied_at", null));
    },
  };
}

if (!Deno.env.get("ALTIRO_STRAVA_TEST")) {
  Deno.serve(makeHandler({
    db: supabaseDb(),
    env: (name) => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    // deno-lint-ignore no-explicit-any
    waitUntil: (p) => { const rt = (globalThis as any).EdgeRuntime; if (rt && rt.waitUntil) rt.waitUntil(p); },
  }));
}
