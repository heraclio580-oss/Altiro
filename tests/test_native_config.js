const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// scripts/native-config.js adds the altiro:// link scheme to the iOS and Android projects (which aren't
// kept in git, so it's re-applied after every `npx cap sync`), and keeps phones in portrait: once, in the
// right place, and safely re-runnable. Checked against fresh copies of the files Capacitor generates.
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altiro-native-'));
fs.mkdirSync(path.join(root, 'ios', 'App', 'App'), {recursive:true});
fs.mkdirSync(path.join(root, 'android', 'app', 'src', 'main'), {recursive:true});
const plist = path.join(root, 'ios', 'App', 'App', 'Info.plist'), manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>CFBundleDisplayName</key>\n\t<string>Altiro</string>\n\t<key>UISupportedInterfaceOrientations</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t\t<string>UIInterfaceOrientationLandscapeLeft</string>\n\t\t<string>UIInterfaceOrientationLandscapeRight</string>\n\t</array>\n\t<key>UISupportedInterfaceOrientations~ipad</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t\t<string>UIInterfaceOrientationPortraitUpsideDown</string>\n\t\t<string>UIInterfaceOrientationLandscapeLeft</string>\n\t\t<string>UIInterfaceOrientationLandscapeRight</string>\n\t</array>\n\t<key>UIViewControllerBasedStatusBarAppearance</key>\n\t<true/>\n</dict>\n</plist>\n`);
fs.writeFileSync(manifest, `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n        <activity\n            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"\n            android:name=".MainActivity"\n            android:launchMode="singleTask"\n            android:exported="true">\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n        </activity>\n    </application>\n</manifest>\n`);
// The health plugin declares far more Health Connect permissions than Altiro reads; only the 5 it reads stay.
const pluginDir = path.join(root, 'node_modules', '@capgo', 'capacitor-health', 'android', 'src', 'main');
fs.mkdirSync(pluginDir, {recursive:true});
const pluginPerms = ['READ_STEPS','WRITE_STEPS','READ_DISTANCE','READ_EXERCISE','READ_ACTIVE_CALORIES_BURNED','READ_TOTAL_CALORIES_BURNED','READ_WEIGHT','READ_VO2_MAX','WRITE_VO2_MAX','READ_HEART_RATE'];
fs.writeFileSync(path.join(pluginDir, 'AndroidManifest.xml'), `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n${pluginPerms.map(x=> `    <uses-permission android:name="android.permission.health.${x}" />`).join('\n')}\n</manifest>\n`);
// The App target's build settings, as Capacitor 8 makes them (Debug and Release).
const pbx = path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
fs.mkdirSync(path.dirname(pbx), {recursive:true});
const target = cfg=> `\t\t${cfg} /* ${cfg} */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n\t\t\t\tCURRENT_PROJECT_VERSION = 1;\n\t\t\t\tINFOPLIST_FILE = App/Info.plist;\n\t\t\t\tMARKETING_VERSION = 1.0;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.altiro.app;\n\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";\n\t\t\t};\n\t\t};\n`;
fs.writeFileSync(pbx, `// !$*UTF8*$!\n{\n\tobjects = {\n${target('Debug')}${target('Release')}\t};\n}\n`);
const run = (env) => execFileSync('node', [path.join(__dirname, '..', 'scripts', 'native-config.js')], {env: {...process.env, ALTIRO_NATIVE_ROOT: root, ALTIRO_VERSION_NAME: '', ALTIRO_BUILD_NUMBER: '', ...(env || {})}, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
run();
const p1 = fs.readFileSync(plist, 'utf8'), m1 = fs.readFileSync(manifest, 'utf8');
check('iOS: the altiro URL scheme is registered', /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>altiro<\/string>/.test(p1) && /<\/dict>\s*<\/plist>\s*$/.test(p1));
check('Android: MainActivity opens altiro:// links', /<activity[\s\S]*<data android:scheme="altiro" \/>[\s\S]*<\/activity>/.test(m1) && /android\.intent\.action\.VIEW/.test(m1) && /category\.BROWSABLE/.test(m1));
check('iOS: location permission text, and location allowed in the background, for GPS runs', /<key>NSLocationWhenInUseUsageDescription<\/key>\s*<string>[^<]+<\/string>/.test(p1) && /<key>NSLocationAlwaysAndWhenInUseUsageDescription<\/key>/.test(p1) && /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>location<\/string>\s*<\/array>/.test(p1));
check('iOS: Photos permission text is there, for saving workout cards', /<key>NSPhotoLibraryAddUsageDescription<\/key>\s*<string>[^<]+<\/string>/.test(p1) && /<key>NSPhotoLibraryUsageDescription<\/key>/.test(p1) && /<\/dict>\s*<\/plist>\s*$/.test(p1));
check('Android: the app stays in portrait (on MainActivity)', /<activity\b[^>]*android:screenOrientation="portrait"[^>]*android:name="\.MainActivity"/.test(m1) && (m1.match(/screenOrientation/g) || []).length===1);
const removed = [...m1.matchAll(/android\.permission\.health\.([A-Z0-9_]+)" tools:node="remove"/g)].map(m=> m[1]).sort();
check('Android: unused Health Connect permissions are removed, VO2 max included (a name with a digit)', removed.join()==='READ_HEART_RATE,READ_VO2_MAX,READ_WEIGHT,WRITE_STEPS,WRITE_VO2_MAX', removed.join());
check('...the 5 Altiro reads are kept', ['READ_STEPS','READ_DISTANCE','READ_EXERCISE','READ_ACTIVE_CALORIES_BURNED','READ_TOTAL_CALORIES_BURNED'].every(x=> !removed.includes(x)) && /xmlns:tools=/.test(m1));
const phone = (p1.match(/<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/) || [])[1] || '';
const pad = (p1.match(/<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>([\s\S]*?)<\/array>/) || [])[1] || '';
check('iOS: iPhone stays in portrait', phone.replace(/\s+/g, '')==='<string>UIInterfaceOrientationPortrait</string>', phone);
check('iOS: iPad\'s own list is untouched', (pad.match(/<string>/g) || []).length===4 && /<\/dict>\s*<\/plist>\s*$/.test(p1));
check('iOS: no export-compliance question at every upload (standard HTTPS only)', /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(p1));
const x1 = fs.readFileSync(pbx, 'utf8');
check('iOS: iPhone only (an iPad runs the iPhone app), in both builds', (x1.match(/TARGETED_DEVICE_FAMILY = 1;/g) || []).length===2 && !/"1,2"/.test(x1));
check('iOS: signed with the HealthKit entitlement', (x1.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g) || []).length===2);
check('...no version given: the version and build number stay as they were', /MARKETING_VERSION = 1\.0;/.test(x1) && /CURRENT_PROJECT_VERSION = 1;/.test(x1));
run();
check('Running it again changes nothing', fs.readFileSync(plist, 'utf8')===p1 && fs.readFileSync(manifest, 'utf8')===m1 && fs.readFileSync(pbx, 'utf8')===x1);
// The cloud build gives the version and build number.
run({ALTIRO_VERSION_NAME: '1.0.10', ALTIRO_BUILD_NUMBER: '7'});
const x2 = fs.readFileSync(pbx, 'utf8');
check('iOS: the cloud build\'s version (1.0.10) and build number (7), in both builds', (x2.match(/MARKETING_VERSION = 1\.0\.10;/g) || []).length===2 && (x2.match(/CURRENT_PROJECT_VERSION = 7;/g) || []).length===2);
let refused = false;
try{ run({ALTIRO_VERSION_NAME: 'v1'}); }catch(e){ refused = true; }
check('...a version that isn\'t like 1.0.0 is refused', refused);
fs.rmSync(root, {recursive:true, force:true});
console.log(failures ? `${failures} FAILED` : 'ALL DONE');
