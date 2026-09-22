const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function firePointer(el, type){
  el.dispatchEvent(new window.PointerEvent(type, {bubbles:true, cancelable:true, pointerId:1}));
}

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Plan a short interval workout for today so the timer has plenty of rounds to interrupt mid-way.
  goPill('home');
  await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Boxing Rounds';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='interval').click();
  doc.getElementById('createRoundsInput').value = '6';
  doc.getElementById('createWorkDurationInput').value = '1:00';
  doc.getElementById('createRestDurationInput').value = '1:00';
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  goPill('home');
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(20);
  console.log('Timer overlay opened:', doc.getElementById('intervalTimerOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Hold-to-end button is hidden before the timer starts:', doc.getElementById('timerHoldEndBtn').hidden===true ? 'OK' : 'FAIL');

  doc.getElementById('timerStartPauseBtn').click();
  await wait(50);
  console.log('Hold-to-end button stays hidden during the pre-start countdown:', doc.getElementById('timerHoldEndBtn').hidden===true ? 'OK' : 'FAIL');
  console.log('Phase shows Get Ready during the countdown:', doc.getElementById('timerPhaseLabel').textContent==='Get Ready' ? 'OK' : `FAIL (${doc.getElementById('timerPhaseLabel').textContent})`);

  await wait(5300); // the 5s pre-start countdown finishes, work phase begins
  console.log('Hold-to-end button appears once the work phase actually starts:', doc.getElementById('timerHoldEndBtn').hidden===false ? 'OK' : 'FAIL');

  // A short hold that's released early should NOT end the workout.
  const holdBtn = doc.getElementById('timerHoldEndBtn');
  firePointer(holdBtn, 'pointerdown');
  await wait(400);
  firePointer(holdBtn, 'pointerup');
  await wait(50);
  console.log('Releasing the hold early does not end the workout:', doc.getElementById('intervalTimerOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Still on the timer screen, not the summary:', doc.getElementById('screen-summary').hidden===true ? 'OK' : 'FAIL');

  // Holding past the full duration should conclude the workout early and go to Summary.
  firePointer(holdBtn, 'pointerdown');
  await wait(1300);
  console.log('Timer overlay closed after the full hold:', doc.getElementById('intervalTimerOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('Workout concludes early into the Summary screen:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');

  const roundsCell = [...doc.querySelectorAll('#summaryStats .cell')].find(c=>c.querySelector('.l').textContent==='Rounds');
  const roundsShown = roundsCell ? parseInt(roundsCell.querySelector('.v').textContent, 10) : null;
  console.log('Summary shows a round count less than the configured 6 (ended early):', roundsShown!==null && roundsShown<6 ? `OK (${roundsShown})` : `FAIL (${roundsShown})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
