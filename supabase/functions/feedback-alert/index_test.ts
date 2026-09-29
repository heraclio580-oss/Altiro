// Run with: ALTIRO_FEEDBACK_TEST=1 deno test supabase/functions/feedback-alert/index_test.ts
// (tests/run-all.js runs it too when `deno` is installed.) Resend and the database are both faked.
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { makeHandler, type Deps } from "./index.ts";

const NOW = Date.parse("2026-09-28T15:00:00Z");

function setup(opts: { recent?: number; resendStatus?: number; noKey?: boolean } = {}) {
  const rows: Record<string, any> = {
    fb1: {
      id: "fb1", user_id: "u1", email: "runner@example.com", category: "plan", plan_feel: "too_hard",
      message: "Long runs are a lot <right> now.", alerted_at: null, created_at: "2026-09-28T14:59:00Z",
      context: { level: "beginner", training_days: [0, 2, 4], weekly_miles: 8, equipment: "dumbbells", plan_week: 2, platform: "web", goal: null },
    },
    fb2: { id: "fb2", user_id: "someone-else", email: "x@example.com", category: "idea", plan_feel: null, message: "hi", alerted_at: null, created_at: "2026-09-28T14:00:00Z", context: null },
  };
  const sent: any[] = [];
  const deps: Deps = {
    userIdFromJwt: async (jwt) => (jwt === "good-jwt" ? "u1" : null),
    getFeedback: async (id) => rows[id] ?? null,
    recentAlertCount: async () => opts.recent ?? 0,
    markAlerted: async (id, at) => { rows[id].alerted_at = at; },
    env: (n) => ({
      RESEND_API_KEY: opts.noKey ? undefined : "re_test",
      FEEDBACK_ALERT_TO: "team@example.com, coach@example.com",
      SUPABASE_URL: "https://ylzyqdeciysvufpffatu.supabase.co",
    } as Record<string, string | undefined>)[n],
    fetch: async (input, init) => {
      sent.push({ url: String(input), headers: init!.headers, body: JSON.parse(String(init!.body)) });
      return new Response(opts.resendStatus ? "bad" : '{"id":"email_1"}', { status: opts.resendStatus ?? 200 });
    },
    now: () => NOW,
  };
  const call = async (body: unknown, jwt = "good-jwt", headers?: Record<string, string>) => {
    const res = await makeHandler(deps)(new Request("http://x/feedback-alert", {
      method: "POST", headers: headers ?? { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  };
  return { call, rows, sent };
}

Deno.test("emails the team about the caller's new feedback, replying to the user", async () => {
  const { call, rows, sent } = setup();
  const r = await call({ id: "fb1" });
  assertEquals(r.body, { sent: true });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].url, "https://api.resend.com/emails");
  assertEquals(sent[0].headers.Authorization, "Bearer re_test");
  const email = sent[0].body;
  assertEquals(email.to, ["team@example.com", "coach@example.com"]);
  assertEquals(email.reply_to, "runner@example.com");
  assertEquals(email.from, "Altiro Feedback <onboarding@resend.dev>");
  assertEquals(email.subject, "[Altiro feedback] My plan · Too hard — runner@example.com");
  assertStringIncludes(email.text, "Long runs are a lot <right> now.");
  assertStringIncludes(email.text, "Training days: Mon, Wed, Fri");
  assertStringIncludes(email.text, "Weekly miles: 8");
  assertStringIncludes(email.html, "Long runs are a lot &lt;right&gt; now."); // escaped in HTML
  assertStringIncludes(email.html, "https://supabase.com/dashboard/project/ylzyqdeciysvufpffatu/editor");
  assertEquals(rows.fb1.alerted_at, new Date(NOW).toISOString());
});

Deno.test("never emails twice for the same feedback", async () => {
  const { call, sent } = setup();
  await call({ id: "fb1" });
  const again = await call({ id: "fb1" });
  assertEquals(again.body, { sent: false, reason: "already_sent" });
  assertEquals(sent.length, 1);
});

Deno.test("won't email about someone else's feedback, or feedback that doesn't exist", async () => {
  const { call, sent } = setup();
  assertEquals((await call({ id: "fb2" })).status, 404);
  assertEquals((await call({ id: "nope" })).status, 404);
  assertEquals(sent.length, 0);
});

Deno.test("reads the user's token from x-altiro-user (the anon key in Authorization gets past the gateway)", async () => {
  const { call } = setup();
  const res = await call({ id: "fb1" }, "", { Authorization: "Bearer anon-key", "x-altiro-user": "good-jwt" });
  assertEquals(res.status === 401, false);
  assertEquals((await call({ id: "fb1" }, "", { Authorization: "Bearer anon-key", "x-altiro-user": "bad-jwt" })).status, 401);
});

Deno.test("rejects callers who aren't signed in", async () => {
  const { call } = setup();
  assertEquals((await call({ id: "fb1" }, "bad-jwt")).status, 401);
});

Deno.test("rate-limits a user sending lots of feedback", async () => {
  const { call, sent } = setup({ recent: 5 });
  assertEquals((await call({ id: "fb1" })).body, { sent: false, reason: "rate_limited" });
  assertEquals(sent.length, 0);
});

Deno.test("says so when not configured, and when Resend fails (leaving it un-sent)", async () => {
  assertEquals((await setup({ noKey: true }).call({ id: "fb1" })).body.error, "not_configured");
  const failing = setup({ resendStatus: 403 });
  const r = await failing.call({ id: "fb1" });
  assertEquals(r.status, 502);
  assertEquals(failing.rows.fb1.alerted_at, null);
});
