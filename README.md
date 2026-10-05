# Altiro

**Live: https://heraclio580-oss.github.io/Altiro/**

A fitness training app: adaptive weekly plans, real workout logging, and
progression programming. This repo is the migration target for the
[Claude Artifact prototype](https://claude.ai/artifact/FPPw9WiHXNAskt5TZ7J917)
(the Artifact is now frozen as a historical reference only — its sandbox
blocks the Supabase script, so it can't run real auth; the GitHub Pages link
above is the real, current app) — the path from "working prototype" to "real
app store app with subscriptions."

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
- [x] **Deployed to GitHub Pages**, auto-deploying on every push to `main`.
      This is the real app now — the Claude Artifact copy is frozen as a
      historical reference (its sandbox blocks the Supabase script).
- [x] **Workout data syncs to the cloud.** Completed-day toggles, manual
      "+ Add a Workout" entries, structured performance data from the
      real Record Workout flow, and progression targets all read/write
      through to `workout_logs`, `manual_entries`, `recorded_sessions`,
      and `progression_targets`. Signing in on a different device/browser
      pulls all of it back down — verified with a two-session round-trip
      test (`tests/test_cloud_sync.js`) using a shared in-memory mock
      backend, not just "the call didn't throw."
      All writes are fire-and-forget (best-effort, wrapped in try/catch) —
      local state stays the source of truth for the current session even
      if a write fails, so nothing blocks on network latency.
- [x] "Today" always reflects the real calendar date (`getRealToday()` reads
      the real clock; only the test suite pins a fixed date, via
      `window.__ALTIRO_TEST_TODAY__`, set before the app script runs).
- [ ] Capacitor iOS/Android platforms added, tested on simulator/device.
- [ ] Store listings, privacy policy, account deletion flow, App Review submission.
- [ ] Paywall UI + entitlement gating (deferred deliberately — decide the
      free vs. paid feature split once real users are on the app).
- [ ] RevenueCat SDK integration + subscription products configured in App
      Store Connect / Play Console.

## Run it

**Live site:** https://heraclio580-oss.github.io/Altiro/ — auto-deploys via
GitHub Actions (`.github/workflows/deploy-pages.yml`) on every push to `main`.

Or run it locally — it's a single static HTML file, no build step required:

```bash
npm run dev
# serves www/ at http://localhost:5173
```

## Tests

```bash
npm test
# runs everything in tests/ against www/index.html via jsdom (plus the Edge Functions' tests when Deno is
# installed, and real-browser checks when Playwright is)
```

## What only you can do (accounts I can't create on your behalf)

| Account | Cost | Needed for |
|---|---|---|
| [GitHub](https://github.com) | free | already done — this repo |
| [Supabase](https://supabase.com) | free tier to start | real auth + database |
| [Apple Developer Program](https://developer.apple.com/programs/) | $99/yr | iOS App Store distribution |
| [Google Play Console](https://play.google.com/console/) | $25 one-time | Android Play Store distribution |
| [RevenueCat](https://www.revenuecat.com) | free tier to start | cross-platform subscription management |

## Building the store apps (iOS / Android)

The `ios/` and `android/` projects are generated by Capacitor and aren't kept in git. On your Mac/PC:

```bash
npm install
npx cap add ios         # first time only (needs Xcode + CocoaPods)
npx cap add android     # first time only (needs Android Studio)
npm run cap:sync        # copies www/ into both apps, installs plugins, adds the altiro:// link scheme
npm run assets          # app icons + splash screens for both, from resources/ (first time, or after a new logo)
npx cap open ios        # or: npx cap open android -- then build/run from Xcode / Android Studio
```

Run `npm run cap:sync` again after every change to `www/` (or after `git pull`).

What the store apps rely on:
- **Reminders** are scheduled on the phone (`@capacitor/local-notifications`), not sent by web push.
- **`altiro://` links** (`@capacitor/app` + `scripts/native-config.js`) bring people back into the app after
  Strava's sign-in and after confirming their email on the website.
- **Sharing a workout card** saves the picture to the app's cache (`@capacitor/filesystem`) and opens the
  phone's share sheet (`@capacitor/share`). On the website it uses the browser's own share sheet, or saves
  the picture where sharing isn't available.
- **Supabase's client ships inside `www/vendor/`**, so the app opens offline. `npm run vendor` refreshes it
  after updating `@supabase/supabase-js`.
- **Edge Functions** (deploy from `supabase/functions/`): `strava`, `workout-reminders`, `feedback-alert`,
  `delete-account`.
- **Icons and splash screens** come from `resources/` (icon-only.png 1024px, Android's adaptive
  icon-foreground/background, splash and splash-dark 2732px). The icon is upscaled from the 512px logo -- a
  1024px original would be sharper; drop it in as `resources/icon-only.png` and rerun `npm run assets`.
- **Legal pages:** `www/privacy.html`, `www/terms.html`, and `www/delete-account.html` (Google Play's
  account-deletion link) -- all served from the live site.

## Timer voice

`www/audio/ready.wav`, `go.wav` and `stop.wav` are the interval timer's spoken cues. They were made with
the open-source [Kokoro](https://github.com/hexgrad/kokoro) text-to-speech model (Apache 2.0, free for
commercial use), voice `am_michael` lowered 2 semitones for a deeper tone, then trimmed, compressed,
sped up 1.5× (pitch kept) and normalized so they're quick, loud and punchy. If they ever fail to load, the timer falls back to the phone's own speech voice.

## Next step

Build and run each store app on a real device (TestFlight / Play internal testing), then prepare the
store listings. Paywall/RevenueCat work is deliberately deferred until after real users are on the app.
