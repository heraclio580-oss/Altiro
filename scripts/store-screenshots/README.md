# Store screenshots

Re-shoots the six store screenshots with a demo account, in English and Spanish, at the App Store's 6.7"
iPhone size (1290x2796) and Google Play's phone size (1080x1920), into `docs/store/screenshots/`.
Needs Playwright (`npm i -D playwright && npx playwright install chromium`, or set `CHROMIUM` to a Chrome
binary) and the site served locally:

```bash
npx serve www -l 8765 &          # or: cd www && python3 -m http.server 8765
npm run store-screenshots
```

Captions are in `compose.js` (keep them in step with `docs/store/listing.md`). The demo account's profile is
in `capture.js`, and its workout history comes from the app's own plan engine (`demo-data.js`).
