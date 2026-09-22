const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

function addExercise(doc, name, sets, reps){
  doc.getElementById('newExerciseName').value = name;
  doc.getElementById('newExerciseSets').value = String(sets);
  doc.getElementById('newExerciseReps').value = String(reps);
  doc.getElementById('addExerciseBtn').click();
}

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Plan a custom strength workout for a future day (Saturday) with a hand-built exercise list.
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="5"]').click();
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  console.log('Exercises section shows for strength type:', doc.getElementById('createExercisesSection').hidden===false ? 'OK' : 'FAIL');

  doc.getElementById('manualNameInput').value = 'Garage Gym Day';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));

  // Blank name should be rejected.
  const beforeCount = doc.querySelectorAll('#createExercisesList .exercise-build-row').length;
  doc.getElementById('newExerciseSets').value = '3';
  doc.getElementById('newExerciseReps').value = '10';
  doc.getElementById('addExerciseBtn').click();
  await wait(10);
  console.log('Blank exercise name is rejected (no row added):', doc.querySelectorAll('#createExercisesList .exercise-build-row').length===beforeCount ? 'OK' : 'FAIL');

  addExercise(doc, 'Trap Bar Deadlift', 4, 6);
  await wait(10);
  addExercise(doc, 'Dumbbell Row', 3, 12);
  await wait(10);
  const rows = [...doc.querySelectorAll('#createExercisesList .exercise-build-row')];
  console.log('Two exercises added to the list:', rows.length===2 ? 'OK' : `FAIL (${rows.length})`);
  console.log('First exercise shows name and prescription:', rows[0].textContent.includes('Trap Bar Deadlift') && rows[0].textContent.includes('4 x 6') ? 'OK' : `FAIL (${rows[0].textContent})`);
  console.log('Input row clears after adding:', doc.getElementById('newExerciseName').value==='' ? 'OK' : 'FAIL');

  // Delete one before saving.
  rows[1].querySelector('[data-del-exercise]').click();
  await wait(10);
  console.log('Deleting an exercise before saving removes just that one:', doc.querySelectorAll('#createExercisesList .exercise-build-row').length===1 ? 'OK' : 'FAIL');

  doc.getElementById('saveManualEntry').click();
  await wait(20);
  console.log('Plan bubble shows the custom workout with its exercise list:', doc.getElementById('dayDetailPlanRow').textContent.includes('Trap Bar Deadlift') ? 'OK' : 'FAIL');

  // Reopen via the bubble -- exercises should be pre-filled.
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  const reopenedRows = [...doc.querySelectorAll('#createExercisesList .exercise-build-row')];
  console.log('Reopening for edit pre-fills the saved exercise list:', reopenedRows.length===1 && reopenedRows[0].textContent.includes('Trap Bar Deadlift') ? 'OK' : `FAIL (${reopenedRows.length})`);

  // Now log performance for that day (open via Log Performance path) -- structured rows should show.
  doc.getElementById('closeManualEntry').click();
  await wait(10);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
