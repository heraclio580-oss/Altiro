// Run with: ALTIRO_DELETE_TEST=1 deno test supabase/functions/delete-account/index_test.ts
// (tests/run-all.js runs it too when `deno` is installed.) Auth, the database and Strava are faked.
import { assertEquals } from "jsr:@std/assert@1";
import { makeHandler, type Deps } from "./index.ts";

function setup(opts: { strava?: boolean; deleteFails?: boolean } = {}) {
  const deleted: string[] = [], calls: string[] = [];
  const deps: Deps = {
    db: {
      userIdFromJwt: async (jwt) => (jwt === "good-token" ? "u1" : null),
      stravaAccessToken: async () => (opts.strava ? "strava-access" : null),
      deleteUser: async (id) => { if (opts.deleteFails) throw new Error("boom"); deleted.push(id); },
    },
    fetch: async (input, init) => {
      calls.push(`${init?.method} ${input} ${(init?.headers as Record<string, string>)?.Authorization}`);
      return new Response("{}");
    },
  };
  const call = (headers: Record<string, string>, body?: unknown) =>
    makeHandler(deps)(new Request("https://x/functions/v1/delete-account", { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { deleted, calls, call };
}

Deno.test("deletes the signed-in user, after revoking Strava", async () => {
  const t = setup({ strava: true });
  const res = await t.call({ "x-altiro-user": "good-token", Authorization: "Bearer anon" }, { confirm: "DELETE" });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).deleted, true);
  assertEquals(t.deleted, ["u1"]);
  assertEquals(t.calls, ["POST https://www.strava.com/oauth/deauthorize Bearer strava-access"]);
});

Deno.test("no Strava connection: just deletes", async () => {
  const t = setup();
  const res = await t.call({ Authorization: "Bearer good-token" }, { confirm: "DELETE" });
  assertEquals(res.status, 200);
  assertEquals(t.deleted, ["u1"]);
  assertEquals(t.calls, []);
});

Deno.test("refuses without a valid sign-in", async () => {
  const t = setup();
  assertEquals((await t.call({}, { confirm: "DELETE" })).status, 401);
  assertEquals((await t.call({ "x-altiro-user": "forged" }, { confirm: "DELETE" })).status, 401);
  assertEquals(t.deleted, []);
});

Deno.test("refuses without the confirmation", async () => {
  const t = setup();
  const res = await t.call({ "x-altiro-user": "good-token" }, {});
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "not_confirmed");
  assertEquals(t.deleted, []);
});

Deno.test("a failed delete says so", async () => {
  const t = setup({ deleteFails: true });
  const res = await t.call({ "x-altiro-user": "good-token" }, { confirm: "DELETE" });
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "delete_failed");
});
