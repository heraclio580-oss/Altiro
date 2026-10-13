# Privacy forms: what to answer

Based on what Altiro actually stores and sends (see `www/privacy.html`). If the app changes what it
collects, these answers need updating too.

## The short version
- **Tracking or advertising:** none. No ads, no analytics SDKs, no data sold or shared for advertising.
- **Everything collected** is used only for **App functionality** (and Customer support for feedback).
- **Linked to the user:** yes, for anything stored with their account.
- **Encrypted in transit:** yes (HTTPS everywhere).
- **Users can delete their data:** yes, in the app (Settings → Delete account) and at
  https://getaltiro.app/delete-account.html.

## Apple: App Store Connect → App Privacy

"Do you or your third-party partners collect data from this app?" → **Yes**.
For every data type below: **Used for tracking? No.** **Linked to the user? Yes**, except where noted.

| Apple data type | What it is in Altiro | Purpose |
|---|---|---|
| Contact Info → **Email Address** | account sign-in | App Functionality |
| Contact Info → **Name** | name shown in the app | App Functionality |
| Health & Fitness → **Fitness** | workouts, runs (including from Strava and from Apple Health), sets, weights, reps, times, records, plan settings | App Functionality |
| Health & Fitness → **Health** | body weight, if the user enters it (optional) | App Functionality |
| User Content → **Customer Support** | feedback messages sent from the app | Customer Support |
| User Content → **Other User Content** | workout notes, missed-workout notes, classes | App Functionality |
| Identifiers → **User ID** | the account's internal ID | App Functionality |
| Location → **Precise Location** | the route of a run the user tracks with GPS, saved with that run | App Functionality |
| Location → **Coarse Location** | rounded location sent to the weather service when the user taps the weather; not stored on our servers. **Linked: No** | App Functionality |
| Diagnostics → **Other Diagnostic Data** | device type, included with feedback the user sends | Customer Support |

Don't select: Financial Info, Browsing History, Search History, Purchases, Contacts, Photos or Videos, Audio,
Gameplay, Sensitive Info, Usage Data, Crash Data, Performance Data, Advertising Data, Device ID.

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
| Location → **Precise location** (routes of runs tracked with GPS) | Yes | No | No | Optional | App functionality |
| Location → **Approximate location** (weather) | Yes | No | **Yes** (not stored) | Optional | App functionality |
| App info and performance → **Other app performance data** (device type with feedback) | Yes | No | No | Optional | App functionality |
| Device or other IDs | **No** | | | | |

"Shared" means given to another company for its own use. Supabase, Resend, Open-Meteo and Strava act as
service providers processing data on Altiro's behalf (OpenFreeMap too, for the map tiles) (or at the user's request), which Google doesn't
count as sharing.

## Apple Health and Health Connect (the store apps)

Altiro **reads** workouts (runs only are kept), the distance and calories during them, and today's steps. It
never writes. Runs it reads are saved to the user's log (already covered by **Fitness** above); steps are
shown on the phone and not stored on our servers.

**Apple:**
- Nothing new in App Privacy beyond **Health & Fitness → Fitness** above.
- App Store Connect → the App ID (**Certificates, Identifiers & Profiles → Identifiers → com.altiro.app**) needs
  the **HealthKit** capability ticked. Codemagic's automatic signing can do this too.
- App Review guideline 5.1.3: HealthKit data isn't used for advertising, isn't shared, isn't stored in iCloud,
  and there's a privacy policy (https://getaltiro.app/privacy.html#health).

**Google Play → App content → Health Connect** (shown once the app uses Health Connect permissions). Declare
these five permissions and why:

| Permission | Why Altiro needs it |
|---|---|
| `READ_EXERCISE` | To find runs recorded on the user's watch, so they're logged to their training plan. |
| `READ_DISTANCE` | The distance of those runs. |
| `READ_ACTIVE_CALORIES_BURNED` | Calories burned during those runs, saved and shown with each run (and read together with the distance). |
| `READ_TOTAL_CALORIES_BURNED` | The same, from devices that only record total calories. |
| `READ_STEPS` | To show the user's steps for today on the Today screen. |

- Use case: **Fitness / activity tracking**. Altiro doesn't write any data.
- Privacy policy URL: https://getaltiro.app/privacy.html#health (the app also shows it from Health Connect's
  permission screen).
- Google may ask for a short video showing the feature: record Settings → Connected Apps → Connect Health
  Connect → allow → a run from your watch appearing in the plan. Upload it to YouTube as **Unlisted**.
- The Data safety form above already covers it (**Fitness info**). Health Connect data is never shared or
  sold, and isn't used for ads or AI.

## Ratings

**Apple age rating questionnaire:** every content question → **None** / **No**. Unrestricted web access → **No**.
Gambling → **No**. Result: **4+**. (The Terms say 13+; that's fine, the rating is about content.)

**Google content rating (IARC):** category **"All Other App Types"**. Answer **No** to violence, sexuality, language, controlled substances, gambling,
user-to-user communication, sharing location with other users and digital purchases. Expected result: **Everyone** / **PEGI 3**.

**Google target audience:** ages **13–15, 16–17, 18 and over** (not under 13). Not designed for children.

## Other Google Play declarations
- Ads: **No ads**.
- App access: **Some functionality is restricted** → give the reviewer the demo account (see review-notes.md).
- Health apps declaration: **Fitness** (activity and exercise tracking). Not a medical device. Also tick
  that the app uses **Health Connect** (see the Health Connect section above).
- Government app: No. Financial features: None. News app: No.

## Location permissions (GPS run tracking)

**Google Play Console → App content → Foreground service permissions:** Altiro uses
`FOREGROUND_SERVICE_LOCATION`. Choose **Location** → "User-initiated location sharing / fitness tracking"
(the wording varies). Description to paste:

> When the user starts tracking a run, Altiro shows a "tracking your run" notification and keeps measuring
> the run's distance, pace and route with GPS until the user finishes it, including while the screen is
> locked. Location is not used at any other time.

Google asks for a short video link: record the phone screen while you start a GPS run, lock the phone, unlock
it, and finish the run. Upload it to YouTube as **Unlisted** and paste the link.

Altiro does **not** request `ACCESS_BACKGROUND_LOCATION`, so the separate background-location declaration
doesn't apply.

**Apple (App Review notes):** see `review-notes.md`. The app uses the "location" background mode only
while a run the user started is being tracked.
