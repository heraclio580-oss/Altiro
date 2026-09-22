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

  console.log('Day Detail starts closed:', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');

  // Tapping the workout title/description on Home should open the same Day Detail sheet as
  // tapping today's cell in the week strip -- not just the exercise list, the title too.
  doc.getElementById('sessionCard').querySelector('.title').click();
  await wait(20);
  console.log('Tapping the workout title opens Day Detail for today:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Day Detail shows today\'s date:', doc.getElementById('dayDetailTitle').textContent.includes('18') ? 'OK' : `FAIL (${doc.getElementById('dayDetailTitle').textContent})`);
  doc.getElementById('closeDayDetail').click();
  await wait(20);

  // Tapping the exercise list (also inside the description region) should do the same.
  const exList = doc.querySelector('#sessionCard .r-exercise-list');
  if(exList){
    exList.click();
    await wait(20);
    console.log('Tapping the exercise list also opens Day Detail:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
    doc.getElementById('closeDayDetail').click();
    await wait(20);
  } else {
    console.log('Tapping the exercise list also opens Day Detail: SKIP (no exercise list for today\'s session type)');
  }

  // Buttons inside the card (outside the description region) must keep their own behavior, not
  // also trigger Day Detail.
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  console.log('The "+ Create Workout" button still opens Create Workout, not Day Detail:', doc.getElementById('manualEntryOverlay').hidden===false && doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');
  doc.getElementById('closeManualEntry').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
