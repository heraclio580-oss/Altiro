const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function setSlider(doc, val){
  doc.getElementById('reviewRatingSlider').value = String(val);
  doc.getElementById('reviewRatingSlider').dispatchEvent(new window.Event('input', {bubbles:true}));
}

// Covers the post-workout review UI itself (rating slider labels, optional notes, and that it's
// offered even for a workout type -- hike -- that has no progression tracking).
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  doc.getElementById('saveLogPerf').click();
  await wait(30);

  console.log('Review card visible immediately after finishing:', doc.getElementById('summaryReviewCard').hidden===false ? 'OK' : 'FAIL');
  console.log('Rating slider defaults to the middle (3):', doc.getElementById('reviewRatingSlider').value==='3' ? 'OK' : 'FAIL');
  console.log('Notes field starts empty:', doc.getElementById('reviewNotesInput').value==='' ? 'OK' : 'FAIL');

  setSlider(doc, 1);
  console.log('Moving the slider to 1 shows the "Rough" label:', doc.getElementById('reviewRatingLabel').textContent.includes('Rough') ? 'OK' : `FAIL (${doc.getElementById('reviewRatingLabel').textContent})`);
  setSlider(doc, 5);
  console.log('Moving the slider to 5 shows the "Great" label:', doc.getElementById('reviewRatingLabel').textContent.includes('Great') ? 'OK' : `FAIL (${doc.getElementById('reviewRatingLabel').textContent})`);
  setSlider(doc, 3);
  console.log('Middle of the scale shows the "OK" label:', doc.getElementById('reviewRatingLabel').textContent.includes('OK') ? 'OK' : `FAIL (${doc.getElementById('reviewRatingLabel').textContent})`);

  doc.getElementById('reviewNotesInput').value = 'Legs felt heavy but pushed through';
  doc.getElementById('submitReviewBtn').click();
  await wait(30);
  console.log('Review card hides after submitting:', doc.getElementById('summaryReviewCard').hidden===true ? 'OK' : 'FAIL');
  console.log('Progression note now visible (this was a strength/run session):', doc.getElementById('summaryProgressNote').hidden===false ? 'OK' : 'FAIL');

  // --- An interval session has no progression, but should still get a review prompt. Plan a
  // very short interval workout for today so the real timer can run to completion quickly. ---

  goPill('home');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click(); // undo today's completion from above
  await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Speed Bag Rounds';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='interval').click();
  console.log('Picking Interval hides the "Mark as Completed" toggle (it completes via the timer, not a checkbox):', doc.getElementById('createCompletedSection').hidden===true ? 'OK' : 'FAIL');
  doc.getElementById('createRoundsInput').value = '1';
  doc.getElementById('createWorkDurationInput').value = '0:01';
  doc.getElementById('createRestDurationInput').value = '0:01';
  doc.getElementById('saveManualEntry').click();
  await wait(30);

  goPill('home');
  await wait(20);
  console.log('Today is now the custom-planned interval workout:', doc.getElementById('sessionCard').querySelector('.title').textContent.includes('Speed Bag Rounds') ? 'OK' : 'FAIL');
  console.log('Record button offers to start the timer instead of recording:', doc.getElementById('recordLabel').textContent === 'Start Timer' ? 'OK' : `FAIL (${doc.getElementById('recordLabel').textContent})`);

  doc.getElementById('recordBtn').click();
  await wait(20);
  console.log('Interval timer overlay opens (no recording pulse, straight to the timer):', doc.getElementById('intervalTimerOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Timer pre-loads the 1 round / 1s work / 1s rest just configured:', doc.getElementById('timerRoundsVal').textContent==='1' && doc.getElementById('timerWorkVal').textContent==='0:01' && doc.getElementById('timerRestVal').textContent==='0:01' ? 'OK' : 'FAIL');

  doc.getElementById('timerStartPauseBtn').click();
  await wait(7400); // 5s pre-start countdown + 1s work + 1s rest + tick overhead -> should reach "done" with 1 round
  console.log('Timer reaches "all rounds complete" and offers Finish:', doc.getElementById('timerFinishBtn').hidden===false ? 'OK' : `FAIL (phase: ${doc.getElementById('timerPhaseLabel').textContent})`);

  doc.getElementById('timerFinishBtn').click();
  await wait(30);
  console.log('Finishing the timer navigates to Summary:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');
  console.log('Summary shows the round count from the timer:', doc.getElementById('summaryStats').textContent.includes('1') ? 'OK' : 'FAIL');
  console.log('Review card is still offered for an interval workout (no progression, but feedback still matters):', doc.getElementById('summaryReviewCard').hidden===false ? 'OK' : 'FAIL');
  setSlider(doc, 4);
  doc.getElementById('submitReviewBtn').click();
  await wait(30);
  console.log('No progression note for an interval workout even after review (nothing to progress):', doc.getElementById('summaryProgressNote').hidden===true ? 'OK' : 'FAIL');
  console.log('No crash, no "Next Suggested" stat for an interval workout:', !doc.getElementById('summaryStats').textContent.includes('Next Suggested') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
