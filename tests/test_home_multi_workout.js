const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

function planTodayWorkout(doc, win, name){
  doc.getElementById('addTodayWorkoutBtn').click();
  return wait(20).then(()=>{
    // Create Workout already defaults "Mark as Completed" OFF, so this becomes a *planned* workout
    // (goes through planCustomWorkout), not an instantly-logged manual entry.
    doc.getElementById('manualNameInput').value = name;
    doc.getElementById('manualNameInput').dispatchEvent(new win.Event('input', {bubbles:true}));
    doc.getElementById('saveManualEntry').click();
    return wait(20);
  });
}

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);

  // Today already has its planned workout: workouts added on Home join it as Additional Workouts
  // instead of replacing it.
  const planned = doc.querySelector('#sessionCard .title').textContent;
  await planTodayWorkout(doc, window, 'Home Workout A');
  console.log('A workout added on Home joins today\'s planned workout (doesn\'t replace it):',
    doc.querySelector('#sessionCard .title').textContent===planned && doc.getElementById('homeExtraWorkoutsWrap') && doc.getElementById('homeExtraWorkoutsWrap').textContent.includes('Home Workout A') ? 'OK' : `FAIL (${doc.querySelector('#sessionCard .title').textContent})`);

  await planTodayWorkout(doc, window, 'Home Workout B');
  console.log('A second one joins too, the planned workout still today\'s:', doc.querySelector('#sessionCard .title').textContent===planned ? 'OK' : `FAIL (${doc.getElementById('sessionCard').textContent})`);
  console.log('Additional Workouts section shows both on Home:', doc.getElementById('homeExtraWorkoutsWrap') && ['Home Workout A','Home Workout B'].every(n=>doc.getElementById('homeExtraWorkoutsWrap').textContent.includes(n)) ? 'OK' : 'FAIL');

  const startBtn = doc.querySelector('#homeExtraWorkoutsWrap [data-start-extra]');
  console.log('Extra workout has its own Start action:', !!startBtn ? 'OK' : 'FAIL');
  const extraId = startBtn.getAttribute('data-start-extra');

  startBtn.click();
  await wait(20);
  console.log('Starting the extra workout opens Log Performance (targeting that workout, not the primary):', doc.getElementById('logPerfOverlay').hidden===false ? 'OK' : 'FAIL');

  doc.getElementById('saveLogPerf').click();
  await wait(20);
  console.log('Finishing the extra workout navigates to Summary just like the primary flow:', doc.getElementById('screen-summary') && !doc.getElementById('screen-summary').hidden ? 'OK' : 'FAIL');

  goPill('home');
  await wait(20);
  const extraRow = [...doc.querySelectorAll('#homeExtraWorkoutsWrap .manual-entry')].find(r=>r.getAttribute('data-extra-id')===extraId);
  console.log('Completed extra workout now shows as done (no Start button) on Home:', extraRow && !extraRow.querySelector('[data-start-extra]') ? 'OK' : 'FAIL');
  // (50 push-ups at work don't finish today's run: the day's own workout is still there to do.)
  console.log('Completing an extra workout leaves today\'s own workout still to do (its Start button stays):', !doc.getElementById('recordBtn').classList.contains('done') && !doc.getElementById('recordBtn').classList.contains('disabled') ? 'OK' : 'FAIL');

  // Delete the (now completed) extra workout -- it just disappears, the rest untouched.
  doc.querySelector(`#homeExtraWorkoutsWrap [data-extra-id="${extraId}"] [data-del-extra]`).click();
  await wait(20);
  await wait(20);
  console.log('Deleting an extra workout removes just that one:', !doc.querySelector(`#homeExtraWorkoutsWrap [data-extra-id="${extraId}"]`) && doc.getElementById('homeExtraWorkoutsWrap').textContent.includes('Home Workout B') ? 'OK' : 'FAIL');
  console.log('Today\'s planned workout unaffected by deleting it:', doc.querySelector('#sessionCard .title').textContent===planned ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
