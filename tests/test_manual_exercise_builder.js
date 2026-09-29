const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Create Workout: a name, a description ("Back day, high intensity"), notes, and exercise rows to fill
// in directly -- three ready to go, "+ Add Exercise" for more, blank rows skipped.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const rows = () => [...doc.querySelectorAll('#createExercisesList .exercise-edit-row')];
  const fill = (row, name, sets, reps) => { row.querySelector('.ex-name').value = name; row.querySelector('.ex-sets').value = sets; row.querySelector('.ex-reps').value = reps; };

  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="5"]').click();
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  console.log('Exercises section shows for a lifting workout:', doc.getElementById('createExercisesSection').hidden===false ? 'OK' : 'FAIL');
  console.log('...with three rows ready to fill (exercise, sets, reps):', rows().length===3 && rows().every(r=>r.querySelector('.ex-name') && r.querySelector('.ex-sets') && r.querySelector('.ex-reps')) ? 'OK' : `FAIL (${rows().length})`);
  console.log('The top line is a Description:', doc.getElementById('manualVolumeLabel').textContent==='Description' && /Back day, high intensity/.test(doc.getElementById('manualVolumeInput').placeholder) ? 'OK' : `FAIL (${doc.getElementById('manualVolumeLabel').textContent})`);
  console.log('No top-set weight or target-reps boxes:', !doc.getElementById('createWeightInput') && !doc.getElementById('createRepsInput') ? 'OK' : 'FAIL');
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
  console.log('A run\'s top line stays its distance or time:', doc.getElementById('manualVolumeLabel').textContent==='Distance or time' && doc.getElementById('createExercisesSection').hidden ? 'OK' : 'FAIL');
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();

  doc.getElementById('manualNameInput').value = 'Back';
  doc.getElementById('manualVolumeInput').value = 'Back day, high intensity';
  fill(rows()[0], 'Trap Bar Deadlift', 4, 6);
  fill(rows()[1], 'Dumbbell Row', 3, 12);
  // third row left blank
  doc.getElementById('addExerciseBtn').click();
  await wait(5);
  console.log('"+ Add Exercise" adds another row:', rows().length===4 ? 'OK' : `FAIL (${rows().length})`);
  fill(rows()[3], 'Face Pull', '', '');
  fill(rows()[1], 'Seal Row', 3, 10);
  rows()[1].querySelector('.del').click();
  console.log('Removing a row takes it out:', rows().length===3 && !rows().some(r=>r.querySelector('.ex-name').value==='Seal Row') ? 'OK' : 'FAIL');

  doc.getElementById('saveManualEntry').click();
  await wait(20);
  const planRow = doc.getElementById('dayDetailPlanRow').textContent;
  console.log('Saved with its description and exercises:', /Back/.test(planRow) && /Back day, high intensity/.test(planRow) && /Trap Bar Deadlift/.test(planRow) && /Face Pull/.test(planRow) ? 'OK' : `FAIL (${planRow.replace(/\s+/g,' ').slice(0,160)})`);
  const lines = [...doc.querySelectorAll('#dayDetailPlanRow .r-exercise-list li')].map(li=>li.textContent.replace(/\s+/g,' ').trim());
  console.log('...blank rows skipped, sets and reps kept (blank ones default to 3 x 10):', lines.length===2 && /4 x 6/.test(lines[0]) && /3 x 10/.test(lines[1]) ? 'OK' : `FAIL (${lines.join(' | ')})`);
  doc.getElementById('closeDayDetail').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
