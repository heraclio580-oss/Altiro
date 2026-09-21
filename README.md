# Altiro

A fitness training app: adaptive weekly plans, real workout logging, and
progression programming. This repo is the migration target for the
[Claude Artifact prototype](https://claude.ai/artifact/FPPw9WiHXNAskt5TZ7J917)
(currently Version 49) — the path from "working prototype" to "real app store
app with subscriptions."

## Why this repo exists

A Claude Artifact can't hold payment info, can't run as a native app, and
can't be submitted to a store. Everything in the prototype so far (onboarding,
plan generation, calendar, progression programming) is real, working logic —
it just needs a real backend, real accounts, and a native shell around it.

## Stack

- **Backend / auth / database:** [Supabase](https://supabase.com) (Postgres + Auth + Row Level Security)
- **Subscriptions:** [RevenueCat](https://www.revenuecat.com) wrapping Apple StoreKit + Google Play Billing (+ Stripe for the web version)
- **Native shell:** [Capacitor](https://capacitorjs.com) — wraps the existing HTML/CSS/JS for iOS + Android with minimal rewrite
- **Web hosting:** Vercel or Netlify for the standalone site

Apple and Google **require** digital subscriptions inside a native app to go
through their own payment systems (App Store Review Guideline 3.1.1) — you
cannot route them through Stripe directly inside the app. RevenueCat exists so
we write the paywall/entitlement logic once instead of two native billing
integrations.

## Current status

- [x] `www/index.html` — the full app (migrated from the Artifact, Version 49).
      Fully self-contained, no build step, works as-is in any browser or in a
      Capacitor WebView.
- [x] `supabase/schema.sql` — database schema for real accounts: profiles,
      workout logs, manual entries, recorded performance data, progression
      targets, and a `subscriptions` table that will be the source of truth
      for paid access (synced from RevenueCat webhooks, never writable by the
      client). Apply it via the Supabase dashboard's SQL Editor.
- [x] **Real Supabase Auth is wired in.** Email/password sign-up and sign-in,
      session resume on reload, sign-out, and a Google sign-in button (wired
      to `signInWithOAuth`, but inactive until Google OAuth is configured in
      the Supabase dashboard under Authentication → Providers). The onboarding
      answers (goal, level, training days, focus, intensity, age/gender/weight)
      and rollup stats (streak, totals) sync to the `profiles` table on
      account creation and on sign-in.
      If the Supabase CDN script fails to load (blocked network, ad blocker),
      the app falls back to a harmless offline stub instead of crashing —
      auth actions surface a clear error instead of silently pretending to
      succeed.
- [ ] **Not yet synced to the cloud:** per-day workout logs, manual entries,
      recorded Log-Performance data, and progression targets. These still
      live only in local `state` for the session — the tables exist in
      `supabase/schema.sql` and are ready for this next.
- [ ] Paywall UI + entitlement gating.
- [ ] RevenueCat SDK integration + subscription products configured in App
      Store Connect / Play Console.
- [ ] Capacitor iOS/Android platforms added, tested on simulator/device.
- [ ] Store listings, privacy policy, account deletion flow, App Review submission.

## Run it locally right now

The app is a single static HTML file — no build step required yet:

```bash
npm run dev
# serves www/ at http://localhost:5173
```

## Tests

```bash
npm test
# runs everything in tests/ against www/index.html via jsdom
```

## What only you can do (accounts I can't create on your behalf)

| Account | Cost | Needed for |
|---|---|---|
| [GitHub](https://github.com) | free | already done — this repo |
| [Supabase](https://supabase.com) | free tier to start | real auth + database |
| [Apple Developer Program](https://developer.apple.com/programs/) | $99/yr | iOS App Store distribution |
| [Google Play Console](https://play.google.com/console/) | $25 one-time | Android Play Store distribution |
| [RevenueCat](https://www.revenuecat.com) | free tier to start | cross-platform subscription management |

## Next step

Sync per-day workout logs, manual entries, recorded performance data, and
progression targets to Supabase (the `workout_logs`, `manual_entries`,
`recorded_sessions`, and `progression_targets` tables already exist in
`supabase/schema.sql` for this). After that: paywall UI + RevenueCat.
