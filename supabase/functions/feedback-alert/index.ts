// Emails the team when a user sends feedback -- a Supabase Edge Function, called by the app (as the
// signed-in user) right after it saves a row to the `feedback` table.
//
// "Verify JWT" (Edge Functions -> feedback-alert -> Settings) can be on or off. The app sends the user's token in
// an x-altiro-user header and the project's anon key in Authorization -- see invokeFunction() in
// www/index.html -- because Supabase's built-in gateway check rejects user tokens signed with the newer
// JWT signing keys (a 401 before the function even runs) but accepts the anon key. The function checks
// the user's token itself, through Supabase Auth, which understands every key.
//
// It only ever emails about a real feedback row, sent by the caller, that hasn't been emailed yet (it
// stamps alerted_at), and at most ALERTS_PER_HOUR per user -- so it can't be used to spam the inbox.
// Replying to the email replies to the user.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   RESEND_API_KEY        from resend.com -> API Keys
//   FEEDBACK_ALERT_TO     where alerts go, e.g. "you@example.com" (comma-separate several)
//   FEEDBACK_ALERT_FROM   optional; defaults to Resend's test sender "Altiro Feedback <onboarding@resend.dev>",
//                         which can only send to the email your Resend account was created with --
//                         verify a domain in Resend to send from your own address / to anyone.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALERTS_PER_HOUR = 5;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-altiro-user",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TOPICS: Record<string, string> = { plan: "My plan", bug: "Something's broken", idea: "Idea", other: "Other" };
const FEELS: Record<string, string> = { too_easy: "Too easy", just_right: "Just right", too_hard: "Too hard" };

type Feedback = {
  id: string;
  user_id: string;
  email: string | null;
  category: string;
  plan_feel: string | null;
  message: string | null;
  context: Record<string, unknown> | null;
  alerted_at: string | null;
  created_at: string;
};

export type Deps = {
  userIdFromJwt(jwt: string): Promise<string | null>;
  getFeedback(id: string): Promise<Feedback | null>;
  recentAlertCount(userId: string, sinceIso: string): Promise<number>;
  markAlerted(id: string, atIso: string): Promise<void>;
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  now: () => number;
};

function json(body: unknown, status = 200) {
  // Every outcome is also written to the function's Logs, so "why didn't I get an email?" has an answer there.
  console.log(JSON.stringify({ status, ...(body as Record<string, unknown>) }));
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// The context snapshot, as readable label/value pairs (skipping anything empty).
function contextRows(ctx: Record<string, unknown> | null): [string, string][] {
  if (!ctx) return [];
  const labels: Record<string, string> = {
    level: "Level", goal: "Goal", focus: "Focus (0 run – 4 lift)", intensity: "Intensity (running)", lift_intensity: "Intensity (lifting)", training_days: "Training days",
    weekly_miles: "Weekly miles", equipment: "Equipment", strength_focus: "Strength focus", mile_time: "Mile time", plan_week: "Plan week", platform: "Platform", lang: "Language",
  };
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const rows: [string, string][] = [];
  for (const [key, label] of Object.entries(labels)) {
    const v = ctx[key];
    if (v === null || v === undefined || v === "") continue;
    rows.push([label, key === "training_days" && Array.isArray(v) ? v.map((d) => days[d as number] ?? d).join(", ") : String(v)]);
  }
  return rows;
}

export function buildEmail(fb: Feedback, dashboardUrl: string | null) {
  const topic = TOPICS[fb.category] || fb.category;
  const feel = fb.plan_feel ? FEELS[fb.plan_feel] || fb.plan_feel : null;
  const who = fb.email || fb.user_id;
  const subject = `[Altiro feedback] ${topic}${feel ? ` · ${feel}` : ""} — ${who}`;
  const ctx = contextRows(fb.context);
  const message = fb.message || "(no message — plan rating only)";
  const text = [
    `From: ${who}`,
    `Topic: ${topic}`,
    feel ? `Plan feels: ${feel}` : null,
    `Sent: ${fb.created_at}`,
    "",
    message,
    "",
    ...ctx.map(([k, v]) => `${k}: ${v}`),
    dashboardUrl ? `\nAll feedback: ${dashboardUrl}` : null,
  ].filter((l) => l !== null).join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#1a1a1a;max-width:560px">
  <p style="margin:0 0 4px;color:#666">${esc(topic)}${feel ? ` · <b>${esc(feel)}</b>` : ""} · from ${esc(who)}</p>
  <blockquote style="margin:12px 0;padding:12px 14px;border-left:3px solid #DA1419;background:#f6f6f4;white-space:pre-wrap">${esc(message)}</blockquote>
  ${ctx.length ? `<table style="border-collapse:collapse;font-size:13px">${ctx.map(([k, v]) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#666">${esc(k)}</td><td style="padding:2px 0">${esc(v)}</td></tr>`).join("")}</table>` : ""}
  <p style="margin:14px 0 0;color:#888;font-size:12px">Sent ${esc(fb.created_at)}. Reply to this email to answer ${esc(who)}.${
    dashboardUrl ? ` <a href="${esc(dashboardUrl)}">All feedback</a>` : ""}</p>
</div>`;
  return { subject, text, html };
}

