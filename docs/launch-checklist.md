# Altiro launch checklist (your part)

Everything below needs you, because it's an account, a payment, a dashboard, or a decision only the
owner can make. Demo photos aren't included. Do them in order where you can: some steps unblock later
ones.

Links you'll need:

- Live app: https://getaltiro.app/
- Privacy policy: https://getaltiro.app/privacy.html
- Terms of use: https://getaltiro.app/terms.html
- Account deletion page (Google Play asks for this): https://getaltiro.app/delete-account.html
- Support email: altiro580@gmail.com

---

## 1. This week (Supabase and keys)

- [x] **Deploy the `delete-account` function.** Supabase → Edge Functions → Deploy a new function, named
  exactly `delete-account`. Paste the whole of `supabase/functions/delete-account/index.ts` (clear the editor
  first). It needs no secrets.
- [x] **Test Delete account on a throwaway account,** not your real one: sign up with a second email, then
  Settings → Delete account.
- [x] **Rotate the Resend API key** you pasted in chat earlier. Make a new key in Resend, update the
  `RESEND_API_KEY` secret in Supabase, then delete the old key.
- [ ] **Decide on Supabase's plan.** Free projects pause after about a week with no activity, and a paused
  project means nobody can sign in. The Pro plan ($25/month) doesn't pause. Free is fine while testing;
  switch before launch.

## 2. Sign-up emails (blocks real users)

Done: sign-up emails now go out through Resend from `no-reply@getaltiro.app`, so anyone can sign up.

- [x] **Buy a domain:** `getaltiro.app` (Cloudflare).
- [x] **Verify the domain in Resend** (Resend → Domains → Add domain, then add the DNS records it shows you).
- [x] **Point Supabase's emails at Resend:** Supabase → Authentication → Emails → SMTP Settings → enable
  custom SMTP. Host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key, sender
  `no-reply@getaltiro.app`, name `Altiro`.
- [x] **Raise the email rate limit** to something like 30/hour (Authentication → Rate Limits).
- [x] **Send yourself a test sign-up** and check the email arrives and isn't in spam.
- [x] Feedback alerts come from `Altiro Feedback <feedback@getaltiro.app>` (`FEEDBACK_ALERT_FROM`) and can go to any
  inbox.

## 3. Developer accounts (start early, verification takes days)

- [ ] **Apple Developer Program,** $99/year: https://developer.apple.com/programs/. Enroll as an
  individual (fastest; your name shows as the seller) or as a company (needs a D-U-N-S number, which is free
  but takes up to 2 weeks).
- [ ] **Google Play Console,** $25 once: https://play.google.com/console/. Identity verification can take a
  few days.
- [ ] **Google's testing rule for new personal accounts:** before the app can go public, you must run a
  *closed test* with **at least 12 testers opted in for 14 days in a row**. Start lining up 12+ people with
  Android phones (friends, family, gym or club members) and their Gmail addresses. These are Play Store
  testers: Altiro accounts on the website don't count, and each tester must join through Google Play's test
  link and install the app from Play. Use real people (Google checks), and a few extra in case some drop out.

## 4. Build the apps on your computer

- [x] ⌚ **Watches, steps and health:** done. The app is on **Capacitor 8** with **Apple Health** (iPhone) and
  **Health Connect** (Android): runs from almost any watch (Apple Watch, Garmin via Garmin Connect, Samsung,
  Fitbit, Coros, Polar...) come in without Strava, plus today's **steps** on Today (Settings → Connected Apps →
  Connect). The privacy policy and `docs/store/privacy-answers.md` cover it. Your part:
  - **Apple:** in the developer portal, tick **HealthKit** on the App ID `com.altiro.app` (Codemagic's
    automatic signing can do it too).
  - **Google Play:** fill in the **Health Connect** declaration (App content) with the five permissions and
    reasons in `docs/store/privacy-answers.md`.
  - **Test it:** on Android, connect Health Connect and check a run from your watch shows up. Garmin Connect
    must share with Health Connect first: update Garmin Connect, then **More → Settings → Health Connect** and
    allow it to write data, including **workouts / exercise** (steps and workouts are separate permissions).
  - **Garmin Connect Developer Program** (direct Garmin sync, sending planned workouts to the watch): Garmin
    has paused new applications. Watch https://developer.garmin.com/gc-developer-program/overview for it to
    reopen; until then Garmin works through Health Connect / Apple Health and Strava.
  - Later, only if users ask: a watch app of its own (Apple Watch, Wear OS, Garmin Connect IQ).

