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

// Covers the run-session half of the progression engine (the strength half is covered in
// test_progression.js). Switches focus to "Running Only" via the real Adjust sheet so today's
// session is deterministically a run, then drives the Log Performance sheet purely through DOM
// interaction, same convention as every other test in this suite (no internal state access).
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
  const title = doc.getElementById('sessionCard').querySelector('.title').textContent;
  console.log('Today is now a run session after switching to Running Only:', title.toLowerCase().includes('run') ? 'OK' : `FAIL (${title})`);
  console.log('Home shows a Next Suggested pace hint:', doc.getElementById('sessionCard').textContent.includes('/mi') ? 'OK' : 'FAIL');

  const recordBtn = doc.getElementById('recordBtn');
  recordBtn.click();
  await wait(950);

  console.log('Log Performance sheet opens:', doc.getElementById('logPerfOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Time section visible for a run:', !doc.getElementById('logPerfTimeSection').hidden ? 'OK' : 'FAIL');
  console.log('Weight/Reps sections hidden for a run:', doc.getElementById('logPerfWeightSection').hidden && doc.getElementById('logPerfRepsSection').hidden ? 'OK' : 'FAIL');
  const seededTime = parseFloat(doc.getElementById('logPerfTimeInput').value);
  console.log('Time field seeded with a sane suggested total time:', seededTime>0 ? `OK (${seededTime} min)` : 'FAIL');

  // Beat the suggested pace comfortably with a non-"hard" feel -> pace target should tighten by 5s/mi.
  const fastTime = Math.round(seededTime*0.85);
  doc.getElementById('logPerfTimeInput').value = fastTime;
  doc.getElementById('saveLogPerf').click();
  await wait(30);

  console.log('Navigated to Summary:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');
  console.log('Review card shown, no progression result yet:', doc.getElementById('summaryReviewCard').hidden===false && !doc.getElementById('summaryStats').textContent.includes('Next Suggested') ? 'OK' : 'FAIL');
  submitReview(doc, 5); // great, non-hard rating
  await wait(30);
  console.log('Summary includes a Next Suggested pace stat:', doc.getElementById('summaryStats').textContent.includes('Next Suggested') ? 'OK' : 'FAIL');
  console.log('Progression note shows the "up" (tightened pace) message:', doc.getElementById('summaryProgressMsg').textContent.startsWith("Nice work") ? 'OK' : `FAIL (${doc.getElementById('summaryProgressMsg').textContent})`);

  // Second round: reopen today, this time report a slow time with "Too Hard" feel -> should hold steady.
  goPill('home');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  const secondSeededTime = parseFloat(doc.getElementById('logPerfTimeInput').value);
  console.log('Second round reseeds with the tightened (faster) suggested time:', secondSeededTime < seededTime ? `OK (${secondSeededTime} < ${seededTime})` : `FAIL (${secondSeededTime} vs ${seededTime})`);

  const slowTime = Math.round(secondSeededTime*1.5);
  doc.getElementById('logPerfTimeInput').value = slowTime;
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  submitReview(doc, 1); // rough, "hard" rating
  await wait(30);
  console.log('Progression note shows the "hold steady" message after a slow/hard run:', doc.getElementById('summaryProgressMsg').textContent.startsWith('Solid effort') ? 'OK' : `FAIL (${doc.getElementById('summaryProgressMsg').textContent})`);

  goPill('home');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  const thirdSeededTime = parseFloat(doc.getElementById('logPerfTimeInput').value);
  console.log('Suggested time held steady (not regressed nor advanced) after the hard/slow run:', thirdSeededTime === secondSeededTime ? 'OK' : `FAIL (${thirdSeededTime} vs ${secondSeededTime})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
