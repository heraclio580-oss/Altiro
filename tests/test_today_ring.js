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

  goPill('calendar');
  await wait(20);
  const todayCell = () => doc.querySelector('#calGrid .mo-cell.today');
  console.log('Today cell has the "today" class before completing anything:', !!todayCell() ? 'OK' : 'FAIL');
  console.log('Today cell is NOT marked "done" yet:', !doc.querySelector('#calGrid .mo-cell.done.today') ? 'OK' : 'FAIL');

  // Home week strip should agree: today cell has 'today' class, not 'done'.
  goPill('home');
  await wait(20);
  const homeTodayCell = doc.querySelector('#weekStrip .day-cell.today');
  console.log('Home week strip: today cell has "today" class before completing:', !!homeTodayCell ? 'OK' : 'FAIL');

  // Plan list: today's row should show the "TODAY" badge, not a done checkmark.
  goPill('week');
  await wait(20);
  console.log('Plan row for today shows the TODAY badge before completing:', !!doc.querySelector('.plan-row.today .prow-status.today') ? 'OK' : 'FAIL');
  console.log('Plan row for today has no done checkmark yet:', !doc.querySelector('.plan-row.today .prow-status.done') ? 'OK' : 'FAIL');

  // --- Complete today's workout via Record Workout ---
  goPill('home');
  await wait(20);
  const recordBtn = doc.getElementById('recordBtn');
  console.log('Record button is actionable (not disabled) before completing:', !recordBtn.classList.contains('disabled') ? 'OK' : 'FAIL');
  recordBtn.click();
  await wait(950); // "recording" pulse delay, then the Log Performance sheet opens
  doc.getElementById('saveLogPerf').click(); // accept the seeded defaults -> startWorkout() fires, navigates to summary
  await wait(50);

  goPill('home');
  await wait(20);
  const homeTodayCellAfter = doc.querySelector('#weekStrip .day-cell[data-day]');
  const idxToday = [...doc.querySelectorAll('#weekStrip .day-cell')].findIndex(c=>c.classList.contains('done') || c.classList.contains('today'));

  // Today should now show BOTH "done" (green dot, since it's completed) and "today" (blue ring stays,
  // since it's still the current day) -- the blue ring marks which day is today independently of
  // whether that day's workout is done yet.
  const homeCellsAfter = [...doc.querySelectorAll('#weekStrip .day-cell')];
  const doneCell = homeCellsAfter.find(c=>c.classList.contains('done'));
  console.log('Home week strip: some cell is now marked "done" after completing today:', !!doneCell ? 'OK' : 'FAIL');
  console.log('Home week strip: that same cell still carries "today" (blue ring persists after completing):', doneCell && doneCell.classList.contains('today') ? 'OK' : 'FAIL');

  goPill('week');
  await wait(20);
  console.log('Plan row for today now shows the done checkmark, not the TODAY badge:', !!doc.querySelector('.prow-status.done') && !doc.querySelector('.prow-status.today') ? 'OK' : 'FAIL');
  console.log('That row still carries the "today" class itself (blue accent stays on the row):', !!doc.querySelector('.plan-row.today.done') ? 'OK' : 'FAIL');

  goPill('calendar');
  await wait(20);
  console.log("Calendar: today's cell now carries BOTH done (green dot) and today (blue ring):", !!doc.querySelector('#calGrid .mo-cell.done.today') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
