const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Mirrors of the app's internal date helpers so the test can compute a future date's key without
// reaching into the IIFE (same pattern used by test_plan_weeks.js).
const TODAY = new Date(2026,8,18); // Friday, Sep 18 2026 -- matches __ALTIRO_TEST_TODAY__
function dateKeyGlobal(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
// 8 weeks ahead, same weekday -- the auto-generated plan assigns a training weekday's session
// title from a fixed pool index that never changes week to week (see sessionForDate), so the SAME
// weekday always gets the SAME title. That makes this a reliable way to compare two occurrences of
// one title far enough apart that their exercise-rotation seed differs.
const FUTURE = new Date(TODAY); FUTURE.setDate(FUTURE.getDate() + 8*7);

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  const todayTitle = doc.getElementById('sessionCard').querySelector('.title').textContent;
  const todayIsStrength = !!doc.querySelector('#sessionCard .r-exercise-list');
  console.log('Today\'s session has a structured exercise breakdown to compare:', todayIsStrength ? `OK (${todayTitle})` : `SKIP (not a strength session this run: ${todayTitle})`);
  if(!todayIsStrength){ console.log('ALL DONE'); process.exit(0); }

  // Capture today's exercises via Day Detail (same underlying exercisesForSession() call the
  // session card itself uses, just isolated here for a clean before/after read).
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  const todayExercises = [...doc.querySelectorAll('#dayDetailPlanRow .r-exercise-list li')].map(li=>li.textContent);
  console.log('Today\'s Day Detail shows the same exercise count as Home:', todayExercises.length===doc.querySelectorAll('#sessionCard .r-exercise-list li').length ? `OK (${todayExercises.length})` : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // Navigate the calendar forward to the future date (same weekday, 8 weeks out -- guaranteed the
  // same session title) and open its Day Detail.
  const MONTHS_FULL_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  goPill('calendar');
  await wait(20);
  const targetRange = `${MONTHS_FULL_EN[FUTURE.getMonth()]} ${FUTURE.getFullYear()}`;
  let guard = 0;
  while(doc.getElementById('calRange').textContent !== targetRange && guard++ < 12){
    doc.getElementById('calNext').click();
    await wait(20);
  }
  const futureKey = dateKeyGlobal(FUTURE);
  const futureCell = doc.querySelector(`#calGrid .mo-cell[data-date="${futureKey}"]`);
  console.log('Found the future date on the calendar:', !!futureCell ? 'OK' : `FAIL (looking for ${futureKey}, range shown: ${doc.getElementById('calRange').textContent})`);
  futureCell.click();
  await wait(20);

  const futureExercises = [...doc.querySelectorAll('#dayDetailPlanRow .r-exercise-list li')].map(li=>li.textContent);
  console.log('8 weeks out, the same weekday still shows a structured strength session:', futureExercises.length>0 ? `OK (${futureExercises.length} exercises)` : `FAIL (${doc.getElementById('dayDetailPlanRow').textContent})`);
  console.log('Same exercise slot COUNT as today (same session title/template):', futureExercises.length===todayExercises.length ? 'OK' : `FAIL (${futureExercises.length} vs ${todayExercises.length})`);
  console.log('But the actual exercise PICKS differ from today -- the rotation is doing something, not repeating the exact same workout forever:',
    JSON.stringify(futureExercises) !== JSON.stringify(todayExercises) ? 'OK' : `FAIL (identical: ${JSON.stringify(todayExercises)})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
