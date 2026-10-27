# Free vs. Pro, and payments (draft for launch)

Status: decided and built (see docs/pro-setup.md for the store and RevenueCat setup). Price $7.99/month or
$49.99/year; a 7-day free week of Pro for new accounts, run by the app (no card); accounts made before
launch keep Pro free for life.

## Payments

- In the store apps, subscriptions go through **Apple In-App Purchase** and **Google Play Billing**
  (store rules). They charge the card, run trials, renewals, cancellations and refunds, and pay out to
  your bank. Fee: 15% for small developers (Apple Small Business Program; Google's subscription rate).
- No bank-linking app (Plaid / Stripe Link) is needed. Payouts are set up once:
  - Apple: App Store Connect -> Business (Agreements, Tax, and Banking): accept the Paid Apps
    agreement, add bank and tax info.
  - Google: Play Console -> Payments profile: bank and tax info.
- The website (getaltiro.app) can't use store billing: web subscriptions would go through Stripe.
- **RevenueCat** ties it together: one "Pro" status across Google, Apple and Stripe; free until about
  $2.5k/month in revenue; Capacitor plugin; a webhook updates the user's profile in Supabase.

## Split: tracking free, the coach is Pro

**Free**
- Create your own workouts; log runs, lifts, classes
- GPS run tracking: map, pace, splits, elevation
- Watch import (Health Connect / Apple Health / Strava), steps
- Calendar, streaks, weekly totals, last 4 weeks of progress
- Reminders, rest timer
- Share cards (free advertising)

**Pro**
- The personalized plan (running vs. lifting, days, equipment, goals)
- Automatic progression: pace and weight targets, weekly wave, deload weeks
- Run + lift days, hard/long run days, Adjust your plan, lift swaps and keeps
- Planning around recurring classes
- Full progress history, all-time charts, personal records
- Voice cues on GPS runs
- Future: exercise videos, race plans

**How it works for a new user:** 7-day free trial of Pro at sign-up. After it, everything logged
stays and the free features keep working; the plan shows "Unlock your plan". Testers and early users:
Pro free for life.

**Price:** about $7.99/month or $49.99/year ("save about 50%").

## Build order

1. Pro status on the profile in Supabase (set by the RevenueCat webhook), and the Pro locks in the app
2. Paywall: trial, both prices, Restore Purchases, Terms and Privacy links (Apple requires these)
3. RevenueCat with Google Play first (the Android test app is ready), then Apple
4. Later, optional: Stripe for website subscriptions

Your side: bank and tax info in both stores, a RevenueCat account, and the subscription products
(with prices) in Play Console and App Store Connect.