export function makeHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const apiKey = deps.env("RESEND_API_KEY"), to = deps.env("FEEDBACK_ALERT_TO");
    if (!apiKey || !to) return json({ error: "not_configured" }, 500);
    // The app sends the user's token in x-altiro-user (Authorization then carries the anon key, which gets
    // past Supabase's "Verify JWT" gateway whether it's on or off); plain Authorization also works.
    const jwt = req.headers.get("x-altiro-user") || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const userId = jwt ? await deps.userIdFromJwt(jwt) : null;
    if (!userId) return json({ error: "not_signed_in", detail: jwt ? "token rejected by Supabase Auth" : "no Authorization header" }, 401);
    let body: { id?: string } = {};
    try { body = await req.json(); } catch { /* empty */ }
    if (!body.id) return json({ error: "missing_id" }, 400);

    const fb = await deps.getFeedback(body.id);
    if (!fb || fb.user_id !== userId) return json({ error: "not_found" }, 404);
    if (fb.alerted_at) return json({ sent: false, reason: "already_sent" });
    const hourAgo = new Date(deps.now() - 3600_000).toISOString();
    if (await deps.recentAlertCount(userId, hourAgo) >= ALERTS_PER_HOUR) return json({ sent: false, reason: "rate_limited" });

    const ref = (deps.env("SUPABASE_URL") || "").match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
    const dashboardUrl = ref ? `https://supabase.com/dashboard/project/${ref[1]}/editor` : null;
    const email = buildEmail(fb, dashboardUrl);
    const res = await deps.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: deps.env("FEEDBACK_ALERT_FROM") || "Altiro Feedback <onboarding@resend.dev>",
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        reply_to: fb.email || undefined,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!res.ok) return json({ error: `resend_${res.status}`, detail: await res.text() }, 502);
    await deps.markAlerted(fb.id, new Date(deps.now()).toISOString());
    return json({ sent: true });
  };
}

if (!Deno.env.get("ALTIRO_FEEDBACK_TEST")) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  Deno.serve(makeHandler({
    async userIdFromJwt(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error) console.log(JSON.stringify({ auth_error: error.message }));
      return data?.user?.id ?? null;
    },
    async getFeedback(id) {
      const { data } = await admin.from("feedback").select("*").eq("id", id).maybeSingle();
      return data;
    },
    async recentAlertCount(userId, sinceIso) {
      const { count } = await admin.from("feedback").select("id", { count: "exact", head: true })
        .eq("user_id", userId).gte("alerted_at", sinceIso);
      return count ?? 0;
    },
    async markAlerted(id, atIso) {
      await admin.from("feedback").update({ alerted_at: atIso }).eq("id", id);
    },
    env: (name) => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
  }));
}
