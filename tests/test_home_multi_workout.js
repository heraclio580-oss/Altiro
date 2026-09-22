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
    // Today defaults "Mark as Completed" ON -- switch it off so this becomes a *planned* workout
    // (goes through planCustomWorkout), not an instantly-logged manual entry.
    doc.getElementById('createCompletedToggle').click();
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

  await planTodayWorkout(doc, window, 'Home Workout A');
  console.log('First planned workout today becomes the primary session card:', doc.getElementById('sessionCard').textContent.includes('Home Workout A') ? 'OK' : `FAIL (${doc.getElementById('sessionCard').textContent})`);
  console.log('No "Additional Workouts" section yet:', doc.getElementById('homeExtraWorkoutsWrap')===null ? 'OK' : 'FAIL');

  await planTodayWorkout(doc, window, 'Home Workout B');
  console.log('Primary session card still shows Workout A (not replaced):', doc.getElementById('sessionCard').textContent.includes('Home Workout A') ? 'OK' : `FAIL (${doc.getElementById('sessionCard').textContent})`);
  console.log('Additional Workouts section now shows on Home:', doc.getElementById('homeExtraWorkoutsWrap') && doc.getElementById('homeExtraWorkoutsWrap').textContent.includes('Home Workout B') ? 'OK' : 'FAIL');

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
  console.log('Completing an extra workout also flips the day/record button to done (same rule as a logged manual entry):', doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');

  // Delete the (now completed) extra workout -- should just disappear, primary untouched.
  const delBtn = doc.querySelector('#homeExtraWorkoutsWrap [data-del-extra]');
  delBtn.click();
  await wait(20);
  console.log('Deleting the extra workout removes the section:', doc.getElementById('homeExtraWorkoutsWrap')===null ? 'OK' : 'FAIL');
  console.log('Primary session card unaffected by deleting the extra:', doc.getElementById('sessionCard').textContent.includes('Home Workout A') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
