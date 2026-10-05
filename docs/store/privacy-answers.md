# Privacy forms: what to answer

Based on what Altiro actually stores and sends (see `www/privacy.html`). If the app changes what it
collects, these answers need updating too.

## The short version
- **Tracking or advertising:** none. No ads, no analytics SDKs, no data sold or shared for advertising.
- **Everything collected** is used only for **App functionality** (and Customer support for feedback).
- **Linked to the user:** yes, for anything stored with their account.
- **Encrypted in transit:** yes (HTTPS everywhere).
- **Users can delete their data:** yes, in the app (Settings → Delete account) and at
  https://heraclio580-oss.github.io/Altiro/delete-account.html.

## Apple: App Store Connect → App Privacy

"Do you or your third-party partners collect data from this app?" → **Yes**.
For every data type below: **Used for tracking? No.** **Linked to the user? Yes**, except where noted.

| Apple data type | What it is in Altiro | Purpose |
|---|---|---|
| Contact Info → **Email Address** | account sign-in | App Functionality |
| Contact Info → **Name** | name shown in the app | App Functionality |
| Health & Fitness → **Fitness** | workouts, runs (including from Strava), sets, weights, reps, times, records, plan settings | App Functionality |
| Health & Fitness → **Health** | body weight, if the user enters it (optional) | App Functionality |
| User Content → **Customer Support** | feedback messages sent from the app | Customer Support |
| User Content → **Other User Content** | workout notes, missed-workout notes, classes | App Functionality |
| Identifiers → **User ID** | the account's internal ID | App Functionality |
| Location → **Coarse Location** | rounded location sent to the weather service when the user taps the weather; not stored on our servers. **Linked: No** | App Functionality |
| Diagnostics → **Other Diagnostic Data** | device type, included with feedback the user sends | Customer Support |

Don't select: Financial Info, Browsing History, Search History, Purchases, Contacts, Photos or Videos, Audio,
Gameplay, Precise Location, Sensitive Info, Usage Data, Crash Data, Performance Data, Advertising Data, Device ID.

## Google Play Console → App content → Data safety

- Does your app collect or share any of the required user data types? → **Yes**
- Is all of the user data collected by your app encrypted in transit? → **Yes**
- Do you provide a way for users to request that their data is deleted? → **Yes** (in-app, and the URL above)

| Category → type | Collected | Shared | Ephemeral | Required? | Purposes |
|---|---|---|---|---|---|
| Personal info → **Email address** | Yes | No | No | Required | App functionality, Account management |
| Personal info → **Name** | Yes | No | No | Required | App functionality, Account management |
| Personal info → **Other info** (age range, gender) | Yes | No | No | Optional | App functionality |
| Health and fitness → **Health info** (body weight) | Yes | No | No | Optional | App functionality |
| Health and fitness → **Fitness info** | Yes | No | No | Required | App functionality |
| App activity → **Other user-generated content** (notes, classes, feedback) | Yes | No | No | Optional | App functionality |
| Location → **Approximate location** | Yes | No | **Yes** (not stored) | Optional | App functionality |
| App info and performance → **Other app performance data** (device type with feedback) | Yes | No | No | Optional | App functionality |
| Device or other IDs | **No** | | | | |

"Shared" means given to another company for its own use. Supabase, Resend, Open-Meteo and Strava act as
service providers processing data on Altiro's behalf (or at the user's request), which Google doesn't
count as sharing.

## Ratings

**Apple age rating questionnaire:** every content question → **None** / **No**. Unrestricted web access → **No**.
Gambling → **No**. Result: **4+**. (The Terms say 13+; that's fine, the rating is about content.)

**Google content rating (IARC):** category **"All Other App Types"**. Answer **No** to violence, sexuality, language, controlled substances, gambling,
user-to-user communication, sharing location with other users and digital purchases. Expected result: **Everyone** / **PEGI 3**.

**Google target audience:** ages **13–15, 16–17, 18 and over** (not under 13). Not designed for children.

## Other Google Play declarations
- Ads: **No ads**.
- App access: **Some functionality is restricted** → give the reviewer the demo account (see review-notes.md).
- Health apps declaration: **Fitness** (activity and exercise tracking). Not a medical device.
- Government app: No. Financial features: None. News app: No.
