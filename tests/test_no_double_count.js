const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for a reported bug: "Total days and miles don't match up" -- Total Workouts/Total
// Distance on the Progress screen were way out of proportion to what "This Week" showed. Root cause:
// startWorkout() incremented streak/totalWorkouts/mileage/totalDistance unconditionally on every
// Record-Save, with no guard for re-recording a day that was already done (e.g. toggling "not done"
// then recording again to fix a mistaken entry, which happens constantly during real use and
// testing) -- each re-record silently counted as a brand new distinct day and stacked its distance
// on top of the previous one instead of replacing it.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Force today to be a run session so distance is exercised too.
  goPill('adjust');
  await wait(20);
  const thumb = doc.getElementById('adjSliderThumb');
  for(let i=0;i<4;i++) thumb.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
  await wait(20);
  doc.getElementById('applyAdjust').click();
  await wait(20);

  goPill('progress');
  await wait(20);
  const workoutsBefore = parseInt(doc.getElementById('progTotalWorkouts').textContent, 10);
  const distBefore = parseFloat(doc.getElementById('progTotalDistance').textContent);
  const streakBefore = parseInt(doc.getElementById('progStreak').textContent, 10);

  const recordRun = (dist) => {
    doc.getElementById('recordBtn').click();
    return wait(950).then(()=>{
      doc.getElementById('logPerfDistanceInput').value = dist;
      doc.getElementById('logPerfTimeInput').value = 30;
      doc.getElementById('saveLogPerf').click();
      return wait(30);
    });
  };

  goPill('home');
  await wait(20);
  await recordRun(4);
  doc.getElementById('reviewRatingSlider').value = '4';
  doc.getElementById('reviewRatingSlider').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('submitReviewBtn').click();
  await wait(30);

  goPill('progress');
  await wait(20);
  console.log('First record: Total Workouts +1:',
    parseInt(doc.getElementById('progTotalWorkouts').textContent,10)===workoutsBefore+1 ? 'OK' : `FAIL (${doc.getElementById('progTotalWorkouts').textContent})`);
  console.log('First record: Total Distance +4.0:',
    +(parseFloat(doc.getElementById('progTotalDistance').textContent)-distBefore).toFixed(1)===4.0 ? 'OK' : `FAIL (${doc.getElementById('progTotalDistance').textContent})`);
  console.log('First record: Streak +1:',
    parseInt(doc.getElementById('progStreak').textContent,10)===streakBefore+1 ? 'OK' : `FAIL (${doc.getElementById('progStreak').textContent})`);

  // Toggle "not done" then re-record the SAME day with a corrected (different) distance -- a real,
  // common flow (fixing a typo'd distance), not a contrived edge case.
  goPill('home');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  await recordRun(6); // corrected distance, not additive
  doc.getElementById('reviewRatingSlider').value = '4';
  doc.getElementById('reviewRatingSlider').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('submitReviewBtn').click();
  await wait(30);

  goPill('progress');
  await wait(20);
  console.log('Re-recording the same day does NOT bump Total Workouts a second time:',
    parseInt(doc.getElementById('progTotalWorkouts').textContent,10)===workoutsBefore+1 ? 'OK' : `FAIL (${doc.getElementById('progTotalWorkouts').textContent}, expected still ${workoutsBefore+1})`);
  console.log('Re-recording does NOT bump the streak a second time:',
    parseInt(doc.getElementById('progStreak').textContent,10)===streakBefore+1 ? 'OK' : `FAIL (${doc.getElementById('progStreak').textContent}, expected still ${streakBefore+1})`);
  console.log('Total Distance reflects the CORRECTED distance (6.0), not both stacked (4.0+6.0=10.0):',
    +(parseFloat(doc.getElementById('progTotalDistance').textContent)-distBefore).toFixed(1)===6.0 ? 'OK' : `FAIL (${doc.getElementById('progTotalDistance').textContent}, expected +6.0)`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
