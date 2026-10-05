const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// scripts/native-config.js adds the altiro:// link scheme to the iOS and Android projects (which aren't
// kept in git, so it's re-applied after every `npx cap sync`): once, in the right place, and safely
// re-runnable. Checked against fresh copies of the files Capacitor generates.
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'altiro-native-'));
fs.mkdirSync(path.join(root, 'ios', 'App', 'App'), {recursive:true});
fs.mkdirSync(path.join(root, 'android', 'app', 'src', 'main'), {recursive:true});
const plist = path.join(root, 'ios', 'App', 'App', 'Info.plist'), manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>CFBundleDisplayName</key>\n\t<string>Altiro</string>\n\t<key>UIViewControllerBasedStatusBarAppearance</key>\n\t<true/>\n</dict>\n</plist>\n`);
fs.writeFileSync(manifest, `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n        <activity android:name=".MainActivity" android:launchMode="singleTask" android:exported="true">\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n        </activity>\n    </application>\n</manifest>\n`);
const run = () => execFileSync('node', [path.join(__dirname, '..', 'scripts', 'native-config.js')], {env: {...process.env, ALTIRO_NATIVE_ROOT: root}, encoding: 'utf8'});
run();
const p1 = fs.readFileSync(plist, 'utf8'), m1 = fs.readFileSync(manifest, 'utf8');
check('iOS: the altiro URL scheme is registered', /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>altiro<\/string>/.test(p1) && /<\/dict>\s*<\/plist>\s*$/.test(p1));
check('Android: MainActivity opens altiro:// links', /<activity[\s\S]*<data android:scheme="altiro" \/>[\s\S]*<\/activity>/.test(m1) && /android\.intent\.action\.VIEW/.test(m1) && /category\.BROWSABLE/.test(m1));
run();
check('Running it again changes nothing', fs.readFileSync(plist, 'utf8')===p1 && fs.readFileSync(manifest, 'utf8')===m1);
fs.rmSync(root, {recursive:true, force:true});
console.log(failures ? `${failures} FAILED` : 'ALL DONE');
