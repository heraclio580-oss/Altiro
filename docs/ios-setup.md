# iPhone app: setup steps

What's already done in the project (no Apple account needed):
- `codemagic.yaml`: builds the iPhone app on Codemagic's Macs and sends it to TestFlight.
- `scripts/native-config.js`: Altiro's iPhone settings: permission text (location, Photos, Apple Health),
  background location for GPS runs, the Apple Health entitlement, `altiro://` links, iPhone only (an iPad runs
  the iPhone app), portrait, no export-compliance question, and the version and build number.

What's left, in order. Steps marked **(you)** need your accounts; Claude does the rest.

## 1. Apple Developer Program (you)
- Create an Apple Account (account.apple.com, or on an iPad: Settings -> Sign in). If it says "Your account
  cannot be created at this time": wait 24-48 hours and try once with a new email, or call Apple Support at
  1-800-692-7753.
- Enroll at developer.apple.com/programs/enroll (or in the Apple Developer app on an iPad) as
  **Individual / Sole Proprietor**, $99/year. Wait for the "Welcome to the Apple Developer Program" email.

## 2. The App ID (you, about 5 minutes)
developer.apple.com -> Account -> Certificates, Identifiers & Profiles -> Identifiers -> **+** -> App IDs -> App:
- Description: `Altiro`, Bundle ID (Explicit): `com.altiro.app`
- Capabilities: tick **HealthKit** and **Sign in with Apple**. Register.

## 3. The app in App Store Connect (you)
appstoreconnect.apple.com -> Apps -> **+** -> New App: iOS, name `Altiro: Run + Strength Plans`, primary
language English (U.S.), bundle ID `com.altiro.app`, SKU `altiro-ios`, full access.

## 4. An App Store Connect API key, for Codemagic (you)
App Store Connect -> Users and Access -> Integrations -> App Store Connect API -> **Generate API Key**, name
`Codemagic`, access **App Manager**. Download the `.p8` file (it can only be downloaded once) and note the
**Issuer ID** and **Key ID**. Keep the file private; never paste it in a chat.

## 5. Codemagic (you, then Claude)
- codemagic.io -> sign up with GitHub -> add the **Altiro** repository.
- Team settings -> Integrations -> Developer Portal -> **Manage keys** -> add a key named exactly **Altiro**
  with the Issuer ID, Key ID and the `.p8` file.
- Start a build: Altiro -> **Start new build** -> workflow **iOS release (TestFlight)**. Claude sets the
  version (`VERSION_NAME` in `codemagic.yaml`) before each release.

## 6. TestFlight (you)
App Store Connect -> Altiro -> TestFlight: add yourself (and iPhone testers) as testers. Install the
**TestFlight** app on an iPhone or iPad and accept the invite.

## 7. Subscriptions on the App Store (you, with Claude's help)
- App Store Connect -> Altiro -> Subscriptions: a group `Altiro Pro` with **Monthly ($7.99)** and **Yearly
  ($49.99)**, same as Google Play.
- RevenueCat -> project "Altiro pro" -> add an **App Store** app (`com.altiro.app`) with its In-App Purchase
  key, attach both products to the `pro` entitlement and the `default` offering, and send Claude the public
  **appl_** key (it's safe to share; it goes in the app).

## 8. Sign in with Apple (you, with Claude's help)
Required by Apple because the app offers Sign in with Google. In the developer portal: a Services ID and a
Sign in with Apple key; then Supabase -> Authentication -> Providers -> Apple. Claude will walk through it.

## 9. Store listing and review
Text, screenshots (iPhone 6.7") and review notes are ready in `docs/store/`. Then submit for review (usually
1-3 days).

## 10. After the iPhone app is live
Tell Claude to end "Pro is free on iPhone in the browser" (`iphoneWeb()` in `www/index.html`), add the
App Store link to the website, and start the launch plan in `docs/marketing/social-media-plan.md`.
