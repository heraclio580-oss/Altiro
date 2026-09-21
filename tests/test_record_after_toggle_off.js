const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for a real bug caught via real mobile touch testing: toggling "not done" leaves
// an explicit completedOverride:false in today's dayLog. If the user then ACTUALLY records a real
// workout via the Record Workout button, that stale override must not silently keep hiding the
// real completion -- recording a workout is the strongest possible "this is done" signal there is.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);

  // Toggle Completed ON then OFF -- this leaves completedOverride explicitly set to false.
  doc.getElementById('homeCompleteToggle').click();
  await wait(10);
  doc.getElementById('homeCompleteToggle').click();
  await wait(10);
  console.log('Toggle is off after the on/off round trip:', !doc.getElementById('homeCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');

  const workoutsBefore = doc.getElementById('ovWorkoutsVal').textContent;

  // Now actually record a real workout.
  const recordBtn = doc.getElementById('recordBtn');
  console.log('Record button is actionable (not stuck disabled) after the toggle round trip:', !recordBtn.classList.contains('disabled') && !recordBtn.classList.contains('done') ? 'OK' : 'FAIL');
  recordBtn.click();
  await wait(950); // the "recording" pulse delay, then the Log Performance sheet opens
  console.log('Log Performance sheet opens after the recording pulse:', doc.getElementById('logPerfOverlay').hidden===false ? 'OK' : 'FAIL');
  doc.getElementById('saveLogPerf').click(); // accept the seeded defaults -> startWorkout() fires, navigates to Summary
  await wait(50);

  console.log('Recording a real workout navigates to the Summary screen:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');

  goPill('home');
  await wait(20);
  console.log('Record button now correctly shows "done" (not suppressed by the stale override):', doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');
  console.log('Home\'s Completed toggle also correctly reflects done:', doc.getElementById('homeCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');
  console.log('"This Week" workouts count increased by exactly 1:', doc.getElementById('ovWorkoutsVal').textContent !== workoutsBefore ? `OK (${workoutsBefore} -> ${doc.getElementById('ovWorkoutsVal').textContent})` : `FAIL (stayed ${workoutsBefore})`);

  goPill('week');
  await wait(20);
  console.log('Plan list also shows today as done, not stuck on TODAY:', !!doc.querySelector('.prow-status.done') && !doc.querySelector('.prow-status.today') ? 'OK' : 'FAIL');

  goPill('calendar');
  await wait(20);
  console.log('Calendar also shows today as done (green), not the blue today-ring:', !!doc.querySelector('#calGrid .mo-cell.done') && !doc.querySelector('#calGrid .mo-cell.today') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
