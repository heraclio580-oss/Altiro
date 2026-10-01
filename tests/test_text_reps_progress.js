const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Reps logged without Log Performance still count on Progress: "50 reps" written as the description,
// a name like "50 Push-Ups", "3 x 10", and lifts built in Create Workout's exercise list when the
// workout is logged as already done.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

async function freshDay(){
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  const w = dom.window, doc = w.document;
  await wait(50);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('home'); await wait(20);
  // Log a lifting workout as already done today.
  const log = async (name, volume, exercises) => {
    doc.getElementById('addTodayWorkoutBtn').click(); await wait(20);
    doc.querySelector('#manualTypeRow [data-type="strength"]').click(); await wait(10);
    doc.getElementById('manualNameInput').value = name;
    doc.getElementById('manualNameInput').dispatchEvent(new w.Event('input', {bubbles:true}));
    doc.getElementById('manualVolumeInput').value = volume || '';
    if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
    (exercises||[]).forEach(([n, sets, reps], i)=>{
      const row = doc.querySelectorAll('#createExercisesList .exercise-edit-row')[i];
      row.querySelector('.ex-name').value = n; row.querySelector('.ex-sets').value = sets; row.querySelector('.ex-reps').value = reps;
    });
    doc.getElementById('saveManualEntry').click(); await wait(20);
  };
  const progress = async () => {
    go('progress'); await wait(20);
    doc.querySelector('[data-act-day="2026-09-18"]')?.click(); await wait(10);
    const tiles = [...doc.querySelectorAll('#progActivity .act-tile .v')].map(e=>e.textContent);
    return {sets: +tiles[1], reps: +tiles[2], detail: doc.querySelector('#progActivity .act-detail').textContent.replace(/\s+/g,' ')};
  };
  return {w, doc, go, log, progress};
}

(async () => {
  {
    const {log, progress} = await freshDay();
    const before = await progress();
    await log('Push-ups', '50 reps');
    const after = await progress();
    check('"Push-ups · 50 reps" logged as done counts 1 set, 50 reps on Progress', after.sets-before.sets===1 && after.reps-before.reps===50, JSON.stringify([before, after]));
    check('...and shows on that day', /Push-ups/.test(after.detail) && /50 reps/.test(after.detail), after.detail);
  }
  {
    const {log, progress} = await freshDay();
    const before = await progress();
    await log('50 Push-Ups');
    const after = await progress();
    check('Just "50 Push-Ups" as the name counts the 50 reps', after.reps-before.reps===50 && after.sets-before.sets===1, JSON.stringify([before, after]));
  }
  {
    const {log, progress} = await freshDay();
    const before = await progress();
    await log('Pull-ups', '3 x 10');
    const after = await progress();
    check('"3 x 10" counts 3 sets, 30 reps', after.sets-before.sets===3 && after.reps-before.reps===30, JSON.stringify([before, after]));
  }
  {
    const {log, progress} = await freshDay();
    const before = await progress();
    await log('Lunch lift', '', [['Push-Up', 3, 20], ['Squat', 2, 15]]);
    const after = await progress();
    check('Exercises built in Create Workout, logged as done, count as built (5 sets, 90 reps)', after.sets-before.sets===5 && after.reps-before.reps===90, JSON.stringify([before, after]));
  }
  {
    const {log, progress} = await freshDay();
    const before = await progress();
    await log('Easy stretch', '20 min');
    const after = await progress();
    check('A lifting log with no reps in it adds none', after.reps===before.reps && after.sets===before.sets, JSON.stringify([before, after]));
  }
  {
    // Added as a workout on Home, then started and finished without logging sets.
    const {w, doc, go, progress} = await freshDay();
    const before = await progress();
    go('home'); await wait(20);
    doc.getElementById('addTodayWorkoutBtn').click(); await wait(20);
    doc.querySelector('#manualTypeRow [data-type="strength"]').click(); await wait(10);
    doc.getElementById('manualNameInput').value = '50 Push-Ups';
    doc.getElementById('manualNameInput').dispatchEvent(new w.Event('input', {bubbles:true}));
    if(doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
    doc.getElementById('saveManualEntry').click(); await wait(20);
    doc.querySelector('#homeExtraWorkoutsWrap [data-start-extra]').click(); await wait(20);
    doc.getElementById('saveLogPerf').click(); await wait(30);
    if(!doc.getElementById('reviewOverlay')?.hidden) doc.getElementById('submitReviewBtn')?.click();
    const after = await progress();
    check('Added on Home and finished without logging sets: its 50 reps count', after.reps-before.reps===50, JSON.stringify([before, after]));
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
