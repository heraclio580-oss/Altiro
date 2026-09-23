const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for a reported bug: a run logged as an EXTRA (secondary) workout for today --
// via "+ Add a Workout" with "Mark as Completed" switched off (planning mode), then started/logged
// through its own "Start Workout" button -- never showed up in weekly/lifetime distance stats.
// Root cause: startWorkout()'s extraId branch only marked the extra workout completed; it never
// touched state.mileage/totalDistance, and weekStats() only ever read the day's PRIMARY session.
// A run logged under an extra slot is still a real run and should count the same as a primary one.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  const mileageBaseline = () => parseFloat(doc.getElementById('ovDistanceVal').textContent);

  goPill('home');
  await wait(20);
  const mileageBefore = mileageBaseline();

  // First planned (non-instant) workout for today becomes the custom primary slot.
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('createCompletedToggle').click(); // switch off "Mark as Completed" -> planning mode
  doc.getElementById('manualNameInput').value = 'Custom Strength Primary';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(30);

  // Second planned workout for today (a run) lands in extraWorkouts instead of replacing the primary.
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('createCompletedToggle').click();
  doc.getElementById('manualNameInput').value = 'Evening Trail Run';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  doc.getElementById('saveManualEntry').click();
  await wait(30);

  const startExtraBtn = doc.querySelector('#homeExtraWorkoutsWrap [data-start-extra]');
  console.log('Extra run workout appears on Home with a Start Workout button:', !!startExtraBtn ? 'OK' : 'FAIL');

  startExtraBtn.click();
  await wait(950);
  console.log('Log Performance opens for the extra workout:', doc.getElementById('logPerfOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Distance section visible:', !doc.getElementById('logPerfDistanceSection').hidden ? 'OK' : 'FAIL');

  const actualDist = 4.5;
  doc.getElementById('logPerfDistanceInput').value = actualDist;
  doc.getElementById('logPerfTimeInput').value = 40;
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  console.log('Navigated to Summary after logging the extra run:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');

  doc.getElementById('reviewRatingSlider').value = '4';
  doc.getElementById('reviewRatingSlider').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('submitReviewBtn').click();
  await wait(30);

  goPill('home');
  await wait(20);
  console.log('Extra workout now shows as done on Home:',
    doc.querySelector('#homeExtraWorkoutsWrap .manual-entry')?.textContent.includes('Trail Run') ? 'OK' : 'FAIL');
  const mileageAfter = mileageBaseline();
  console.log('Home "This Week" distance increased by the extra run\'s actual distance:',
    +(mileageAfter - mileageBefore).toFixed(1) === actualDist ? `OK (${mileageBefore} -> ${mileageAfter})` : `FAIL (${mileageBefore} -> ${mileageAfter}, expected +${actualDist})`);

  goPill('progress');
  await wait(20);
  const weekDetailText = doc.getElementById('progWeekDetail').textContent;
  console.log('Progress week-detail distance includes the extra run\'s actual distance:',
    weekDetailText.includes(`${actualDist.toFixed(1)} mi`) ? 'OK' : `FAIL (${weekDetailText})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
