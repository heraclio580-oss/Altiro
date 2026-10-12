const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function freshDom(){
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
}
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
// .plan-row uses pointerdown/pointerup (for press-and-hold drag support), not a plain click listener
// -- a synthetic .click() never reaches it. A same-spot pointerdown+pointerup (no movement, no wait
// for the long-press timer) is what the row's own code treats as a plain tap that opens Day Detail.
function tapPlanRow(window, row){
  const opts = {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:100};
  row.dispatchEvent(new window.PointerEvent('pointerdown', opts));
  row.dispatchEvent(new window.PointerEvent('pointerup', opts));
}
function dump(doc){
  return [0,1,2,3,4,5,6].map(i => {
    const row = doc.querySelector(`.plan-row[data-day="${i}"][data-week-idx="0"]`);
    if(!row) return null;
    return { title: row.querySelector('.prow-title').textContent, status: row.className.replace('plan-row ','').trim() };
  });
}

(async () => {
  const dom = freshDom();
  const { window } = dom;
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('adjust'); await wait(20);
  console.log('Outdoor hike toggle is gone from the Adjust sheet:', !doc.getElementById('outdoorToggle') ? 'OK' : 'FAIL');
  // Training days are just the day chips: tapping them sets how many and which (no 2-6 count chips).
  console.log('Training Days: the seven day chips, and no count chips:', !doc.getElementById('adjDayCountChips') && doc.querySelectorAll('#adjWeekdayChips .chip').length===7 ? 'OK' : 'FAIL');
  const selDays = () => [...doc.querySelectorAll('#adjWeekdayChips .chip')].map((c,i)=> c.classList.contains('sel') ? i : null).filter(i=> i!=null).join(',');
  const setDays = days => { for(let d=0; d<7; d++){ const c = doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`); if(c.classList.contains('sel') !== days.includes(d)) c.click(); } };

  const weekdayChip = i => doc.querySelectorAll('#adjWeekdayChips .chip')[i];
  console.log('Mon/Wed/Fri weekday chips are pre-selected:', [0,2,4].every(i=>weekdayChip(i).classList.contains('sel')) && [1,3,5,6].every(i=>!weekdayChip(i).classList.contains('sel')) ? 'OK' : 'FAIL');
  console.log('Days summary reads "3":', doc.getElementById('adjDaysSummary').textContent.includes('3') ? 'OK' : `FAIL (${doc.getElementById('adjDaysSummary').textContent})`);

  // --- Closing without Apply must NOT touch real state ---
  setDays([0,1,2,3,4]);
  await wait(10);
  doc.getElementById('closeAdjust').click();
  await wait(10);
  goPill('week'); await wait(20);
  console.log('Closing without Apply leaves the real week/plan untouched (still 3-day pattern):', doc.querySelector('.plan-row[data-day="1"][data-week-idx="0"] .prow-title').textContent==='Rest Day' ? 'OK' : 'FAIL');

  // --- Establish a REAL missed Monday (past days no longer auto-fabricate a workout at all -- see
  // buildWeek()/sessionForDate() -- so "missed" now only happens for a real plan the user actually
  // set for that day, left incomplete) ---
  // Monday is 4 days before today (a Friday) -- outside Home's rolling week-strip window (see
  // homeStripDates()), which only reaches 3 days back -- so open it via the Plan list instead.
  goPill('week'); await wait(20);
  tapPlanRow(window, doc.querySelector('.plan-row[data-day="0"][data-week-idx="0"]'));
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

  // --- Mark Wednesday done for real (past days default to blank/rest now -- no fabricated content
  // to toggle at all -- so "already done" has to come from an actual logged entry, same as Monday's
  // missed plan above; a blank/rest day's own Completed toggle no longer applies here) ---
  goPill('home'); await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="2"]').click();
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Midweek Core';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
  // Create Workout always defaults to "just planned" now -- mark it done explicitly.
  if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // --- Now actually change to a 5-day week (Mon-Fri) and Apply ---
  goPill('home'); await wait(20);
  const before = (() => { goPill('week'); return dump(doc); })();
  goPill('adjust'); await wait(20);
  console.log('Reopening Adjust shows the ORIGINAL 3-day selection (previous draft was discarded):', selDays()==='0,2,4' ? 'OK' : `FAIL (${selDays()})`);
  setDays([0,1,2,3,4]);
  await wait(10);
  console.log('Picking "5" selects Mon-Fri:', [0,1,2,3,4].every(i=>weekdayChip(i).classList.contains('sel')) && ![5,6].some(i=>weekdayChip(i).classList.contains('sel')) ? 'OK' : 'FAIL');
  doc.getElementById('applyAdjust').click();
  await wait(20);

  goPill('week'); await wait(20);
  const after = dump(doc);
  console.log('Monday (already missed under the old pattern) STAYS missed, untouched:', after[0].status.includes('missed') && after[0].title===before[0].title ? 'OK' : `FAIL (${JSON.stringify(after[0])})`);
  console.log('Wednesday (already done) STAYS done, untouched:', after[2].status.includes('done') && after[2].title===before[2].title ? 'OK' : `FAIL (${JSON.stringify(after[2])})`);
  console.log('Tuesday -- a REST day historically -- stays Rest Day (past days keep their real designation):', after[1].title==='Rest Day' ? 'OK' : `FAIL (${JSON.stringify(after[1])})`);
  console.log('Thursday -- also historically a REST day, and also in the past -- stays Rest Day too, even though the NEW 5-day pattern would make it a training day going forward:', after[3].title==='Rest Day' ? 'OK' : `FAIL (${JSON.stringify(after[3])})`);
  console.log('Friday (today, newly a training day under the 5-day pattern) has a real workout:', after[4].status.includes('today') && after[4].title!=='Rest Day' ? 'OK' : `FAIL (${JSON.stringify(after[4])})`);

  // --- Manually toggling individual weekday chips (not just presets) ---
  goPill('adjust'); await wait(20);
  console.log('Adjust now shows the committed 5-day selection:', selDays()==='0,1,2,3,4' ? 'OK' : `FAIL (${selDays()})`);
  weekdayChip(5).click(); // add Saturday -> 6 days, which the count chip is selected by length alone
  await wait(10);
  console.log('Manually adding Saturday makes it 6 days', selDays()==='0,1,2,3,4,5' && /6/.test(doc.getElementById('adjDaysSummary').textContent) ? 'OK' : `FAIL (${selDays()} / ${doc.getElementById('adjDaysSummary').textContent})`);
  weekdayChip(0).click(); // remove Monday
  await wait(10);
  console.log('Removing a day works too:', !weekdayChip(0).classList.contains('sel') ? 'OK' : 'FAIL');
  doc.getElementById('closeAdjust').click(); // discard this draft, don't apply

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
