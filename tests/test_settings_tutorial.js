const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Get past onboarding into the real app first, since Settings is only reachable post-onboarding.
  goPill('home');
  await wait(20);
  console.log('Home screen is active (post-onboarding state):', doc.getElementById('screen-home').hidden===false ? 'OK' : 'FAIL');

  goPill('settings');
  await wait(20);
  console.log('Settings screen shows a "See how it works" entry point:', !!doc.getElementById('settingsTutorialBtn') ? 'OK' : 'FAIL');

  doc.getElementById('settingsTutorialBtn').click();
  await wait(10);
  console.log('Tutorial overlay opens from Settings:', doc.getElementById('tutorialOverlay').hidden===false ? 'OK' : 'FAIL');

  const nextBtn = doc.getElementById('tutorialNext');
  for(let i=0;i<4;i++){ nextBtn.click(); await wait(10); }
  console.log('On the last slide, button reads "Done" (not "Get Started") when opened from Settings:', nextBtn.textContent==='Done' ? 'OK' : `FAIL (${nextBtn.textContent})`);

  nextBtn.click();
  await wait(10);
  console.log('Clicking "Done" closes the tutorial:', doc.getElementById('tutorialOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('User stays on Settings (NOT bounced into onboarding):', doc.getElementById('screen-settings').hidden===false ? 'OK' : 'FAIL');
  console.log('Onboarding goal screen was NOT triggered:', doc.getElementById('screen-onb-goal').hidden===true ? 'OK' : 'FAIL');

  // --- Sanity: opening from Welcome still behaves exactly as before (Get Started -> onboarding) ---
  goPill('welcome');
  await wait(20);
  doc.getElementById('openTutorialBtn').click();
  await wait(10);
  for(let i=0;i<4;i++){ doc.getElementById('tutorialNext').click(); await wait(10); }
  console.log('From Welcome, last-slide button still reads "Get Started":', doc.getElementById('tutorialNext').textContent==='Get Started' ? 'OK' : `FAIL (${doc.getElementById('tutorialNext').textContent})`);
  doc.getElementById('tutorialNext').click();
  await wait(10);
  console.log('From Welcome, finishing the tutorial still proceeds into onboarding:', doc.getElementById('screen-onb-goal').hidden===false ? 'OK' : 'FAIL');

  // --- Re-opening from Settings after having gone through the Welcome flow still says "Done" (origin re-evaluated each open) ---
  goPill('settings');
  await wait(20);
  doc.getElementById('settingsTutorialBtn').click();
  await wait(10);
  for(let i=0;i<4;i++){ doc.getElementById('tutorialNext').click(); await wait(10); }
  console.log('Re-opening from Settings again after a Welcome-origin open still reads "Done" (origin tracked per-open, not stale):', doc.getElementById('tutorialNext').textContent==='Done' ? 'OK' : `FAIL (${doc.getElementById('tutorialNext').textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
