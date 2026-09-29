// Run with: ALTIRO_STRAVA_TEST=1 deno test supabase/functions/strava/index_test.ts
// (tests/run-all.js runs it too when `deno` is installed.) Strava and the database are both faked --
// this checks the function's own logic: sign-in exchange, token refresh, run filtering, revocation.
import { assertEquals } from "jsr:@std/assert@1";
import { makeHandler, type Deps } from "./index.ts";

const NOW = Date.parse("2026-09-27T15:00:00Z");

function setup(opts: { tokenStatus?: number; activitiesStatus?: number } = {}) {
  const connections: Record<string, any> = {};
  const activities: Record<string, any> = {};
  const calls: string[] = [];
  const stravaActivities = [
    { id: 1, name: "Long Run", sport_type: "Run", distance: 25749.5, moving_time: 8400, elapsed_time: 8700, start_date: "2026-09-27T12:02:00Z", start_date_local: "2026-09-27T08:02:00Z" },
    { id: 2, name: "Leg Day", sport_type: "WeightTraining", distance: 0, moving_time: 3000, elapsed_time: 3000, start_date: "2026-09-26T22:00:00Z", start_date_local: "2026-09-26T18:00:00Z" },
    { id: 3, name: "Treadmill", type: "VirtualRun", distance: 4828, moving_time: 1800, elapsed_time: 1800, start_date: "2026-09-26T01:30:00Z", start_date_local: "2026-09-25T21:30:00Z" },
  ];
  const deps: Deps = {
    now: () => NOW,
    env: (n) => ({ STRAVA_CLIENT_ID: "123", STRAVA_CLIENT_SECRET: "shh" } as Record<string, string>)[n],
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.endsWith("/oauth/token")) {
        if (opts.tokenStatus) return new Response("{}", { status: opts.tokenStatus });
        const body = JSON.parse(String(init!.body));
        assertEquals(body.client_secret, "shh");
        return Response.json({
          access_token: body.grant_type === "refresh_token" ? "fresh-access" : "access-1",
          refresh_token: "refresh-2",
          expires_at: NOW / 1000 + 6 * 3600,
          athlete: body.grant_type === "authorization_code" ? { id: 99, firstname: "Sam", lastname: "Runner" } : undefined,
        });
      }
      if (url.includes("/api/v3/athlete/activities")) {
        if (opts.activitiesStatus) return new Response("{}", { status: opts.activitiesStatus });
        return Response.json(stravaActivities);
      }
      return new Response("{}", { status: 200 });
    },
    db: {
      userIdFromJwt: async (jwt) => (jwt === "good-jwt" ? "user-1" : null),
      getConnection: async (u) => connections[u] ?? null,
      saveConnection: async (row) => { connections[row.user_id] = { ...connections[row.user_id], ...row }; },
      deleteConnection: async (u) => { delete connections[u]; },
      insertNewActivities: async (rows) => { rows.forEach((r) => { if (!activities[r.id as number]) activities[r.id as number] = r; }); },
      deleteUnappliedActivities: async (u) => {
        Object.keys(activities).forEach((k) => { if (activities[k].user_id === u && !activities[k].applied_at) delete activities[k]; });
      },
    },
  };
  const call = async (body: unknown, jwt = "good-jwt", headers?: Record<string, string>) => {
    const res = await makeHandler(deps)(new Request("http://x/strava", {
      method: "POST", headers: headers ?? { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  };
  return { call, connections, activities, calls };
}

Deno.test("reads the user's token from x-altiro-user (the anon key in Authorization gets past the gateway)", async () => {
  const { call } = setup();
  const res = await call({ action: "sync" }, "", { Authorization: "Bearer anon-key", "x-altiro-user": "good-jwt" });
  assertEquals(res.status === 401, false);
  assertEquals((await call({ action: "sync" }, "", { Authorization: "Bearer anon-key", "x-altiro-user": "bad-jwt" })).status, 401);
});

Deno.test("rejects callers who aren't signed in", async () => {
  const { call } = setup();
  assertEquals((await call({ action: "sync" }, "bad-jwt")).status, 401);
});

Deno.test("authorize_url asks for private activities too, and sends Strava back to the given page", async () => {
  const { call } = setup();
  const { body } = await call({ action: "authorize_url", redirect_uri: "https://example.com/Altiro/strava-callback.html" });
  const url = new URL(body.url);
  assertEquals(url.origin + url.pathname, "https://www.strava.com/oauth/authorize");
  assertEquals(url.searchParams.get("client_id"), "123");
  assertEquals(url.searchParams.get("scope"), "read,activity:read_all");
  assertEquals(url.searchParams.get("redirect_uri"), "https://example.com/Altiro/strava-callback.html");
});

Deno.test("connect stores the tokens and pulls in runs only (not strength), dated by local start time", async () => {
  const { call, connections, activities } = setup();
  const { status, body } = await call({ action: "connect", code: "abc", scope: "read,activity:read_all" });
  assertEquals(status, 200);
  assertEquals(body, { connected: true, athlete_name: "Sam Runner", fetched: 2 });
  assertEquals(connections["user-1"].athlete_id, 99);
  assertEquals(connections["user-1"].refresh_token, "refresh-2");
  assertEquals(Object.keys(activities).sort(), ["1", "3"]);
  assertEquals(activities[1].local_date, "2026-09-27");
  // Ran at 9:30pm local on the 25th -- already the 26th in UTC, but it belongs on the 25th.
  assertEquals(activities[3].local_date, "2026-09-25");
  assertEquals(activities[3].sport_type, "VirtualRun");
});

Deno.test("connect refuses a sign-in where activity access was unticked", async () => {
  const { call, connections } = setup();
  const { status, body } = await call({ action: "connect", code: "abc", scope: "read" });
  assertEquals(status, 400);
  assertEquals(body.error, "missing_activity_scope");
  assertEquals(connections["user-1"], undefined);
});

Deno.test("sync with no connection just reports not connected", async () => {
  const { call, calls } = setup();
  assertEquals((await call({ action: "sync" })).body, { connected: false });
  assertEquals(calls.length, 0);
});

Deno.test("sync refreshes an expired token before asking Strava for runs", async () => {
  const { call, connections, calls } = setup();
  connections["user-1"] = {
    user_id: "user-1", athlete_id: 99, athlete_name: "Sam", access_token: "old", refresh_token: "r1",
    expires_at: new Date(NOW - 1000).toISOString(), scope: "read,activity:read_all", last_synced_at: null,
  };
  const { body } = await call({ action: "sync" });
  assertEquals(body.connected, true);
  assertEquals(connections["user-1"].access_token, "fresh-access");
  assertEquals(calls[0], "POST https://www.strava.com/oauth/token");
  // Looks back a week by default.
  const after = Number(new URL(calls[1].split(" ")[1]).searchParams.get("after"));
  assertEquals(after, NOW / 1000 - 7 * 24 * 3600);
});

Deno.test("sync looks back further when the app hasn't synced for a while", async () => {
  const { call, connections, calls } = setup();
  connections["user-1"] = {
    user_id: "user-1", athlete_id: 99, athlete_name: "Sam", access_token: "ok", refresh_token: "r1",
    expires_at: new Date(NOW + 3600_000).toISOString(), scope: "read,activity:read_all",
    last_synced_at: new Date(NOW - 20 * 24 * 3600_000).toISOString(),
  };
  await call({ action: "sync" });
  const after = Number(new URL(calls[0].split(" ")[1]).searchParams.get("after"));
  assertEquals(after, NOW / 1000 - 22 * 24 * 3600);
});

Deno.test("a sync after access was revoked on Strava drops the connection", async () => {
  const { call, connections } = setup({ activitiesStatus: 401 });
  connections["user-1"] = {
    user_id: "user-1", athlete_id: 99, athlete_name: "Sam", access_token: "ok", refresh_token: "r1",
    expires_at: new Date(NOW + 3600_000).toISOString(), scope: null, last_synced_at: null,
  };
  assertEquals((await call({ action: "sync" })).body, { connected: false });
  assertEquals(connections["user-1"], undefined);
});

Deno.test("a failed token refresh (revoked) also drops the connection", async () => {
  const { call, connections } = setup({ tokenStatus: 400 });
  connections["user-1"] = {
    user_id: "user-1", athlete_id: 99, athlete_name: "Sam", access_token: "old", refresh_token: "r1",
    expires_at: new Date(NOW - 1000).toISOString(), scope: null, last_synced_at: null,
  };
  assertEquals((await call({ action: "sync" })).body, { connected: false });
  assertEquals(connections["user-1"], undefined);
});

Deno.test("disconnect revokes on Strava and forgets runs not yet filed", async () => {
  const { call, connections, activities, calls } = setup();
  await call({ action: "connect", code: "abc", scope: "read,activity:read_all" });
  activities[1].applied_at = "2026-09-27T15:00:00Z";
  assertEquals((await call({ action: "disconnect" })).body, { connected: false });
  assertEquals(connections["user-1"], undefined);
  assertEquals(Object.keys(activities), ["1"]);
  assertEquals(calls.includes("POST https://www.strava.com/oauth/deauthorize"), true);
});
