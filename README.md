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

- [x] `www/index.html` — the full app (copied from the Artifact, Version 49).
      Fully self-contained, no build step, works as-is in any browser or in a
      Capacitor WebView.
- [x] `supabase/schema.sql` — database schema for real accounts: profiles,
      workout logs, manual entries, recorded performance data, progression
      targets, and a `subscriptions` table that will be the source of truth
      for paid access (synced from RevenueCat webhooks, never writable by the
      client).
- [ ] Wire real Supabase auth + data sync into `www/index.html` (replacing the
      in-memory `state` object and mocked sign-in).
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

## What only you can do (accounts I can't create on your behalf)

| Account | Cost | Needed for |
|---|---|---|
| [GitHub](https://github.com) | free | already done — this repo |
| [Supabase](https://supabase.com) | free tier to start | real auth + database |
| [Apple Developer Program](https://developer.apple.com/programs/) | $99/yr | iOS App Store distribution |
| [Google Play Console](https://play.google.com/console/) | $25 one-time | Android Play Store distribution |
| [RevenueCat](https://www.revenuecat.com) | free tier to start | cross-platform subscription management |

**Also needed right now:** this Claude session's GitHub access is currently
read-only for this repo — pushes are refused until the Claude GitHub App is
installed/linked for your account. Fix at
https://github.com/apps/claude/installations/select_target (or reconnect
GitHub under claude.ai → Settings → Connectors), granting it access to this
repo.

## Next step

Once you've created a Supabase project, share its project URL and anon key
(safe to share — it's public-facing by design; never share the `service_role`
key) and the next session can wire real authentication and data persistence
into `www/index.html` against `supabase/schema.sql`.
