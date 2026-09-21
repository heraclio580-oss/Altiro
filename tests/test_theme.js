const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  console.log('Default theme is dark (no data-theme attr, or "dark"):', (doc.getElementById('device').getAttribute('data-theme')||'dark')==='dark' ? 'OK' : 'FAIL');

  goPill('settings');
  await wait(20);
  const toggle = doc.getElementById('themeToggle');
  console.log('Theme toggle exists on Settings:', !!toggle ? 'OK' : 'FAIL');
  console.log('Toggle starts off (dark mode):', !toggle.classList.contains('on') ? 'OK' : 'FAIL');

  toggle.click();
  await wait(10);
  console.log('Toggle turns on after click:', toggle.classList.contains('on') ? 'OK' : 'FAIL');
  console.log('device data-theme is now light:', doc.getElementById('device').getAttribute('data-theme')==='light' ? 'OK' : 'FAIL');

  // Persistence: saved to localStorage and read back by loadTheme() on a fresh load.
  const saved = window.localStorage.getItem('altiro_theme');
  console.log('Theme persisted to localStorage:', saved==='light' ? 'OK' : 'FAIL');

  // Navigating around should not reset the theme.
  goPill('home');
  await wait(20);
  goPill('calendar');
  await wait(20);
  console.log('Theme stays light while navigating:', doc.getElementById('device').getAttribute('data-theme')==='light' ? 'OK' : 'FAIL');

  // Toggle back off.
  goPill('settings');
  await wait(20);
  doc.getElementById('themeToggle').click();
  await wait(10);
  console.log('Toggling again returns to dark:', doc.getElementById('device').getAttribute('data-theme')==='dark' ? 'OK' : 'FAIL');
  console.log('localStorage updated back to dark:', window.localStorage.getItem('altiro_theme')==='dark' ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
