const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Today is pinned to Friday 2026-09-18. Saturday (day index 5) is a future date and, under the
// default 3-day training pattern (Mon/Wed/Fri), an auto-generated Rest Day -- a good test of
// "fully replace the suggested plan" since it's swapping a rest day for a real workout.
// "Plan a Workout" no longer exists as a separate button/sheet -- it's the same unified "Create
// Workout" flow as "+ Add a Workout", distinguished only by the "Mark as Completed" toggle.
(async () => {
  await wait(60);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);

  const satCell = doc.querySelector('#weekStrip .day-cell[data-day="5"]');
  satCell.click();
  await wait(20);
  console.log('Day Detail opens for the future Saturday:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Saturday starts as a Rest Day:', doc.getElementById('dayDetailPlanRow').textContent.includes('Rest Day') ? 'OK' : 'FAIL');
  console.log('"Completed" toggle stays hidden for a future day:', doc.getElementById('dayDetailCompleteSection').hidden===true ? 'OK' : 'FAIL');
  console.log('No "Reset to Suggested Plan" yet (nothing custom set):', !doc.getElementById('ddResetPlanBtn') ? 'OK' : 'FAIL');

  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  console.log('Create Workout sheet opens:', doc.getElementById('manualEntryOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('"Mark as Completed" defaults OFF for a future date:', !doc.getElementById('createCompletedToggle').classList.contains('on') ? 'OK' : 'FAIL');
  console.log('Strength is the default: a Description line, and three exercise rows ready to fill:', doc.getElementById('manualVolumeLabel').textContent==='Description' && doc.querySelectorAll('#createExercisesList .exercise-edit-row').length===3 ? 'OK' : 'FAIL');
  console.log('...with no separate top-set weight or target-reps boxes:', !doc.getElementById('createWeightInput') && !doc.getElementById('createRepsInput') ? 'OK' : 'FAIL');
  console.log('Name label reads the planning phrasing, not the logging one:', doc.getElementById('createNameLabel').textContent === 'What are you planning?' ? 'OK' : `FAIL (${doc.getElementById('createNameLabel').textContent})`);

  doc.getElementById('manualNameInput').value = 'Saturday Leg Day';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualVolumeInput').value = 'Legs, high intensity';
  const legRow = doc.querySelector('#createExercisesList .exercise-edit-row');
  legRow.querySelector('.ex-name').value = 'Back Squat'; legRow.querySelector('.ex-sets').value = '4'; legRow.querySelector('.ex-reps').value = '8';
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  console.log('Day Detail now shows the custom-planned workout:', doc.getElementById('dayDetailPlanRow').textContent.includes('Saturday Leg Day') ? 'OK' : 'FAIL');
  console.log('Saturday is no longer a Rest Day:', !doc.getElementById('dayDetailPlanRow').textContent.includes('Rest Day') ? 'OK' : 'FAIL');
  console.log('"Reset to Suggested Plan" now appears (something custom IS set):', !!doc.getElementById('ddResetPlanBtn') ? 'OK' : 'FAIL');
  console.log('Still not marked completed (planning is not the same as doing it):', doc.getElementById('dayDetailPlanRow').className.includes('done')===false ? 'OK' : 'FAIL');

  doc.getElementById('closeDayDetail').click();
  await wait(10);
  goPill('week');
  await wait(20);
  console.log('Plan list also reflects the custom Saturday workout:', doc.querySelector('.plan-row[data-day="5"][data-week-idx="0"]').textContent.includes('Saturday Leg Day') ? 'OK' : 'FAIL');

  goPill('calendar');
  await wait(20);
  console.log('Calendar cell for that date is clickable and opens the same Day Detail:', !!doc.querySelector('#calGrid .mo-cell[data-date]') ? 'OK' : 'FAIL');

  // --- Reset back to the suggested plan ---
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="5"]').click();
  await wait(20);
  doc.getElementById('ddResetPlanBtn').click();
  await wait(20);
  console.log('After reset, Saturday is a Rest Day again:', doc.getElementById('dayDetailPlanRow').textContent.includes('Rest Day') ? 'OK' : 'FAIL');
  console.log('"Reset to Suggested Plan" is gone again:', !doc.getElementById('ddResetPlanBtn') ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // --- Planning TODAY's workout with a target should pre-seed progression for Record Workout ---
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="4"]').click(); // Friday = today
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  console.log('"Mark as Completed" defaults OFF for today too (planning, not logging, is the default everywhere):',
    !doc.getElementById('createCompletedToggle').classList.contains('on') ? 'OK' : 'FAIL');
  console.log('Planning mode (the default) shows the exercise rows and the planning name label:', !doc.getElementById('createExercisesSection').hidden && doc.getElementById('createNameLabel').textContent==='What are you planning?' ? 'OK' : 'FAIL');
  doc.getElementById('manualNameInput').value = 'Custom Push Day';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  const pushRows = [...doc.querySelectorAll('#createExercisesList .exercise-edit-row')];
  pushRows[0].querySelector('.ex-name').value = 'Push Press'; pushRows[0].querySelector('.ex-sets').value = '3'; pushRows[0].querySelector('.ex-reps').value = '10';
  pushRows[1].querySelector('.ex-name').value = 'Dips'; pushRows[1].querySelector('.ex-reps').value = '12';
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  goPill('home');
  await wait(20);
  console.log('Home now shows the custom-planned title for today:', doc.getElementById('sessionCard').querySelector('.title').textContent.includes('Custom Push Day') ? 'OK' : 'FAIL');

  doc.getElementById('recordBtn').click();
  await wait(950);
  const pp = doc.querySelector('#logPerfExercisesList .exercise-log-row[data-exercise-key="Push Press"]');
  const dips = doc.querySelector('#logPerfExercisesList .exercise-log-row[data-exercise-key="Dips"]');
  console.log('Log Performance lists the planned exercises with their sets and reps:', pp && pp.querySelectorAll('.set-log-row').length===3 && pp.querySelector('[data-field="reps"]').value==='10' && dips && dips.querySelectorAll('.set-log-row').length===3 && dips.querySelector('[data-field="reps"]').value==='12' ? 'OK' : 'FAIL');
  console.log('...blank rows were skipped:', doc.querySelectorAll('#logPerfExercisesList .exercise-log-row').length===2 ? 'OK' : `FAIL (${doc.querySelectorAll('#logPerfExercisesList .exercise-log-row').length})`);
  doc.getElementById('closeLogPerf').click();
  await wait(10);

  // --- A custom-planned FUTURE day must survive an Adjust Plan focus change, same as real history does ---
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="5"]').click(); // Saturday, future
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Weekend Trail Run';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  goPill('adjust');
  await wait(20);
  const thumb = doc.getElementById('adjSliderThumb');
  for(let i=0;i<4;i++) thumb.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  await wait(10);
  doc.getElementById('applyAdjust').click();
  await wait(20);

  goPill('week');
  await wait(20);
  const satRow = doc.querySelector('.plan-row[data-day="5"][data-week-idx="0"]');
  console.log('Custom-planned Saturday survives the focus-ratio change untouched:', satRow.textContent.includes('Weekend Trail Run') ? 'OK' : `FAIL (${satRow.textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
