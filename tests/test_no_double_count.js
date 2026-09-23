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
//
// The Progress screen's own Total Workouts/Total Distance bubbles were later removed (the user
// wanted only the bar chart / week-detail / PRs kept), so this reads the underlying totals through
// what's still on screen instead: the "This Week" week-detail card (workouts/distance for the
// selected week) and Home's streak chip. Since this test never leaves the current week, "this
// week" and the running lifetime totals move identically throughout.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  const readWeekDetail = () => {
    const vals = [...doc.querySelectorAll('#progWeekDetail .wd-stat .v')];
    return { workouts: parseInt(vals[0].textContent,10), distance: parseFloat(vals[1].textContent) };
  };
  const readStreak = () => {
    goPill('home');
    return parseInt(doc.getElementById('streakChip').textContent, 10);
  };

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
  const { workouts: workoutsBefore, distance: distBefore } = readWeekDetail();
  const streakBefore = readStreak();

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
  const afterFirst = readWeekDetail();
  console.log('First record: Total Workouts +1:', afterFirst.workouts===workoutsBefore+1 ? 'OK' : `FAIL (${afterFirst.workouts})`);
  console.log('First record: Total Distance +4.0:', +(afterFirst.distance-distBefore).toFixed(1)===4.0 ? 'OK' : `FAIL (${afterFirst.distance})`);
  const streakAfterFirst = readStreak();
  console.log('First record: Streak +1:', streakAfterFirst===streakBefore+1 ? 'OK' : `FAIL (${streakAfterFirst})`);

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
  const afterSecond = readWeekDetail();
  console.log('Re-recording the same day does NOT bump Total Workouts a second time:',
    afterSecond.workouts===workoutsBefore+1 ? 'OK' : `FAIL (${afterSecond.workouts}, expected still ${workoutsBefore+1})`);
  const streakAfterSecond = readStreak();
  console.log('Re-recording does NOT bump the streak a second time:',
    streakAfterSecond===streakBefore+1 ? 'OK' : `FAIL (${streakAfterSecond}, expected still ${streakBefore+1})`);
  console.log('Total Distance reflects the CORRECTED distance (6.0), not both stacked (4.0+6.0=10.0):',
    +(afterSecond.distance-distBefore).toFixed(1)===6.0 ? 'OK' : `FAIL (${afterSecond.distance}, expected +6.0)`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
