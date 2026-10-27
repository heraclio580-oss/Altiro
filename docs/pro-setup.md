# Altiro Pro: setting up subscriptions

What's built: the paywall, Pro status in Settings, the 7-day free week, buying through RevenueCat in the
store apps, and the `revenuecat-webhook` function that records subscriptions in Supabase. What's left
is accounts and settings only you can do, in this order. (The launch checklist has the same steps.)

**Prices:** $7.99 a month or $49.99 a year. **Trial:** the first 7 days of a new account, run by the app
itself, no card needed. So the store subscriptions get **no free trial offer** of their own.

Nobody is charged or locked out until Pro is switched on (step 7). Until then every account has Pro,
and accounts made before that day keep Pro free for life.

## 1. Product IDs (use exactly these)

| Store | Subscription | Plans |
|---|---|---|
| Google Play | `altiro_pro` | base plans `monthly` ($7.99, every month) and `yearly` ($49.99, every year), auto-renewing |
| App Store | group "Altiro Pro" | `altiro_pro_monthly` ($7.99, 1 month) and `altiro_pro_yearly` ($49.99, 1 year) |

- **Google Play Console** → Monetize → Products → Subscriptions → Create `altiro_pro`, add the two base
  plans and activate them. First: a payments profile with bank and tax info (Setup → Payments profile).
  Play only allows this after a build has been uploaded (internal testing is enough).
- **App Store Connect** → Business: accept the Paid Apps agreement, add bank and tax info, and join the
  [Small Business Program](https://developer.apple.com/app-store/small-business-program/) (15% fee instead
  of 30%). Then your app → Monetization → Subscriptions → create the group and the two products, with a
  display name and description in English and Spanish, and a screenshot of the paywall for review.
- **iPhone build:** the app needs the **In-App Purchase** capability (Codemagic adds it with the signing
  setup; tell Claude when you get there).

## 2. RevenueCat

1. Sign up at https://app.revenuecat.com and create a project "Altiro".
2. Add an app for each store:
   - **Play Store:** package `com.altiro.app`, plus a Google service account so RevenueCat can check
     purchases (RevenueCat's setup page walks through it, including the Play Console permissions).
   - **App Store:** bundle ID `com.altiro.app`, plus an In-App Purchase key from App Store Connect.
3. **Products:** import the products from step 1.
4. **Entitlement:** create one called exactly `pro`, and attach all four products to it.
5. **Offering:** the `default` offering with two packages: **Annual** (the yearly products) and
   **Monthly** (the monthly ones).
6. **API keys:** send Claude the two *public* SDK keys (Project → API keys): one starts with `goog_`, the
   other with `appl_`. They're meant to be inside the app, so they're fine to share in chat. Never send the
   secret key (`sk_...`).

## 3. The webhook (Pro on the website, and a record in Supabase)

1. Supabase → Edge Functions → Deploy a new function named exactly `revenuecat-webhook`, pasting
   `supabase/functions/revenuecat-webhook/index.ts`. In its settings, turn **Verify JWT off** (RevenueCat
   sends its own header, not a Supabase sign-in).
2. Make up a long random password (a password manager can generate one). Supabase → Edge Functions →
   Secrets → add `REVENUECAT_WEBHOOK_AUTH` with the value `Bearer <your password>`.
3. RevenueCat → Project → Integrations → Webhooks → Add:
   - URL: `https://ylzyqdeciysvufpffatu.supabase.co/functions/v1/revenuecat-webhook`
   - Authorization header value: the same `Bearer <your password>`
   - Environment: both sandbox and production
4. Press **Send test event**: it should show as delivered (the function answers `test: true`).

## 4. Test a purchase (no real money)

- **Android:** Play Console → Setup → License testing → add your Gmail. Purchases from that account are
  free test purchases that renew every few minutes.
- **iPhone:** App Store Connect → Users and Access → Sandbox → add a sandbox tester, and sign in with it
  under Settings → Developer on the phone.
- In the app: Settings → Testing → **Preview free version**, then tap **Unlock your plan** to open the
  paywall and buy. Pro should turn on straight away, and a row should appear in Supabase →
  Table Editor → `subscriptions`.

## 5. Giving someone Pro for free

Run in Supabase → SQL Editor (replace the email):

```sql
insert into subscriptions (user_id, entitlement, status, updated_at)
select id, 'pro', 'lifetime', now() from auth.users where email = 'friend@example.com'
on conflict (user_id) do update set entitlement = 'pro', status = 'lifetime', updated_at = now();
```

A store event never replaces a lifetime grant.

## 6. Before submitting

- Both stores' review notes: the demo account should be one made before launch (Pro for life), so the
  reviewers can see everything, and mention that subscriptions are tested with a sandbox account.
- Apple requires the paywall to show the price, the period, that it renews automatically, how to cancel,
  and links to the Terms and Privacy Policy: all there.

## 7. Switching Pro on

When the app is approved in both stores, ask Claude to set the launch date (`PRO_LAUNCH_AT` in
`www/index.html`). From that day, new accounts get the 7-day free week and then the paywall; everyone who
signed up before keeps Pro free for life.
