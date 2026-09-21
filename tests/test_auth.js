const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Covers the real Supabase auth wiring added to the Account onboarding step. Since jsdom doesn't
// execute the external Supabase CDN script, the app's own offline-stub client is exercised here --
// which is exactly the code path a real user hits if the CDN is blocked, so this doubles as a
// graceful-degradation test.
(async () => {
  await wait(80); // allow the async initAuth() session check to resolve
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  console.log('App did not crash on load despite no real Supabase client:', doc.getElementById('screen-welcome').hidden===false ? 'OK' : `FAIL (screen: ${[...doc.querySelectorAll('.screen')].find(s=>!s.hidden)?.id})`);

  goPill('onb-account');
  await wait(20);
  console.log('Reached the Account step:', doc.getElementById('screen-onb-account').hidden===false ? 'OK' : 'FAIL');
  console.log('Sign-up is the default mode:', doc.getElementById('emailSignupBtn').textContent === 'Create Account' ? 'OK' : `FAIL (${doc.getElementById('emailSignupBtn').textContent})`);

  // Toggle to sign-in mode and back, confirming the UI actually flips.
  doc.getElementById('toggleAuthMode').click();
  console.log('Toggling to sign-in mode updates the button label:', doc.getElementById('emailSignupBtn').textContent === 'Sign In' ? 'OK' : `FAIL (${doc.getElementById('emailSignupBtn').textContent})`);
  console.log('Toggle link itself now offers to switch back to sign-up:', doc.getElementById('toggleAuthMode').textContent === 'Need an account? Create one' ? 'OK' : 'FAIL');
  doc.getElementById('toggleAuthMode').click();
  console.log('Toggling back restores sign-up mode:', doc.getElementById('emailSignupBtn').textContent === 'Create Account' ? 'OK' : 'FAIL');

  // Attempt a real signup call against the offline stub -- should surface a graceful error,
  // not throw or silently pretend success.
  doc.getElementById('emailInput').value = 'test@example.com';
  doc.getElementById('emailInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('passwordInput').value = 'testpass123';
  doc.getElementById('passwordInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  console.log('Create Account button enables once both fields are filled:', !doc.getElementById('emailSignupBtn').disabled ? 'OK' : 'FAIL');

  doc.getElementById('emailSignupBtn').click();
  await wait(50);
  console.log('Offline stub surfaces a graceful auth error (no crash, no false success):', doc.getElementById('authError').textContent.length > 0 ? `OK (${doc.getElementById('authError').textContent})` : 'FAIL');
  console.log('Still on the Account screen (did not falsely navigate to Loading/Home):', doc.getElementById('screen-onb-account').hidden===false ? 'OK' : 'FAIL');
  console.log('Did not falsely land on Home after a failed auth attempt:', doc.getElementById('screen-home').hidden===true ? 'OK' : 'FAIL');
  console.log('Button re-enabled after the failed attempt:', !doc.getElementById('emailSignupBtn').disabled ? 'OK' : 'FAIL');

  // Sign-in mode against the offline stub should fail just as gracefully.
  doc.getElementById('toggleAuthMode').click();
  doc.getElementById('emailSignupBtn').click();
  await wait(50);
  console.log('Sign-in attempt against the offline stub also surfaces a graceful error:', doc.getElementById('authError').textContent.length > 0 ? 'OK' : 'FAIL');

  // Google button should also fail gracefully rather than fake a successful sign-in.
  doc.getElementById('googleSignInBtn').click();
  await wait(50);
  console.log('Google sign-in against the offline stub surfaces a graceful error, not a fake success:', doc.getElementById('authError').textContent.length > 0 && doc.getElementById('screen-home').hidden===true ? 'OK' : 'FAIL');
  console.log('Google button re-enabled after the failed attempt:', !doc.getElementById('googleSignInBtn').disabled ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
