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
// Secrets (Supabase dashboard -> Edge Functions -> Secrets): STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "jsr:@supabase/supabase-js@2";

const STRAVA = "https://www.strava.com";
const RUN_TYPES = ["Run", "TrailRun", "VirtualRun"];
const DAY_SEC = 24 * 60 * 60;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  saveConnection(row: Partial<Connection> & { user_id: string }): Promise<void>;
  deleteConnection(userId: string): Promise<void>;
  // Inserts only activities not already stored, so a run the app has already filed (applied_at set)
  // is never reset to "new" and imported twice.
  insertNewActivities(rows: Record<string, unknown>[]): Promise<void>;
  deleteUnappliedActivities(userId: string): Promise<void>;
};

export type Deps = {
  db: Db;
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  now: () => number; // ms
};

function json(body: unknown, status = 200) {
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
    .filter((a) => RUN_TYPES.includes(a.sport_type || a.type))
    .map((a) => ({
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
    }));
  if (runs.length) await deps.db.insertNewActivities(runs);
  await deps.db.saveConnection({ ...conn, last_synced_at: new Date(deps.now()).toISOString() });
  return { connected: true, athlete_name: conn.athlete_name, fetched: runs.length };
}

export function makeHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!deps.env("STRAVA_CLIENT_ID") || !deps.env("STRAVA_CLIENT_SECRET")) {
      return json({ error: "not_configured" }, 500);
    }
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const userId = jwt ? await deps.db.userIdFromJwt(jwt) : null;
    if (!userId) return json({ error: "not_signed_in" }, 401);

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
      const { data } = await admin.auth.getUser(jwt);
      return data?.user?.id ?? null;
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
  };
}

if (!Deno.env.get("ALTIRO_STRAVA_TEST")) {
  Deno.serve(makeHandler({
    db: supabaseDb(),
    env: (name) => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
  }));
}
