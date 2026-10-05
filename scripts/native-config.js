// Native project settings that live outside www/ -- run after `npx cap add` / `npx cap sync` (the
// `npm run cap:sync` script does). The ios/ and android/ projects aren't kept in git, so this is how
// these settings come back on a fresh checkout. Safe to run more than once.
//
//   altiro:// links open the app -- how Strava's sign-in, and the "Open Altiro" button shown after
//   confirming an email, hand the user back to the store app (see handleAppLink in www/index.html).
//   iOS's Photos permission text -- for saving a workout card straight to Photos.
const fs = require('fs');
const path = require('path');
const root = process.env.ALTIRO_NATIVE_ROOT || path.join(__dirname, '..');
const SCHEME = 'altiro';
let changed = 0;

const plist = path.join(root, 'ios', 'App', 'App', 'Info.plist');
if(fs.existsSync(plist)){
  let s = fs.readFileSync(plist, 'utf8');
  if(!s.includes(`<string>${SCHEME}</string>`)){
    const entry = `\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>com.altiro.app</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${SCHEME}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n`;
    s = s.replace(/<\/dict>\s*<\/plist>\s*$/, entry + '</dict>\n</plist>\n');
    fs.writeFileSync(plist, s); changed++;
    console.log('iOS: added the altiro:// URL scheme to Info.plist');
  } else console.log('iOS: altiro:// URL scheme already set');
  // "Save to Photos" on the workout card (@capacitor-community/media) asks to add a picture to Photos;
  // iOS shows these lines in that permission prompt, and the App Store requires them.
  const PHOTO_KEYS = {
    NSPhotoLibraryAddUsageDescription: 'Altiro saves your workout cards to Photos so you can share them.',
    NSPhotoLibraryUsageDescription: 'Altiro saves your workout cards to Photos so you can share them.',
  };
  s = fs.readFileSync(plist, 'utf8');
  const missing = Object.keys(PHOTO_KEYS).filter(k=> !s.includes(`<key>${k}</key>`));
  if(missing.length){
    const entry = missing.map(k=> `\t<key>${k}</key>\n\t<string>${PHOTO_KEYS[k]}</string>\n`).join('');
    s = s.replace(/<\/dict>\s*<\/plist>\s*$/, entry + '</dict>\n</plist>\n');
    fs.writeFileSync(plist, s); changed++;
    console.log('iOS: added the Photos permission text to Info.plist');
  } else console.log('iOS: Photos permission text already set');
} else console.log('iOS: no ios/ project here (run `npx cap add ios` first) -- skipped');

const manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if(fs.existsSync(manifest)){
  let s = fs.readFileSync(manifest, 'utf8');
  if(!s.includes(`android:scheme="${SCHEME}"`)){
    const filter = `\n            <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="${SCHEME}" />\n            </intent-filter>\n`;
    // Into MainActivity, right after its launcher intent-filter.
    s = s.replace(/(<category android:name="android\.intent\.category\.LAUNCHER" \/>\s*<\/intent-filter>)/, `$1${filter}`);
    if(!s.includes(`android:scheme="${SCHEME}"`)) throw new Error("Android: couldn't find MainActivity's launcher intent-filter");
    fs.writeFileSync(manifest, s); changed++;
    console.log('Android: added the altiro:// intent filter to AndroidManifest.xml');
  } else console.log('Android: altiro:// intent filter already set');
} else console.log('Android: no android/ project here (run `npx cap add android` first) -- skipped');

console.log(changed ? 'Done.' : 'Nothing to change.');
