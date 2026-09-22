const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function freshDom(){
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
}
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

function dump(doc){
  return [0,1,2,3,4,5,6].map(i => {
    const row = doc.querySelector(`.plan-row[data-day="${i}"][data-week-idx="0"]`);
    if(!row) return null;
    return {
      title: row.querySelector('.prow-title').textContent,
      detail: row.querySelector('.prow-detail')?.textContent || '',
      status: row.className.replace('plan-row ','').trim(),
    };
  });
}

function setSliderToWeightsOnly(doc, window){
  const thumb = doc.getElementById('adjSliderThumb');
  for(let i=0;i<4;i++){
    thumb.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  }
}

(async () => {
  // --- Case 1: today NOT yet done -- past history (missed + done) must survive, today onward regenerates ---
  {
    const dom = freshDom();
    const { window } = dom;
    await wait(50);
    const doc = window.document;
    const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

    // Past days default to blank/rest now (no more fabricated demo history), so both "Monday is
    // missed" and "Wednesday is already done" have to be established for real through the app's
    // own affordances first -- a missed real plan for Monday, a real logged entry for Wednesday.
    goPill('home'); await wait(20);
    doc.querySelector('#weekStrip .day-cell[data-day="0"]').click();
    await wait(20);
    doc.getElementById('addWorkoutBtn').click();
    await wait(20);
    doc.getElementById('manualNameInput').value = 'Morning Strength';
    doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
    [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
    if(doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
    doc.getElementById('saveManualEntry').click();
    await wait(20);
    doc.getElementById('closeDayDetail').click();
    await wait(10);

    goPill('home'); await wait(20);
    doc.querySelector('#weekStrip .day-cell[data-day="2"]').click();
    await wait(20);
    doc.getElementById('addWorkoutBtn').click();
    await wait(20);
    doc.getElementById('manualNameInput').value = 'Midweek Core';
    doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
    [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
    doc.getElementById('saveManualEntry').click();
    await wait(20);
    doc.getElementById('closeDayDetail').click();
    await wait(10);

    goPill('week'); await wait(20);
    const before = dump(doc);
    console.log('Before: Monday is missed:', before[0].status.includes('missed') ? 'OK' : `FAIL (${JSON.stringify(before[0])})`);
    console.log('Before: Wednesday is done:', before[2].status.includes('done') ? 'OK' : `FAIL (${JSON.stringify(before[2])})`);
    console.log('Before: Friday is today:', before[4].status.includes('today') ? 'OK' : `FAIL (${JSON.stringify(before[4])})`);
    const wedTitleBefore = before[2].title;

    goPill('home'); await wait(20);
    const workoutsBefore = doc.getElementById('ovWorkoutsVal').textContent;

    goPill('adjust'); await wait(20);
    setSliderToWeightsOnly(doc, window);
    await wait(20);
    doc.getElementById('applyAdjust').click();
    await wait(20);

    goPill('week'); await wait(20);
    const after = dump(doc);
    console.log('After focus switch: Monday STAYS missed (history preserved):', after[0].status.includes('missed') && !after[0].status.includes('done') ? 'OK' : `FAIL (${JSON.stringify(after[0])})`);
    console.log('After focus switch: Monday title unchanged (not silently regenerated):', after[0].title===before[0].title ? 'OK' : `FAIL (${after[0].title} vs ${before[0].title})`);
    console.log('After focus switch: Wednesday STAYS done with its original workout:', after[2].status.includes('done') && after[2].title===wedTitleBefore ? 'OK' : `FAIL (${JSON.stringify(after[2])})`);
    // Compare title+detail together: the pool can coincidentally reuse the same workout NAME at a
    // different slot (e.g. "Upper Body Strength" appears in both the balanced and weights-only
    // tables), so title alone isn't a reliable signal that the content actually regenerated --
    // the duration/detail is what actually distinguishes the two here.
    const beforeSig = before[4].title+'|'+before[4].detail, afterSig = after[4].title+'|'+after[4].detail;
    console.log('After focus switch: Friday (today) picks up a NEW weights-focused workout:', after[4].status.includes('today') && afterSig!==beforeSig ? 'OK' : `FAIL (${afterSig} vs before ${beforeSig})`);

    goPill('home'); await wait(20);
    console.log('Weekly workout count is unchanged by the switch alone (no history rewritten):', doc.getElementById('ovWorkoutsVal').textContent === workoutsBefore ? 'OK' : `FAIL (${workoutsBefore} -> ${doc.getElementById('ovWorkoutsVal').textContent})`);
    console.log('Note text is present in the Adjust sheet:', (() => {
      goPill('adjust');
      const t = doc.querySelector('.sheet-section .footer-note')?.textContent || '';
      return t.length>0 ? 'OK' : 'FAIL';
    })());
  }

  // --- Case 2: today ALREADY done -- today itself must also be preserved untouched; only tomorrow+ regenerates ---
  {
    const dom = freshDom();
    const { window } = dom;
    await wait(50);
    const doc = window.document;
    const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

    goPill('home'); await wait(20);
    doc.getElementById('recordBtn').click();
    await wait(950); // "recording" pulse delay, then the Log Performance sheet opens
    doc.getElementById('saveLogPerf').click(); // accept the seeded defaults -> startWorkout() fires, navigates to Summary
    await wait(50);

    goPill('week'); await wait(20);
    const beforeDone = dump(doc);
    console.log('Case 2 before: Friday (today) is now done:', beforeDone[4].status.includes('done') ? 'OK' : `FAIL (${JSON.stringify(beforeDone[4])})`);
    const fridayTitleBefore = beforeDone[4].title;
    const satTitleBefore = beforeDone[5].title;

    goPill('adjust'); await wait(20);
    setSliderToWeightsOnly(doc, window);
    await wait(20);
    doc.getElementById('applyAdjust').click();
    await wait(20);

    goPill('week'); await wait(20);
    const afterDone = dump(doc);
    console.log('Case 2 after: today stays DONE and keeps its already-completed workout:', afterDone[4].status.includes('done') && afterDone[4].title===fridayTitleBefore ? 'OK' : `FAIL (${JSON.stringify(afterDone[4])})`);
    console.log('Case 2 after: Saturday (a rest day, unaffected by trainingDays) still Rest Day:', afterDone[5].title==='Rest Day' ? 'OK' : `FAIL (${afterDone[5].title})`);
  }

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
