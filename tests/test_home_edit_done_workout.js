const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A workout already done today, listed on Home under Additional Workouts: tapping it opens what was
// logged, to look over and fix -- and the fix is kept (still done, still one workout).
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-23'; } }); // a Wednesday
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

(async () => {
  await wait(50);
  const doc = window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);

  // "+ Add workout" on Home: a lifting workout, built and logged as you go, then saved.
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Back';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
  const exRow = doc.querySelector('#createExercisesList .exercise-edit-row');
  exRow.querySelector('.ex-name').value = 'Deadlift';
  exRow.querySelector('.ex-sets').value = '2';
  exRow.querySelector('.ex-reps').value = '5';
  doc.getElementById('saveManualEntry').click();
  await wait(30);
  if(!doc.getElementById('dayDetailOverlay').hidden) doc.getElementById('closeDayDetail')?.click();
  await wait(20);

  const card = () => doc.querySelector('#homeExtraWorkoutsWrap [data-extra-id]');
  check('Home lists it under Additional Workouts, tappable', !!card() && card().classList.contains('editable'));
  // Do it: Start, log the weights, save.
  card().querySelector('[data-start-extra]').click();
  await wait(30);
  let rows = () => [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row[data-exercise-key="Deadlift"] [data-field="weight"]')];
  rows().forEach((el, i)=>{ el.value = String(200 + i*25); });
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  if(!doc.getElementById('summaryScreen')?.hidden) doc.getElementById('summaryDoneBtn')?.click();
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(30);
  check('Once done it says Completed', !!card() && /Completed/.test(card().textContent));

  // Tap the finished workout: it opens with what was logged.
  card().querySelector('.body').click();
  await wait(30);
  check('Tapping the done workout opens it', doc.getElementById('logPerfOverlay').hidden===false);
  check('...showing the weights logged (200/225)', rows().map(e=>e.value).join('/')==='200/225', rows().map(e=>e.value).join('/'));
  // Fix the second set and save.
  rows()[1].value = '235';
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  if(!doc.getElementById('summaryScreen')?.hidden) doc.getElementById('summaryDoneBtn')?.click();
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(30);
  check('After the fix it\'s still one workout, still Completed', doc.querySelectorAll('#homeExtraWorkoutsWrap [data-extra-id]').length===1 && /Completed/.test(card().textContent));
  card().querySelector('.body').click();
  await wait(30);
  check('...and reopening shows the fix (200/235)', rows().map(e=>e.value).join('/')==='200/235', rows().map(e=>e.value).join('/'));
  doc.getElementById('closeLogPerf').click();
  await wait(20);

  // The trash on the card still only deletes (asks first), it doesn't open the workout.
  card().querySelector('[data-del-extra]').click();
  await wait(20);
  check('Its trash asks to delete, it doesn\'t open it', doc.getElementById('logPerfOverlay').hidden && !doc.getElementById('confirmDeleteOverlay').hidden);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
