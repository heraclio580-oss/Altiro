const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function rows(doc){ return [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')]; }

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  console.log('Log Performance sheet opened:', doc.getElementById('logPerfOverlay').hidden===false ? 'OK' : 'FAIL');

  const r = rows(doc);
  console.log('Today\'s strength session has a structured exercise breakdown to check off:', r.length>0 ? `OK (${r.length})` : 'FAIL');

  const firstDots = [...r[0].querySelectorAll('.set-check-dot')];
  console.log('First exercise row shows one checkbox dot per set:', firstDots.length>0 ? `OK (${firstDots.length})` : 'FAIL');
  console.log('First exercise starts as the highlighted "current" one:', r[0].classList.contains('current-exercise') ? 'OK' : 'FAIL');
  console.log('No dots checked yet:', firstDots.every(d=>!d.classList.contains('checked')) ? 'OK' : 'FAIL');

  firstDots[0].click();
  console.log('Tapping a dot checks that set:', doc.querySelector('#logPerfExercisesList .exercise-log-row .set-check-dot').classList.contains('checked') ? 'OK' : 'FAIL');
  console.log('Row not yet marked complete (other sets still unchecked):', firstDots.length>1 ? (!r[0].classList.contains('set-complete') ? 'OK' : 'FAIL') : 'SKIP (single-set exercise)');

  // Check off every remaining set on the first exercise -- it should be marked complete and
  // "current" should auto-advance to the next exercise (this is the "select the next workout and
  // sets" behavior).
  [...r[0].querySelectorAll('.set-check-dot')].forEach(d=>{ if(!d.classList.contains('checked')) d.click(); });
  console.log('First exercise now marked complete once every set is checked:', r[0].classList.contains('set-complete') ? 'OK' : 'FAIL');
  if(r.length>1){
    console.log('Current-exercise highlight auto-advances to the next incomplete exercise:', !r[0].classList.contains('current-exercise') && r[1].classList.contains('current-exercise') ? 'OK' : `FAIL (row0 current=${r[0].classList.contains('current-exercise')}, row1 current=${r[1].classList.contains('current-exercise')})`);
  }

  // Checking off sets doesn't clobber the weight/reps the seeded/typed values.
  const weightVal = r[0].querySelector('[data-field="weight"]').value;
  console.log('Weight/reps inputs keep their values after toggling set checkboxes:', weightVal!=='' ? `OK (${weightVal})` : 'FAIL');

  // A notes field is available while the workout is being logged.
  const notesInput = doc.getElementById('logPerfNotesInput');
  console.log('A live Notes field is present in the Log Performance sheet:', !!notesInput ? 'OK' : 'FAIL');
  notesInput.value = 'Felt strong today, bumped up the last set';
  doc.getElementById('saveLogPerf').click();
  await wait(30);

  console.log('Navigated to Summary after saving:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');
  console.log('Review notes are pre-filled with what was jotted down live:', doc.getElementById('reviewNotesInput').value==='Felt strong today, bumped up the last set' ? 'OK' : `FAIL (${doc.getElementById('reviewNotesInput').value})`);

  doc.getElementById('reviewRatingSlider').value = '5';
  doc.getElementById('reviewRatingSlider').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('submitReviewBtn').click();
  await wait(30);
  console.log('Review submits fine with the pre-filled notes:', doc.getElementById('summaryReviewCard').hidden===true ? 'OK' : 'FAIL');

  // Reopening a fresh Log Performance sheet later resets the live set-checkoff state.
  goPill('home');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  const freshDots = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')[0].querySelectorAll('.set-check-dot')];
  console.log('Reopening the sheet resets set-checkoff state (nothing pre-checked):', freshDots.every(d=>!d.classList.contains('checked')) ? 'OK' : 'FAIL');
  console.log('Notes field also resets to empty on reopen:', doc.getElementById('logPerfNotesInput').value==='' ? 'OK' : 'FAIL');
  doc.getElementById('closeLogPerf').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
