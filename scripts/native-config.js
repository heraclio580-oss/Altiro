// Native project settings that live outside www/ -- run after `npx cap add` / `npx cap sync` (the
// `npm run cap:sync` script does). The ios/ and android/ projects aren't kept in git, so this is how
// these settings come back on a fresh checkout. Safe to run more than once.
//
//   altiro:// links open the app -- how Strava's sign-in, and the "Open Altiro" button shown after
//   confirming an email, hand the user back to the store app (see handleAppLink in www/index.html).
//   iOS permission text (Photos, for saving workout cards; location, for GPS runs) and background location.
//   Apple Health (iOS) and Health Connect (Android), for runs and workouts from any watch and daily steps:
//   the HealthKit entitlement and its permission text; on Android only the five health permissions Altiro
//   reads (the plugin declares dozens), Android 8+ (Health Connect's minimum) and the privacy policy link
//   Health Connect shows on its permission screen.
//   Portrait only on phones: turning the phone sideways doesn't turn the app (iPad still turns -- Apple
//   expects that of iPad apps that allow multitasking).
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
  // Permission text iOS shows in its prompts (the App Store requires each one): Photos, for "Save to
  // Photos" on the workout card (@capacitor-community/media); location, for tracking runs with GPS
  // (@capacitor-community/background-geolocation).
  const TEXT_KEYS = {
    NSPhotoLibraryAddUsageDescription: 'Altiro saves your workout cards to Photos so you can share them.',
    NSPhotoLibraryUsageDescription: 'Altiro saves your workout cards to Photos so you can share them.',
    NSLocationWhenInUseUsageDescription: 'Altiro uses your location to map and measure your runs, and for your local weather.',
    NSLocationAlwaysAndWhenInUseUsageDescription: 'Altiro keeps tracking a run you started while your phone is locked, so the whole run is measured.',
    NSHealthShareUsageDescription: 'Altiro reads your workouts and steps from Apple Health, so runs from your watch count toward your plan.',
    NSHealthUpdateUsageDescription: 'Altiro only reads from Apple Health. It never writes to it.',
  };
  s = fs.readFileSync(plist, 'utf8');
  const missing = Object.keys(TEXT_KEYS).filter(k=> !s.includes(`<key>${k}</key>`));
  if(missing.length){
    const entry = missing.map(k=> `\t<key>${k}</key>\n\t<string>${TEXT_KEYS[k]}</string>\n`).join('');
    s = s.replace(/<\/dict>\s*<\/plist>\s*$/, entry + '</dict>\n</plist>\n');
    fs.writeFileSync(plist, s); changed++;
    console.log('iOS: added permission text to Info.plist: ' + missing.join(', '));
  } else console.log('iOS: permission text already set');
  // GPS keeps coming in with the screen locked during a run.
  s = fs.readFileSync(plist, 'utf8');
  if(!/<key>UIBackgroundModes<\/key>\s*<array>[\s\S]*?<string>location<\/string>/.test(s)){
    if(/<key>UIBackgroundModes<\/key>\s*<array>/.test(s)) s = s.replace(/(<key>UIBackgroundModes<\/key>\s*<array>)/, '$1\n\t\t<string>location</string>');
    else s = s.replace(/<\/dict>\s*<\/plist>\s*$/, '\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>location</string>\n\t</array>\n</dict>\n</plist>\n');
    fs.writeFileSync(plist, s); changed++;
    console.log('iOS: allowed location in the background (for runs being tracked)');
  } else console.log('iOS: background location already allowed');
  // Portrait only on iPhone (UISupportedInterfaceOrientations~ipad, iPad's own list, is left as it is).
  s = fs.readFileSync(plist, 'utf8');
  const PORTRAIT = '\t<key>UISupportedInterfaceOrientations</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>\n';
  const phoneList = /\t?<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>\n?/;
  const m = s.match(phoneList);
  if(!m || m[1].replace(/\s+/g, '')!=='<string>UIInterfaceOrientationPortrait</string>'){
    s = m ? s.replace(phoneList, PORTRAIT) : s.replace(/<\/dict>\s*<\/plist>\s*$/, PORTRAIT + '</dict>\n</plist>\n');
    fs.writeFileSync(plist, s); changed++;
    console.log('iOS: iPhone kept in portrait');
  } else console.log('iOS: iPhone already portrait only');
  // Apple Health: the HealthKit entitlement (Xcode's "HealthKit" capability), set up without Xcode.
  const ent = path.join(root, 'ios', 'App', 'App', 'App.entitlements');
  if(!fs.existsSync(ent) || !fs.readFileSync(ent, 'utf8').includes('com.apple.developer.healthkit')){
    fs.writeFileSync(ent, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.healthkit</key>
\t<true/>
\t<key>com.apple.developer.healthkit.access</key>
\t<array/>
</dict>
</plist>
`); changed++;
    console.log('iOS: added the HealthKit entitlement (App.entitlements)');
  } else console.log('iOS: HealthKit entitlement already set');
  const pbx = path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  if(fs.existsSync(pbx)){
    let p = fs.readFileSync(pbx, 'utf8');
    if(!p.includes('CODE_SIGN_ENTITLEMENTS')){
      p = p.replace(/(\n(\t+)INFOPLIST_FILE = App\/Info\.plist;)/g, '\n$2CODE_SIGN_ENTITLEMENTS = App/App.entitlements;$1');
      if(!p.includes('CODE_SIGN_ENTITLEMENTS')) throw new Error("iOS: couldn't find the App target's build settings");
      fs.writeFileSync(pbx, p); changed++;
      console.log('iOS: the App target signs with App.entitlements');
    } else console.log('iOS: entitlements already in the build settings');
  }
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
  // Portrait only: the app's screen doesn't turn when the phone does.
  s = fs.readFileSync(manifest, 'utf8');
  const activity = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/;
  const tag = (s.match(activity) || [])[0];
  if(!tag) throw new Error("Android: couldn't find MainActivity in AndroidManifest.xml");
  if(!tag.includes('android:screenOrientation="portrait"')){
    const fixed = /android:screenOrientation="[^"]*"/.test(tag) ? tag.replace(/android:screenOrientation="[^"]*"/, 'android:screenOrientation="portrait"') : tag.replace(/<activity\b/, '<activity android:screenOrientation="portrait"');
    s = s.replace(tag, fixed);
    fs.writeFileSync(manifest, s); changed++;
    console.log('Android: kept in portrait');
  } else console.log('Android: already portrait only');
  // Health Connect: only the permissions Altiro reads. The health plugin declares many more (weight, sleep,
  // blood pressure, writes...); Google Play wants each declared health permission justified, so the rest
  // are removed from the merged manifest.
  const HEALTH_KEEP = ['READ_EXERCISE', 'READ_STEPS', 'READ_DISTANCE', 'READ_ACTIVE_CALORIES_BURNED', 'READ_TOTAL_CALORIES_BURNED'];
  const pluginManifest = path.join(root, 'node_modules', '@capgo', 'capacitor-health', 'android', 'src', 'main', 'AndroidManifest.xml');
  if(fs.existsSync(pluginManifest)){
    s = fs.readFileSync(manifest, 'utf8');
    const declared = [...new Set((fs.readFileSync(pluginManifest, 'utf8').match(/android\.permission\.health\.[A-Z_]+/g) || []).map(x=> x.split('.').pop()))];
    const drop = declared.filter(x=> !HEALTH_KEEP.includes(x) && !s.includes(`android.permission.health.${x}"`));
    if(drop.length){
      if(!s.includes('xmlns:tools=')) s = s.replace(/<manifest\b/, '<manifest xmlns:tools="http://schemas.android.com/tools"');
      const lines = drop.map(x=> `    <uses-permission android:name="android.permission.health.${x}" tools:node="remove" />`).join('\n');
      s = s.replace(/(<manifest\b[^>]*>)/, `$1\n    <!-- Health Connect: only what Altiro reads (see scripts/native-config.js). -->\n${lines}`);
      fs.writeFileSync(manifest, s); changed++;
      console.log(`Android: kept ${HEALTH_KEEP.length} Health Connect permissions, removed ${drop.length} unused ones`);
    } else console.log('Android: Health Connect permissions already trimmed');
  }
  const strings = path.join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  if(fs.existsSync(strings)){
    let x = fs.readFileSync(strings, 'utf8');
    if(!x.includes('health_connect_privacy_policy_url')){
      x = x.replace(/<\/resources>/, '    <string name="health_connect_privacy_policy_url">https://getaltiro.app/privacy.html#health</string>\n</resources>');
      fs.writeFileSync(strings, x); changed++;
      console.log("Android: Health Connect's privacy policy link set");
    } else console.log("Android: Health Connect's privacy policy link already set");
  }
  // Health Connect needs Android 8 (API 26) or newer.
  const vars = path.join(root, 'android', 'variables.gradle');
  if(fs.existsSync(vars)){
    let v = fs.readFileSync(vars, 'utf8');
    const m = v.match(/minSdkVersion = (\d+)/);
    if(m && +m[1] < 26){
      v = v.replace(/minSdkVersion = \d+/, 'minSdkVersion = 26');
      fs.writeFileSync(vars, v); changed++;
      console.log('Android: minimum Android version raised to 8.0 (API 26) for Health Connect');
    } else console.log('Android: minimum Android version already 8.0 or newer');
  }
} else console.log('Android: no android/ project here (run `npx cap add android` first) -- skipped');

console.log(changed ? 'Done.' : 'Nothing to change.');
