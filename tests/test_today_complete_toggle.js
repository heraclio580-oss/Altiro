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
  const workoutsBefore = doc.getElementById('ovWorkoutsVal').textContent;
  const todayCellBefore = doc.querySelector('#weekStrip .day-cell.today');
  const todayDayIdx = todayCellBefore.getAttribute('data-day'); // TODAY_IDX, used to re-query after every re-render.
  todayCellBefore.click();
  await wait(20);

  console.log('Complete toggle section is now visible for today:', doc.getElementById('dayDetailCompleteSection').hidden===false ? 'OK' : 'FAIL');
  const toggle = doc.getElementById('dayCompleteToggle');
  console.log('Toggle starts OFF for an unfinished today:', !toggle.classList.contains('on') ? 'OK' : 'FAIL');
  console.log('"Start Workout" button is showing (today not yet done):', !!doc.getElementById('ddStartWorkoutBtn') ? 'OK' : 'FAIL');

  // --- Flip the toggle ON for today ---
  toggle.click();
  await wait(20);
  console.log('Toggle switches ON after click:', doc.getElementById('dayCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');
  console.log('"Start Workout" button disappears once toggled done:', !doc.getElementById('ddStartWorkoutBtn') ? 'OK' : 'FAIL');
  console.log('"Completed today" inline indicator now shows:', doc.getElementById('dayDetailActions').textContent.includes('Completed today') ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  goPill('home');
  await wait(20);
  const todayCellAfterOn = doc.querySelector(`#weekStrip .day-cell[data-day="${todayDayIdx}"]`);
  console.log('Home: today\'s specific cell shows "done" AND keeps its "today" blue ring:', todayCellAfterOn.classList.contains('done') && todayCellAfterOn.classList.contains('today') ? 'OK' : `FAIL (${todayCellAfterOn.className})`);
  console.log('Home: Record Workout circle now shows the done state:', doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');
  console.log('Home: "This Week" workouts count increased by 1 from the toggle alone:', doc.getElementById('ovWorkoutsVal').textContent !== workoutsBefore ? `OK (${workoutsBefore} -> ${doc.getElementById('ovWorkoutsVal').textContent})` : `FAIL (stayed ${workoutsBefore})`);

  goPill('week');
  await wait(20);
  const planRowToday = doc.querySelector(`.plan-row[data-day="${todayDayIdx}"][data-week-idx="0"]`);
  console.log('Plan: today\'s specific row now shows the done checkmark, not the TODAY badge:', !!planRowToday.querySelector('.prow-status.done') && !planRowToday.querySelector('.prow-status.today') ? 'OK' : 'FAIL');
  console.log('Plan: today\'s row is no longer draggable (locked once done):', planRowToday.getAttribute('data-draggable')===null ? 'OK' : 'FAIL');

  goPill('calendar');
  await wait(20);
  console.log('Calendar: today\'s cell carries BOTH "done" and "today":', !!doc.querySelector('#calGrid .mo-cell.done.today') ? 'OK' : 'FAIL');

  // --- Clicking Record Workout after toggling done should be a no-op (already marked done) ---
  goPill('home');
  await wait(20);
  const recBtn = doc.getElementById('recordBtn');
  const doneCountBeforeClick = doc.getElementById('ovWorkoutsVal').textContent;
  recBtn.click();
  await wait(20);
  console.log('Clicking an already-done Record button does nothing (still on Home, no double count):', doc.getElementById('screen-home').hidden===false && doc.getElementById('ovWorkoutsVal').textContent===doneCountBeforeClick ? 'OK' : 'FAIL');

  // --- Toggle back OFF: today should fully revert to the "today" (blue) state ---
  doc.querySelector(`#weekStrip .day-cell[data-day="${todayDayIdx}"]`).click();
  await wait(20);
  const toggleAgain = doc.getElementById('dayCompleteToggle');
  console.log('Toggle correctly still shows ON when reopening today\'s Day Detail:', toggleAgain.classList.contains('on') ? 'OK' : 'FAIL');
  toggleAgain.click();
  await wait(20);
  console.log('Toggling back OFF flips the switch off:', !doc.getElementById('dayCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  goPill('home');
  await wait(20);
  const todayCellAfterOff = doc.querySelector(`#weekStrip .day-cell[data-day="${todayDayIdx}"]`);
  console.log('Home: today\'s specific cell is back to "today" (blue), no longer "done":', todayCellAfterOff.classList.contains('today') && !todayCellAfterOff.classList.contains('done') ? 'OK' : `FAIL (${todayCellAfterOff.className})`);
  console.log('Home: Record button is actionable again (not "done"):', !doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');
  console.log('Home: workouts count dropped back down after untoggling:', doc.getElementById('ovWorkoutsVal').textContent === workoutsBefore ? 'OK' : `FAIL (${doc.getElementById('ovWorkoutsVal').textContent} vs original ${workoutsBefore})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
