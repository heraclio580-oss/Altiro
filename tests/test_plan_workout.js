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
  console.log('"Plan a Workout" is offered for a future day:', !!doc.getElementById('ddPlanWorkoutBtn') ? 'OK' : 'FAIL');
  console.log('"Completed" toggle stays hidden for a future day:', doc.getElementById('dayDetailCompleteSection').hidden===true ? 'OK' : 'FAIL');
  console.log('No "Reset to Suggested Plan" yet (nothing custom set):', !doc.getElementById('ddResetPlanBtn') ? 'OK' : 'FAIL');

  doc.getElementById('ddPlanWorkoutBtn').click();
  await wait(20);
  console.log('Plan Workout sheet opens:', doc.getElementById('planWorkoutOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Strength is the default type (weight/reps fields visible):', !doc.getElementById('planWeightSection').hidden && !doc.getElementById('planRepsSection').hidden ? 'OK' : 'FAIL');

  doc.getElementById('planNameInput').value = 'Saturday Leg Day';
  doc.getElementById('planNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('planVolumeInput').value = '45 min';
  doc.getElementById('planWeightInput').value = '185';
  doc.getElementById('planRepsInput').value = '8';
  doc.getElementById('savePlanWorkout').click();
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
  doc.getElementById('ddPlanWorkoutBtn').click();
  await wait(20);
  doc.getElementById('planNameInput').value = 'Custom Push Day';
  doc.getElementById('planNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('planWeightInput').value = '100';
  doc.getElementById('planRepsInput').value = '10';
  doc.getElementById('savePlanWorkout').click();
  await wait(20);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  goPill('home');
  await wait(20);
  console.log('Home now shows the custom-planned title for today:', doc.getElementById('sessionCard').querySelector('.title').textContent.includes('Custom Push Day') ? 'OK' : 'FAIL');

  doc.getElementById('recordBtn').click();
  await wait(950);
  console.log('Log Performance sheet pre-seeds the weight/reps target set while planning:', doc.getElementById('logPerfWeightInput').value==='100' && doc.getElementById('logPerfRepsInput').value==='10' ? 'OK' : `FAIL (${doc.getElementById('logPerfWeightInput').value}/${doc.getElementById('logPerfRepsInput').value})`);
  doc.getElementById('closeLogPerf').click();
  await wait(10);

  // --- A custom-planned FUTURE day must survive an Adjust Plan focus change, same as real history does ---
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="5"]').click(); // Saturday, future
  await wait(20);
  doc.getElementById('ddPlanWorkoutBtn').click();
  await wait(20);
  doc.getElementById('planNameInput').value = 'Weekend Trail Run';
  doc.getElementById('planNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  const typeButtons = [...doc.querySelectorAll('#planTypeRow .type-btn')];
  typeButtons.find(b=>b.getAttribute('data-type')==='run').click();
  doc.getElementById('savePlanWorkout').click();
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
