const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

function planWorkout(doc, name){
  doc.getElementById('addWorkoutBtn').click();
  return wait(20).then(()=>{
    doc.getElementById('manualNameInput').value = name;
    doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
    doc.getElementById('saveManualEntry').click();
    return wait(20);
  });
}

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Open a future day (Saturday) so new workouts default to "planned" (not logged-as-done).
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="5"]').click();
  await wait(20);

  await planWorkout(doc, 'Workout A');
  console.log('First custom workout becomes the primary plan:', doc.getElementById('dayDetailPlanRow').textContent.includes('Workout A') ? 'OK' : 'FAIL');
  console.log('No additional-workouts section yet (only one workout so far):', doc.getElementById('dayDetailExtraSection').hidden===true ? 'OK' : 'FAIL');

  await planWorkout(doc, 'Workout B');
  console.log('Primary plan is unchanged after adding a second workout (first is not deleted):', doc.getElementById('dayDetailPlanRow').textContent.includes('Workout A') ? 'OK' : `FAIL (${doc.getElementById('dayDetailPlanRow').textContent})`);
  console.log('Additional-workouts section now shows:', doc.getElementById('dayDetailExtraSection').hidden===false ? 'OK' : 'FAIL');
  console.log('Second workout appears in the additional-workouts list:', doc.getElementById('dayDetailExtraWorkouts').textContent.includes('Workout B') ? 'OK' : `FAIL (${doc.getElementById('dayDetailExtraWorkouts').textContent})`);

  await planWorkout(doc, 'Workout C');
  const extraRows = doc.querySelectorAll('#dayDetailExtraWorkouts .manual-entry');
  console.log('A third workout also just appends (two extras now, primary still intact):', extraRows.length===2 && doc.getElementById('dayDetailPlanRow').textContent.includes('Workout A') ? 'OK' : `FAIL (${extraRows.length})`);

  // Delete the first extra (Workout B) -- Workout C should remain, primary untouched.
  const delBtn = [...doc.querySelectorAll('#dayDetailExtraWorkouts [data-del-extra]')][0];
  delBtn.click();
  await wait(20);
  const remaining = doc.querySelectorAll('#dayDetailExtraWorkouts .manual-entry');
  console.log('Deleting one extra workout leaves the other:', remaining.length===1 && remaining[0].textContent.includes('Workout C') ? 'OK' : `FAIL (${remaining.length}, ${doc.getElementById('dayDetailExtraWorkouts').textContent})`);
  console.log('Primary plan still shows Workout A after deleting an extra:', doc.getElementById('dayDetailPlanRow').textContent.includes('Workout A') ? 'OK' : 'FAIL');

  // Delete the last extra -- section should hide again.
  doc.querySelector('#dayDetailExtraWorkouts [data-del-extra]').click();
  await wait(20);
  console.log('Additional-workouts section hides once empty again:', doc.getElementById('dayDetailExtraSection').hidden===true ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
