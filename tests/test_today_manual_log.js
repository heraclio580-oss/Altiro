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
  const todayCellBefore = doc.querySelector('#weekStrip .day-cell.today');
  console.log('Before logging anything, today is still "today" not "done":', !!todayCellBefore && !todayCellBefore.classList.contains('done') ? 'OK' : 'FAIL');
  const todayDayIdx = todayCellBefore.getAttribute('data-day');

  goPill('calendar');
  await wait(20);
  const calTodayCellBefore = doc.querySelector('#calGrid .mo-cell.today');
  console.log('Calendar: today\'s cell also starts as "today" not "done":', !!calTodayCellBefore && !calTodayCellBefore.classList.contains('done') ? 'OK' : 'FAIL');
  const todayDateKey = calTodayCellBefore.getAttribute('data-date');

  // Log a manual workout for today via Home's "+ Add a Workout" button (NOT the Record Workout flow).
  goPill('home');
  await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Extra Cardio';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  // Create Workout always defaults to "just planned" now -- mark it done so this becomes a real
  // logged entry, which is what actually flips today to "done" (the thing this test verifies).
  if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  goPill('home');
  await wait(20);
  const todayCellAfter = doc.querySelector(`#weekStrip .day-cell[data-day="${todayDayIdx}"]`);
  console.log('After a manual log (no Record Workout press), today\'s specific cell flips to "done":', todayCellAfter.classList.contains('done') ? 'OK' : `FAIL (${todayCellAfter.className})`);
  console.log('That same cell still carries "today" (blue ring persists once done):', todayCellAfter.classList.contains('today') ? 'OK' : 'FAIL');

  goPill('calendar');
  await wait(20);
  const calTodayCellAfter = doc.querySelector(`#calGrid .mo-cell[data-date="${todayDateKey}"]`);
  console.log('Calendar agrees: today\'s specific cell is now "done" from the manual log alone:', calTodayCellAfter.classList.contains('done') ? 'OK' : `FAIL (${calTodayCellAfter.className})`);
  console.log('Calendar\'s today cell still carries "today" (blue ring persists once done):', calTodayCellAfter.classList.contains('today') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
