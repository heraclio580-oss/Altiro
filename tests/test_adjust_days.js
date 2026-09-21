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
  console.log('Training Days section is present instead:', !!doc.getElementById('adjDayCountChips') && !!doc.getElementById('adjWeekdayChips') ? 'OK' : 'FAIL');

  const countChips = () => [...doc.querySelectorAll('#adjDayCountChips .chip')];
  console.log('Day-count chips render 2-6:', countChips().map(c=>c.textContent).join(',')==='2,3,4,5,6' ? 'OK' : `FAIL (${countChips().map(c=>c.textContent).join(',')})`);
  console.log('Default 3-day preset (Mon/Wed/Fri) is pre-selected:', countChips().find(c=>c.textContent==='3').classList.contains('sel') ? 'OK' : 'FAIL');

  const weekdayChip = i => doc.querySelectorAll('#adjWeekdayChips .chip')[i];
  console.log('Mon/Wed/Fri weekday chips are pre-selected:', [0,2,4].every(i=>weekdayChip(i).classList.contains('sel')) && [1,3,5,6].every(i=>!weekdayChip(i).classList.contains('sel')) ? 'OK' : 'FAIL');
  console.log('Days summary reads "3":', doc.getElementById('adjDaysSummary').textContent.includes('3') ? 'OK' : `FAIL (${doc.getElementById('adjDaysSummary').textContent})`);

  // --- Closing without Apply must NOT touch real state ---
  countChips().find(c=>c.textContent==='5').click();
  await wait(10);
  doc.getElementById('closeAdjust').click();
  await wait(10);
  goPill('week'); await wait(20);
  console.log('Closing without Apply leaves the real week/plan untouched (still 3-day pattern):', doc.querySelector('.plan-row[data-day="1"][data-week-idx="0"] .prow-title').textContent==='Rest Day' ? 'OK' : 'FAIL');

  // --- Mark Wednesday done for real (past days default to NOT completed now -- no more fabricated
  // demo history -- so "already done" has to be established through the app's own affordances) ---
  goPill('home'); await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="2"]').click();
  await wait(20);
  doc.getElementById('dayCompleteToggle').click();
  await wait(10);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // --- Now actually change to a 5-day week (Mon-Fri) and Apply ---
  goPill('home'); await wait(20);
  const before = (() => { goPill('week'); return dump(doc); })();
  goPill('adjust'); await wait(20);
  console.log('Reopening Adjust shows the ORIGINAL 3-day selection (previous draft was discarded):', countChips().find(c=>c.textContent==='3').classList.contains('sel') ? 'OK' : 'FAIL');
  countChips().find(c=>c.textContent==='5').click();
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
  console.log('Adjust now shows the committed 5-day selection:', countChips().find(c=>c.textContent==='5').classList.contains('sel') ? 'OK' : 'FAIL');
  weekdayChip(5).click(); // add Saturday -> 6 days, which the count chip is selected by length alone
  await wait(10);
  console.log('Manually adding Saturday moves the count selection to "6" (selection tracks count, not a fixed preset):', countChips().find(c=>c.textContent==='6').classList.contains('sel') && weekdayChip(5).classList.contains('sel') ? 'OK' : 'FAIL');
  weekdayChip(0).click(); // remove Monday
  await wait(10);
  console.log('Removing a day works too:', !weekdayChip(0).classList.contains('sel') ? 'OK' : 'FAIL');
  doc.getElementById('closeAdjust').click(); // discard this draft, don't apply

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