- [ ] **iPhone app:** no Mac, so build it in the cloud with **Codemagic** (free tier: 500 build minutes a
  month on their Macs). It builds straight from the GitHub repo and can upload to App Store Connect. Do the
  Android app first; set this up once the Apple Developer account is approved.
- [ ] **Android app:** Android Studio (free, Windows, Mac or Linux), or ask Claude to build the Play Store upload
  file on GitHub. Needs **Node.js 22** or newer and Java 21 (Android Studio includes it).
- [ ] In the project folder: `npm install`, then `npm run cap:sync`, then `npx cap open ios` or
  `npx cap open android`. The README has the details. Run `npm run cap:sync` again after every update.
- [ ] **Generate the app icons and splash screens:** `npm run assets` (the source images are in `resources/`).
- [ ] Optional: get a **1024×1024 original of the logo** from whoever designed it. The current icon is upscaled
  from 512px. Save it as `resources/icon-only.png` and rerun `npm run assets`.
- [ ] **Track a short GPS run on your phone** (Today → Track a run with GPS): allow location, start, lock the
  phone for a minute, unlock, finish. Check the distance, the map, and the share card.
- [ ] **Run it on your own phone.** Check sign-up and sign-in, a workout, reminders (allow notifications),
  connecting Strava, and the `altiro://` hand-back after Strava and after confirming an email.

## 5. Store listings

Everything to paste in is ready in `docs/store/`: `listing.md` (text, English and Spanish),
`privacy-answers.md` (the privacy forms and ratings), `review-notes.md` (notes for the reviewers), and
`screenshots/` (6 screens, English and Spanish, at 1290×2796 for iPhone 6.7" and 1080×1920 for Android).

- [ ] **App Store Connect:** create the app with bundle ID `com.altiro.app`, then fill in the name,
  subtitle, description, keywords, screenshots, support URL, privacy policy URL, age rating questionnaire
  and the **App Privacy** ("nutrition label") answers.
- [ ] **Google Play Console:** create the app with package `com.altiro.app`, then fill in the store
  listing, screenshots, the **Data safety** form, content rating questionnaire, target audience (13+), and the
  **account deletion URL** above.
- [ ] **Google Play: Foreground service permissions** (App content). Altiro's GPS run tracking uses the
  location foreground service; the description to paste and the short video Google asks for are in
  `docs/store/privacy-answers.md`.
- [ ] Both stores want a **demo account for reviewers** (an email and password that works). Make one, fill
  it with a week of workouts, and put the login in the review notes.

## 6. Testing before you submit

- [ ] **iPhone:** upload a build to **TestFlight** and use it yourself for a few days.
- [ ] **Android:** **internal testing** first (just you), then the **closed test** with your 12+ testers for
  14 days.
- [ ] Send me anything that looks wrong. Screenshots help.

## 7. Strava

- [ ] **Submit Altiro for Strava's review.** Until Strava approves it, only 1 athlete (you) can connect.
  The screenshots they ask for are in `strava-review/`. Developer page: https://www.strava.com/settings/api.
- [x] **Authorization Callback Domain** is `getaltiro.app` (the website's own domain since the move).

## 8. Legal and business (decide before launch)

- [ ] **Have the Terms of Use reviewed** if you can. They're a standard draft, but they name no governing
  law (your country or state), and only you can decide that.
- [ ] **Seller name:** you as an individual, or a business (an LLC can protect your personal assets).
- [ ] **Paid features later?** Apple and Google take 15–30%. That's deferred for now; RevenueCat is in the plan
  for later.

## 9. Launch day

- [ ] Submit to the App Store (review usually takes 1–3 days) and to Google Play (production access opens
  after the 14-day closed test).
- [ ] Keep an eye on Supabase (Logs, and Database usage) and on the feedback inbox for the first week.
