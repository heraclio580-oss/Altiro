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

  // --- A hike session has no progression, but should still get a review prompt. There's no
  // dedicated hike focus mode, so force a hike day via the app's own Create Workout override
  // instead -- a real, supported way for a hike-type session to occur on a given day. ---

  goPill('home');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click(); // undo today's completion from above
  await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('createCompletedToggle').click(); // switch to planning mode
  doc.getElementById('manualNameInput').value = 'Ridge Trail Hike';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='hike').click();
  doc.getElementById('saveManualEntry').click();
  await wait(30);

  goPill('home');
  await wait(20);
  console.log('Today is now the custom-planned hike:', doc.getElementById('sessionCard').querySelector('.title').textContent.includes('Ridge Trail Hike') ? 'OK' : 'FAIL');

  doc.getElementById('recordBtn').click();
  await wait(950);
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  console.log('Review card is still offered for a hike (no progression, but feedback still matters):', doc.getElementById('summaryReviewCard').hidden===false ? 'OK' : 'FAIL');
  setSlider(doc, 4);
  doc.getElementById('submitReviewBtn').click();
  await wait(30);
  console.log('No progression note for a hike even after review (nothing to progress):', doc.getElementById('summaryProgressNote').hidden===true ? 'OK' : 'FAIL');
  console.log('No crash, no "Next Suggested" stat for a hike:', !doc.getElementById('summaryStats').textContent.includes('Next Suggested') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
