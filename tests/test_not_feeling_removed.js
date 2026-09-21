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

  goPill('home');
  await wait(20);
  console.log('"Not feeling it today?" button no longer exists:', !doc.getElementById('notFeelingBtn') ? 'OK' : 'FAIL');
  console.log('Session card renders fine without it (no crash, no leftover badge markup):', !doc.getElementById('sessionCard').innerHTML.includes('badge-adj') ? 'OK' : 'FAIL');
  console.log('"+ Add a Workout" button still present as the alternative:', !!doc.getElementById('addTodayWorkoutBtn') ? 'OK' : 'FAIL');

  goPill('week');
  await wait(20);
  console.log('Plan/reschedule tools (drag handles) still present as the other alternative:', !!doc.querySelector('.drag-handle') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
