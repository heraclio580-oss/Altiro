const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Tapping a workout in Day Detail opens Log Performance for it -- never an Edit Workout page (Create
// Workout is only for creating now). Today's and past days' workouts open it; a future workout can't
// be logged yet, so tapping one does nothing. A workout that's already been logged reopens showing
// exactly what was logged, and re-saving it just updates it in place -- it never re-runs the Record
// flow (Summary screen, streak), which only today's first real recording goes through.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const logPerfOpen = () => doc.getElementById('logPerfOverlay').hidden===false;
  const createOpen = () => doc.getElementById('manualEntryOverlay').hidden===false;

  console.log('Create Workout has no "Clear Workout"/edit leftovers:', !doc.getElementById('clearWorkoutBtn') && !doc.getElementById('workoutSummaryOverlay') ? 'OK' : 'FAIL');

  // ---- Today's planned (not yet done) workout: tapping it starts recording it ----
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  console.log("Tapping today's planned workout opens Log Performance:", logPerfOpen() ? 'OK' : 'FAIL');
  console.log('...not the Create/Edit Workout sheet:', !createOpen() ? 'OK' : 'FAIL');
  doc.getElementById('closeLogPerf').click();
  await wait(10);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // ---- A past day's planned workout (left undone = "missed") gets logged after the fact ----
  goPill('calendar');
  await wait(20);
  doc.querySelector('.mo-cell[data-date="2026-09-14"]').click(); // Monday
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  console.log('"+ Add Workout" opens the sheet titled "Create Workout":', doc.getElementById('manualEntryTitleLabel').textContent==='Create Workout' ? 'OK' : `FAIL (${doc.getElementById('manualEntryTitleLabel').textContent})`);
  doc.getElementById('manualNameInput').value = 'Retro Leg Day';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
  if(doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('createWeightInput').value = '150';
  doc.getElementById('createRepsInput').value = '8';
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  console.log('Calendar ring is red/missed before logging:', doc.querySelector('.mo-cell[data-date="2026-09-14"]').classList.contains('missed') ? 'OK' : 'FAIL');

  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  console.log("Tapping a past day's workout opens Log Performance:", logPerfOpen() && !createOpen() ? 'OK' : 'FAIL');
  console.log('Starts from the planned target (150 x 8):', doc.getElementById('logPerfWeightInput').value==='150' && doc.getElementById('logPerfRepsInput').value==='8' ? 'OK' : `FAIL (${doc.getElementById('logPerfWeightInput').value} x ${doc.getElementById('logPerfRepsInput').value})`);
  doc.getElementById('logPerfWeightInput').value = '155';
  doc.getElementById('logPerfNotesInput').value = 'Knee felt fine';
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  console.log('Saving closes Log Performance and stays on the day (no Summary screen):', !logPerfOpen() && doc.getElementById('screen-summary').hidden===true && doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('That past day now counts as done:', doc.querySelector('.mo-cell[data-date="2026-09-14"]').classList.contains('done') ? 'OK' : `FAIL (${doc.querySelector('.mo-cell[data-date="2026-09-14"]').className})`);

  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  console.log('Reopening shows what was actually logged (155), not the plan target:', doc.getElementById('logPerfWeightInput').value==='155' ? 'OK' : `FAIL (${doc.getElementById('logPerfWeightInput').value})`);
  console.log('...notes included:', doc.getElementById('logPerfNotesInput').value==='Knee felt fine' ? 'OK' : `FAIL (${doc.getElementById('logPerfNotesInput').value})`);
  doc.getElementById('closeLogPerf').click();
  await wait(10);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // ---- A logged entry (and a rest day it was promoted onto) opens the same Log Performance ----
  doc.querySelector('.mo-cell[data-date="2026-09-17"]').click(); // Thursday, rest day
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Push-ups';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('manualVolumeInput').value = '40';
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  doc.querySelector('#dayDetailEntries [data-entry-id]').click();
  await wait(20);
  console.log('Tapping a Logged Workouts entry opens Log Performance:', logPerfOpen() ? 'OK' : 'FAIL');
  doc.getElementById('logPerfWeightInput').value = '0';
  doc.getElementById('logPerfRepsInput').value = '45';
  doc.getElementById('saveLogPerf').click();
  await wait(20);
  console.log('Still exactly one logged entry after logging its performance:', doc.querySelectorAll('#dayDetailEntries [data-entry-id]').length===1 ? 'OK' : 'FAIL');
  doc.getElementById('dayDetailPlanRow').click(); // the day's headline IS that entry -- same record
  await wait(20);
  console.log('Tapping the day\'s headline (promoted from that entry) shows the same logged reps:', logPerfOpen() && doc.getElementById('logPerfRepsInput').value==='45' ? 'OK' : `FAIL (${doc.getElementById('logPerfRepsInput').value})`);
  doc.getElementById('closeLogPerf').click();
  await wait(10);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // ---- A future workout can't be logged yet: tapping it does nothing ----
  doc.querySelector('.mo-cell[data-date="2026-09-19"]').click(); // Saturday, future
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Weekend Ride';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  console.log('Future workout bubble is not marked tappable:', !doc.getElementById('dayDetailPlanRow').classList.contains('editable') ? 'OK' : 'FAIL');
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  console.log('Tapping a future workout opens nothing:', !logPerfOpen() && !createOpen() ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);
  console.log('Calendar shows it upcoming (yellow):', doc.querySelector('.mo-cell[data-date="2026-09-19"]').classList.contains('upcoming') ? 'OK' : 'FAIL');

  // ---- Rest day: plain text, tapping it does nothing; "+ Add Workout" opens a blank Create Workout ----
  doc.querySelector('.mo-cell[data-date="2026-09-20"]').click(); // Sunday, rest
  await wait(20);
  const restPlanRow = doc.getElementById('dayDetailPlanRow');
  console.log('Rest day is plain text, no tappable bubble:', restPlanRow.className==='day-row-empty' ? 'OK' : `FAIL (${restPlanRow.className})`);
  restPlanRow.click();
  await wait(20);
  console.log('Tapping the rest day text opens nothing:', !logPerfOpen() && !createOpen() ? 'OK' : 'FAIL');
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  console.log('"+ Add Workout" opens a blank Create Workout sheet:', createOpen() && doc.getElementById('manualNameInput').value==='' ? 'OK' : 'FAIL');
  doc.getElementById('closeManualEntry').click();
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // ---- Today: record it for real (full Record flow), then reopen it from Day Detail ----
  goPill('home');
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  doc.getElementById('logPerfNotesInput').value = 'Good session';
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  console.log("Today's first recording still goes to the Summary screen:", doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');
  goPill('home');
  await wait(20);
  const streakAfterRecord = doc.getElementById('streakChip').textContent;
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  console.log("Tapping today's DONE workout reopens what was logged:", logPerfOpen() && doc.getElementById('logPerfNotesInput').value==='Good session' ? 'OK' : `FAIL (${doc.getElementById('logPerfNotesInput').value})`);
  doc.getElementById('logPerfNotesInput').value = 'Good session, added a note later';
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  console.log('Re-saving it stays put -- no second trip to the Summary screen:', doc.getElementById('screen-summary').hidden===true ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);
  console.log('Re-saving does not bump the streak again:', doc.getElementById('streakChip').textContent===streakAfterRecord ? 'OK' : `FAIL (${streakAfterRecord} -> ${doc.getElementById('streakChip').textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
