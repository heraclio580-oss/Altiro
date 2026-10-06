# Running `npm install` and `npm run cap:sync` on your computer

These two commands get the store apps (iPhone and Android) ready to build. You only need them for the
store apps. The website updates by itself whenever code is pushed.

> **Before your very first build:** ask Claude to **"set up watches and health"** first (Capacitor 8 upgrade,
> Apple Health / Health Connect for watches and steps). See section 4 of `docs/launch-checklist.md`.

## 1. Install the tools (first time only)

| Tool | Where | Notes |
|---|---|---|
| **Node.js** (LTS version, 20 or newer) | https://nodejs.org | Comes with `npm`. Use the big "LTS" download button. |
| **Git** | https://git-scm.com/downloads | On a Mac it may already be there: type `git --version` in Terminal. |
| **Android Studio** | https://developer.android.com/studio | For the Android app. Works on Windows, Mac or Linux. |
| **Xcode** + CocoaPods | Mac App Store (Xcode), then `sudo gem install cocoapods` in Terminal | For the iPhone app. **Mac only.** |

Check that Node.js installed: open a terminal (Windows: **PowerShell**; Mac: **Terminal**) and type:

```bash
node --version
npm --version
```

Both should print a version number.

## 2. Get the code (first time only)

In the terminal, go to the folder where you want the project (for example your Documents folder), then
copy the project from GitHub:

```bash
cd Documents
git clone https://github.com/heraclio580-oss/Altiro.git
cd Altiro
```

Already have it? Just go into the folder and get the latest version instead:

```bash
cd Documents/Altiro
git pull
```

## 3. Install the app's packages

```bash
npm install
```

This downloads everything the app uses, including the new share and "Save to Photos" plugins. It takes
a minute or two. Warnings in yellow are normal; red **ERR!** lines are not.

## 4. Create the phone projects (first time only)

```bash
npx cap add android
npx cap add ios          # Mac only
```

## 5. Sync

```bash
npm run cap:sync
```

This copies the app into the Android and iPhone projects, installs the plugins there, and adds the
`altiro://` link and the Photos permission text. When it ends you should see lines like
`iOS: added the Photos permission text to Info.plist` and `Done.`

## 6. Icons, then open and build (first time, or after a new logo)

```bash
npm run assets
npx cap open android     # opens Android Studio
npx cap open ios         # opens Xcode (Mac only)
```

## Every time after that

```bash
git pull
npm install
npm run cap:sync
```

## If something goes wrong

- **`npm` is not recognized / command not found**: Node.js isn't installed, or the terminal was open
  before installing it. Close the terminal, open a new one, and try again.
- **`ios` platform has not been added yet** (or the same for android): run step 4 first.
- **CocoaPods errors on a Mac**: run `sudo gem install cocoapods`, then `npm run cap:sync` again.
- Anything else: copy the red error lines and send them to me.
