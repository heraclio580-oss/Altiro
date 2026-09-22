const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function rows(doc){ return [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')]; }
function setLogRows(row){ return [...row.querySelectorAll('.set-log-row')]; }
function fillSet(setRow, weight, reps){
  setRow.querySelector('[data-field="weight"]').value = String(weight);
  setRow.querySelector('[data-field="reps"]').value = String(reps);
}

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);

  const r = rows(doc);
  const weightedRow = r.find(row=>!row.classList.contains('bodyweight'));
  console.log('Found a weighted exercise row to test per-set logging on:', !!weightedRow ? 'OK' : 'FAIL');

  // Pyramid set: 60x10, 70x10, 90x5, 70x10 -- a real, varying set-by-set log, matching the
  // motivating example (not one weight applied to every set).
  const setRowsBefore = setLogRows(weightedRow);
  console.log('Exercise starts with its prescribed number of set rows, each with its own weight/reps inputs:', setRowsBefore.length>0 ? `OK (${setRowsBefore.length})` : 'FAIL');

  // Use the set-count stepper to get to exactly 4 sets before filling them in.
  const stepperBtns = weightedRow.querySelectorAll('.set-stepper-btn');
  const minusBtn = [...stepperBtns].find(b=>b.getAttribute('data-step')==='-1');
  const plusBtn = [...stepperBtns].find(b=>b.getAttribute('data-step')==='1');
  while(setLogRows(weightedRow).length > 4) minusBtn.click();
  while(setLogRows(weightedRow).length < 4) plusBtn.click();
  console.log('Set-count stepper adjusts the exercise to exactly 4 sets:', setLogRows(weightedRow).length===4 ? 'OK' : `FAIL (${setLogRows(weightedRow).length})`);
  console.log('The sets x reps label updates to match the new set count:', weightedRow.querySelector('.exercise-log-name span').textContent.startsWith('4 x') ? 'OK' : `FAIL (${weightedRow.querySelector('.exercise-log-name span').textContent})`);

  console.log('Set-count stepper refuses to go below 1 set:', (()=>{ while(setLogRows(weightedRow).length>1) minusBtn.click(); minusBtn.click(); return setLogRows(weightedRow).length===1; })() ? 'OK' : 'FAIL');
  while(setLogRows(weightedRow).length < 4) plusBtn.click();

  const pyramid = [[60,10],[70,10],[90,5],[70,10]];
  const finalSetRows = setLogRows(weightedRow);
  pyramid.forEach(([w,rep], i)=> fillSet(finalSetRows[i], w, rep));
  finalSetRows.forEach(sr => sr.querySelector('.set-check-dot').click());
  console.log('All 4 sets checked off after logging them:', weightedRow.classList.contains('set-complete') ? 'OK' : 'FAIL');

  doc.getElementById('saveLogPerf').click();
  await wait(30);

  console.log('Navigated to Summary after saving the pyramid set:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');
  const summaryText = doc.getElementById('summaryExercisesList').textContent;
  console.log('Summary shows every set\'s own weight x reps, not one number for all of them:',
    ['60x10','70x10','90x5','70x10'].every(s=>summaryText.includes(s)) ? 'OK' : `FAIL (${summaryText})`);

  doc.getElementById('reviewRatingSlider').value = '5';
  doc.getElementById('reviewRatingSlider').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('submitReviewBtn').click();
  await wait(30);
  console.log('Review submits fine with a pyramid-logged exercise:', doc.getElementById('summaryReviewCard').hidden===true ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
