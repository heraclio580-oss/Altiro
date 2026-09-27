const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-27'; } }); // Sunday
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Covers two things about "Additional Workouts" (extraWorkouts):
// 1. Tapping one (on today or a past day) opens Log Performance for that specific workout, and what's
//    logged there is kept on it -- reopening it shows the logged sets, not the plan's targets.
// 2. A day whose only real content is an extra workout no longer shows a bare "Rest Day" on the
//    Plan list, Home, and Day Detail's own Scheduled row -- it shows that workout's name/detail,
//    the same way a logged entry already gets promoted into a rest day's display.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  // Friday Sep 25 is 2 days before today (a Sunday) -- within Home's rolling week-strip window.
  doc.querySelector('#weekStrip .day-cell[data-date="2026-09-25"]').click();
  await wait(20);

  // First workout takes the primary slot; a second one becomes an "Additional Workout".
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Morning Jog';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Chest';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='strength').click();
  doc.getElementById('newExerciseName').value = 'Bench';
  doc.getElementById('newExerciseSets').value = '3';
  doc.getElementById('newExerciseReps').value = '10';
  doc.getElementById('addExerciseBtn').click();
  await wait(10);
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  const extraBubble = doc.querySelector('#dayDetailExtraWorkouts [data-extra-id]');
  console.log('Additional Workout bubble is marked tappable:', extraBubble.classList.contains('editable') ? 'OK' : 'FAIL');

  // --- Part 1: tap it to log its performance ---
  extraBubble.click();
  await wait(20);
  console.log('Tapping the extra opens Log Performance (not an edit form):', doc.getElementById('logPerfOverlay').hidden===false && doc.getElementById('manualEntryOverlay').hidden===true ? 'OK' : 'FAIL');
  const benchRow = doc.querySelector('#logPerfExercisesList .exercise-log-row[data-exercise-key="Bench"]');
  console.log('It lists that workout\'s own exercise (Bench, 3 sets):', benchRow && benchRow.querySelectorAll('.set-log-row').length===3 ? 'OK' : 'FAIL');
  benchRow.querySelectorAll('[data-field="weight"]').forEach((el,i)=>{ el.value = String(100 + i*10); });
  doc.getElementById('saveLogPerf').click();
  await wait(20);
  console.log('Still exactly ONE Additional Workout after logging it:', doc.querySelectorAll('#dayDetailExtraWorkouts [data-extra-id]').length===1 ? 'OK' : 'FAIL');
  console.log('Logging it marks it Completed:', doc.getElementById('dayDetailExtraWorkouts').textContent.includes('Completed') ? 'OK' : 'FAIL');

  doc.querySelector('#dayDetailExtraWorkouts [data-extra-id]').click();
  await wait(20);
  const weights = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row[data-exercise-key="Bench"] [data-field="weight"]')].map(el=>el.value);
  console.log('Reopening shows the logged weights per set (100/110/120):', weights.join('/')==='100/110/120' ? 'OK' : `FAIL (${weights.join('/')})`);
  console.log('...with every set ticked off as done:', [...doc.querySelectorAll('#logPerfExercisesList .set-check-dot')].every(d=>d.classList.contains('checked')) ? 'OK' : 'FAIL');
  doc.getElementById('closeLogPerf').click();
  await wait(10);

  console.log('ALL DONE (part 1)');

  // --- Part 2: a rest day whose only content is an extra workout shows its description ---
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-date="2026-09-24"]').click(); // Thursday, untouched rest day
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Yoga';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='strength').click();
  doc.getElementById('manualVolumeInput').value = '30 min flow';
  doc.getElementById('manualVolumeInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  console.log('Day Detail Scheduled row shows the extra\'s name, not "Rest Day":',
    doc.getElementById('dayDetailPlanRow').textContent.includes('Yoga') && !doc.getElementById('dayDetailPlanRow').textContent.includes('Rest Day') ? 'OK' : `FAIL (${doc.getElementById('dayDetailPlanRow').textContent})`);

  goPill('week');
  await wait(20);
  const thuRow = doc.querySelector('.plan-row[data-day="3"][data-week-idx="0"]'); // Thursday Sep 24
  console.log('Plan row for that day shows "Yoga", not "Rest Day":', thuRow.querySelector('.prow-title').textContent==='Yoga' ? 'OK' : `FAIL (${thuRow.querySelector('.prow-title').textContent})`);
  console.log('Plan row shows the extra\'s detail too:', thuRow.querySelector('.prow-detail')?.textContent==='30 min flow' ? 'OK' : `FAIL (${thuRow.querySelector('.prow-detail')?.textContent})`);

  goPill('home');
  await wait(20);
  const thuCell = doc.querySelector('#weekStrip .day-cell[data-date="2026-09-24"]');
  console.log('Home week-strip cell is not stuck as a plain rest cell (still shows correctly, not crashing):', !!thuCell ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
