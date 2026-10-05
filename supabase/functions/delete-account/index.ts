// Account deletion for Altiro -- a Supabase Edge Function.
//
// Apple and Google both require that a user can delete their account from inside the app (and Google
// also from a web page -- see www/delete-account.html). Deleting a user from Supabase Auth needs the
// service role key, which must never ship in the app, so the app asks this function to do it.
//
// Called as the signed-in user, POST {confirm: "DELETE"}:
//   1. checks who's asking (their own token -- a user can only ever delete themselves),
//   2. revokes Altiro's access on Strava's side if they'd connected it (best-effort),
//   3. deletes them from Supabase Auth. Every table's rows reference auth.users with ON DELETE CASCADE
//      (see supabase/schema.sql), so their profile, workouts, plan, classes, records, Strava runs,
//      reminders and feedback all go with it.
// -> {deleted: true}
//
// Same token handling as the strava function: the app sends the user's token in x-altiro-user and the
// anon key in Authorization, so "Verify JWT" can be on or off.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically; no other secrets needed.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-altiro-user",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type Db = {
  userIdFromJwt(jwt: string): Promise<string | null>;
  stravaAccessToken(userId: string): Promise<string | null>;
  deleteUser(userId: string): Promise<void>;
};
export type Deps = { db: Db; fetch: typeof fetch };

function json(body: unknown, status = 200) {
  console.log(JSON.stringify({ status, ...(body as Record<string, unknown>) }));
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export function makeHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const jwt = req.headers.get("x-altiro-user") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const userId = jwt ? await deps.db.userIdFromJwt(jwt) : null;
    if (!userId) return json({ error: "not_signed_in" }, 401);
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty body */ }
    // A deliberate request only -- the app sends this after the user typed the confirmation.
    if (body.confirm !== "DELETE") return json({ error: "not_confirmed" }, 400);
    try {
      const token = await deps.db.stravaAccessToken(userId);
      if (token) {
        try {
          await deps.fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        } catch { /* the account still goes; Strava drops an app it can't reach on its own */ }
      }
      await deps.db.deleteUser(userId);
      return json({ deleted: true, user_id: userId });
    } catch (e) {
      return json({ error: "delete_failed", detail: String((e as Error).message || e) }, 500);
    }
  };
}

function supabaseDb(): Db {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  return {
    async userIdFromJwt(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error) console.log(JSON.stringify({ auth_error: error.message }));
      return data?.user?.id ?? null;
    },
    async stravaAccessToken(userId) {
      const { data } = await admin.from("strava_connections").select("access_token").eq("user_id", userId).maybeSingle();
      return data?.access_token ?? null;
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
  };
}

if (!Deno.env.get("ALTIRO_DELETE_TEST")) {
  Deno.serve(makeHandler({ db: supabaseDb(), fetch: (input, init) => fetch(input, init) }));
}
