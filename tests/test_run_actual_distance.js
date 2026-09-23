const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function submitReview(doc, rating){
  doc.getElementById('reviewRatingSlider').value = String(rating);
  doc.getElementById('reviewRatingSlider').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('submitReviewBtn').click();
}

// Regression test for the reported bug: "I just completed a run and when I submit the times and
// distance they dont match at all on the progress." Root cause was that no run's ACTUAL distance
// was ever captured -- every distance-dependent stat (Summary, weekly total, lifetime total) always
// used the PLANNED distance baked into the session text, regardless of what the user really ran.
// This drives a run whose logged distance is deliberately different from the plan, purely through
// DOM interaction, and checks every place that distance surfaces reflects the real, entered value.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('adjust');
  await wait(20);
  const thumb = doc.getElementById('adjSliderThumb');
  for(let i=0;i<4;i++){
    thumb.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
  }
  await wait(20);
  doc.getElementById('applyAdjust').click();
  await wait(20);

  goPill('home');
  await wait(20);
  const mileageBefore = parseFloat(doc.getElementById('ovDistanceVal').textContent);
  const title = doc.getElementById('sessionCard').querySelector('.title').textContent;
  console.log('Today is a run session after switching to Running Only:', title.toLowerCase().includes('run') ? 'OK' : `FAIL (${title})`);

  doc.getElementById('recordBtn').click();
  await wait(950);

  console.log('Log Performance sheet opens:', doc.getElementById('logPerfOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Distance section visible for a run:', !doc.getElementById('logPerfDistanceSection').hidden ? 'OK' : 'FAIL');

  const plannedDist = parseFloat(doc.getElementById('logPerfDistanceInput').value);
  console.log('Distance field is pre-filled with the planned distance:', plannedDist>0 ? `OK (${plannedDist} mi)` : 'FAIL');

  // Log a genuinely different distance and time than what was planned/prescribed.
  const actualDist = +(plannedDist + 2.7).toFixed(1);
  const actualTime = 41;
  doc.getElementById('logPerfDistanceInput').value = actualDist;
  doc.getElementById('logPerfTimeInput').value = actualTime;
  doc.getElementById('saveLogPerf').click();
  await wait(30);

  console.log('Navigated to Summary:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');
  const summaryText = doc.getElementById('summaryStats').textContent;
  console.log('Summary shows the ACTUAL logged distance, not the planned one:',
    summaryText.includes(`${actualDist.toFixed(1)} mi`) && !summaryText.includes(`${plannedDist.toFixed(1)} mi`) ? 'OK' : `FAIL (${summaryText})`);
  const expectedPaceMin = actualTime/actualDist;
  const expectedPaceStr = `${Math.floor(expectedPaceMin)}:${String(Math.round((expectedPaceMin%1)*60)).padStart(2,'0')}/mi`;
  console.log('Summary pace is computed from the actual distance/time, not the plan\'s:',
    summaryText.includes(expectedPaceStr) ? `OK (${expectedPaceStr})` : `FAIL (${summaryText}, expected pace ${expectedPaceStr})`);

  submitReview(doc, 4);
  await wait(30);

  goPill('home');
  await wait(20);
  const mileageAfter = parseFloat(doc.getElementById('ovDistanceVal').textContent);
  console.log('Home "This Week" distance increased by exactly the actual run distance (not the plan\'s):',
    +(mileageAfter - mileageBefore).toFixed(1) === actualDist ? `OK (${mileageBefore} -> ${mileageAfter})` : `FAIL (${mileageBefore} -> ${mileageAfter}, expected +${actualDist})`);

  goPill('progress');
  await wait(20);
  const weekDetailText = doc.getElementById('progWeekDetail').textContent;
  console.log('Progress week-detail distance reflects the actual run distance, not the plan\'s:',
    weekDetailText.includes(`${actualDist.toFixed(1)} mi`) ? 'OK' : `FAIL (${weekDetailText})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
