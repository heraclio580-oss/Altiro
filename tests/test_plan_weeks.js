const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function firePointer(el, type, opts){
  el.dispatchEvent(new window.PointerEvent(type, Object.assign({bubbles:true, cancelable:true, pointerId:1}, opts)));
}

// jsdom has no real layout; the app picks a drop target from getBoundingClientRect-derived
// geometry (not elementFromPoint, which would hit the floating dragged row itself in a real
// browser), so give every .plan-row a synthetic rect purely from its FLAT index -- its position
// across the whole loaded Plan list, spanning every week block, since dragging/tapping can now
// cascade freely across week boundaries instead of being confined to one week block.
const ROW_H = 50;
function rowCenterY(flatIdx){ return flatIdx*ROW_H + ROW_H/2; }
window.Element.prototype.getBoundingClientRect = function(){
  const flatAttr = this.getAttribute && this.getAttribute('data-flat-idx');
  if(this.classList && this.classList.contains('plan-row') && flatAttr!==null){
    const top = parseInt(flatAttr,10)*ROW_H;
    return { top, bottom: top+ROW_H, left:0, right:300, width:300, height:ROW_H, x:0, y:top };
  }
  return { top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0 };
};

// Mirrors of the app's internal (closure-private) date helpers, so the test can compute
// expected values without reaching into the IIFE.
const WEEK_MONDAY = new Date(2026,8,14);
function weekDates2Global(offset=2){
  const days=[];
  for(let i=0;i<7;i++){ const d=new Date(WEEK_MONDAY); d.setDate(d.getDate()+offset*7+i); days.push(d); }
  return days;
}
function dateKeyGlobal(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
const MONTHS_FULL_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('week');
  await wait(20);
  const weekList = doc.getElementById('weekList');

  // --- Initial render shows PLAN_INITIAL_WEEKS (4) week blocks ---
  const blocksInitial = weekList.querySelectorAll('.week-block').length;
  console.log('Initial week blocks (expect 4):', blocksInitial, blocksInitial===4 ? 'OK' : 'FAIL');
  console.log('Sentinel present (more weeks available):', !!doc.getElementById('planScrollSentinel') ? 'OK' : 'FAIL');
  console.log('Week 0 label:', weekList.querySelector('.week-block[data-week-idx="0"] .week-block-label').textContent);
  console.log('Week 1 label (expect "Next Week"):', weekList.querySelector('.week-block[data-week-idx="1"] .week-block-label').textContent);
  console.log('Week 2 label (expect a date range):', weekList.querySelector('.week-block[data-week-idx="2"] .week-block-label').textContent);

  // --- Scrolling near the bottom loads more weeks ---
  const screenEl = doc.getElementById('screen-week');
  Object.defineProperty(screenEl, 'scrollHeight', {value: 2000, configurable:true});
  Object.defineProperty(screenEl, 'clientHeight', {value: 800, configurable:true});
  screenEl.scrollTop = 1900; // within 600px of "bottom" (2000-800=1200 threshold -> 1900 > 1200-600? logic: scrollTop+clientHeight>=scrollHeight-600 => 1900+800=2700 >= 1400 true
  screenEl.dispatchEvent(new window.Event('scroll'));
  await wait(10);
  const blocksAfterScroll = doc.getElementById('weekList').querySelectorAll('.week-block').length;
  console.log('Week blocks after scroll-near-bottom (expect 8):', blocksAfterScroll, blocksAfterScroll===8 ? 'OK' : 'FAIL');

  // Scroll again repeatedly until hitting the cap, verifying it stops at PLAN_MAX_WEEKS(20) and shows the limit note.
  for(let i=0;i<5;i++){
    Object.defineProperty(screenEl, 'scrollHeight', {value: 2000, configurable:true});
    Object.defineProperty(screenEl, 'clientHeight', {value: 800, configurable:true});
    screenEl.scrollTop = 1900;
    screenEl.dispatchEvent(new window.Event('scroll'));
    await wait(10);
  }
  const blocksAtCap = doc.getElementById('weekList').querySelectorAll('.week-block').length;
  console.log('Week blocks capped at 20:', blocksAtCap, blocksAtCap===20 ? 'OK' : 'FAIL');
  console.log('Sentinel removed once capped:', !doc.getElementById('planScrollSentinel') ? 'OK' : 'FAIL');
  console.log('Limit-reached note shown:', doc.getElementById('weekList').textContent.includes('planned as far ahead') ? 'OK' : 'FAIL');

  // --- Swap within a FUTURE week (week 2) should not affect week 1 or week 3 ---
  const week1Before = [...weekList.querySelectorAll('.week-block[data-week-idx="1"] .plan-row .prow-title')].map(b=>b.textContent);
  const week3Before = [...weekList.querySelectorAll('.week-block[data-week-idx="3"] .plan-row .prow-title')].map(b=>b.textContent);

  const week2Rows = weekList.querySelectorAll('.week-block[data-week-idx="2"] .plan-row[data-draggable="1"]');
  const srcRow = week2Rows[0];
  const dstRow = week2Rows[1];
  const srcBefore = srcRow.querySelector('.prow-title').textContent;
  const dstBefore = dstRow.querySelector('.prow-title').textContent;
  console.log('Week 2 swap candidates -> src:', srcBefore, '| dst:', dstBefore);

  const srcIdx = parseInt(srcRow.getAttribute('data-flat-idx'),10);
  const dstIdx = parseInt(dstRow.getAttribute('data-flat-idx'),10);
  firePointer(srcRow, 'pointerdown', {clientX:100, clientY:rowCenterY(srcIdx)});
  await wait(450);
  firePointer(srcRow, 'pointermove', {clientX:100, clientY:rowCenterY(dstIdx)});
  await wait(10);
  firePointer(srcRow, 'pointerup', {clientX:100, clientY:rowCenterY(dstIdx)});
  await wait(20);

  const wl2 = doc.getElementById('weekList');
  const srcAfter = wl2.querySelectorAll('.week-block[data-week-idx="2"] .plan-row[data-draggable="1"]')[0].querySelector('.prow-title').textContent;
  const dstAfter = wl2.querySelectorAll('.week-block[data-week-idx="2"] .plan-row[data-draggable="1"]')[1].querySelector('.prow-title').textContent;
  console.log('Week 2 after swap -> src:', srcAfter, '| dst:', dstAfter);
  console.log('Future-week swap worked:', (srcAfter===dstBefore && dstAfter===srcBefore) ? 'OK' : 'FAIL');

  const week1After = [...wl2.querySelectorAll('.week-block[data-week-idx="1"] .plan-row .prow-title')].map(b=>b.textContent);
  const week3After = [...wl2.querySelectorAll('.week-block[data-week-idx="3"] .plan-row .prow-title')].map(b=>b.textContent);
  console.log('Week 1 unaffected by week-2 swap:', JSON.stringify(week1Before)===JSON.stringify(week1After) ? 'OK' : 'FAIL');
  console.log('Week 3 unaffected by week-2 swap:', JSON.stringify(week3Before)===JSON.stringify(week3After) ? 'OK' : 'FAIL');

  // --- Cross-week drag now cascades freely across the week-block boundary instead of being
  // blocked at it -- dragging week 2's Monday all the way onto week 3's Monday shifts every day
  // in between back by one (week 2 shifts up within itself, pulling week 3's Monday in at the
  // end), exactly like an in-week cascade just spanning the block boundary. ---
  const weekTitles = w => [...wl2.querySelectorAll(`.week-block[data-week-idx="${w}"] .plan-row .prow-title`)].map(b=>b.textContent);
  const week2Before4 = weekTitles(2);
  const week3Before4 = weekTitles(3);
  const week4RowsBefore = weekTitles(4);
  const combinedBefore4 = week2Before4.concat(week3Before4);
  const week2RowForCrossTest = wl2.querySelectorAll('.week-block[data-week-idx="2"] .plan-row[data-draggable="1"]')[0];
  const week3RowForCrossTest = wl2.querySelector('.week-block[data-week-idx="3"] .plan-row[data-draggable="1"]');

  const crossSrcIdx = parseInt(week2RowForCrossTest.getAttribute('data-flat-idx'),10);
  const crossDstIdx = parseInt(week3RowForCrossTest.getAttribute('data-flat-idx'),10);
  firePointer(week2RowForCrossTest, 'pointerdown', {clientX:100, clientY:rowCenterY(crossSrcIdx)});
  await wait(450);
  firePointer(week2RowForCrossTest, 'pointermove', {clientX:100, clientY:rowCenterY(crossDstIdx)});
  await wait(10);
  console.log('Cross-week row IS highlighted as drop-target now that cascading is unrestricted:', week3RowForCrossTest.classList.contains('drop-target') ? 'OK' : 'FAIL');
  firePointer(week2RowForCrossTest, 'pointerup', {clientX:100, clientY:rowCenterY(crossDstIdx)});
  await wait(20);

  const wl3 = doc.getElementById('weekList');
  const week2After4 = [...wl3.querySelectorAll('.week-block[data-week-idx="2"] .plan-row .prow-title')].map(b=>b.textContent);
  const week3After4 = [...wl3.querySelectorAll('.week-block[data-week-idx="3"] .plan-row .prow-title')].map(b=>b.textContent);
  const combinedAfter4 = week2After4.concat(week3After4);
  // Everything strictly between the two endpoints shifts back by one, and the boundary slot
  // (week 3's Monday) receives the originally-dragged content -- the same math reorderAcrossPlan
  // uses internally, expressed here as a plain array shift so the expectation doesn't depend on
  // re-deriving the app's own arithmetic.
  const expectedCombined4 = combinedBefore4.slice(1,8).concat([combinedBefore4[0]], combinedBefore4.slice(8,14));
  console.log('Cross-week-boundary cascade produced the expected shift:', JSON.stringify(combinedAfter4)===JSON.stringify(expectedCombined4) ? 'OK' : `FAIL (got ${JSON.stringify(combinedAfter4)}, expected ${JSON.stringify(expectedCombined4)})`);
  const week4RowsAfter = [...wl3.querySelectorAll('.week-block[data-week-idx="4"] .plan-row .prow-title')].map(b=>b.textContent);
  console.log('Week 4 (beyond the drag range) unaffected:', JSON.stringify(week4RowsBefore)===JSON.stringify(week4RowsAfter) ? 'OK' : 'FAIL');

  // --- Tap-to-open Day Detail still works in a future week block ---
  const week3Row = wl3.querySelector('.week-block[data-week-idx="3"] .plan-row');
  firePointer(week3Row.querySelector('.prow-body'), 'pointerdown', {clientX:50, clientY:50});
  await wait(20);
  firePointer(week3Row.querySelector('.prow-body'), 'pointerup', {clientX:50, clientY:50});
  await wait(10);
  console.log('Tap in a future week block opens Day Detail:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Complete toggle hidden for a future day:', doc.getElementById('dayDetailCompleteSection').hidden===true ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();

  // --- Cross-screen consistency: week 2's final content should also show up in Calendar's month view for that date ---
  // Week 2 is weekDates(2); its first draggable (non-today) row is index 0 (Monday) since week 2 is fully future.
  // The expected content is week2After4[0] (post cross-week-cascade), not the earlier dstBefore --
  // the boundary-crossing drag above moved this same slot's content again.
  const swappedDate = weekDates2Global()[0];
  const finalMondayContent = week2After4[0];
  goPill('calendar');
  await wait(20);
  // Navigate forward the right number of months to land on the swapped date's month.
  const monthLabel = () => doc.getElementById('calRange').textContent;
  const targetLabel = `${MONTHS_FULL_EN[swappedDate.getMonth()]} ${swappedDate.getFullYear()}`;
  let guard = 0;
  while(monthLabel() !== targetLabel && guard < 30){ doc.getElementById('calNext').click(); guard++; }
  const cell = doc.querySelector(`.mo-cell[data-date="${dateKeyGlobal(swappedDate)}"]`);
  console.log('Found the swapped date in Calendar month grid:', !!cell ? 'OK' : 'FAIL');
  cell.click();
  await wait(10);
  const calPlanText = doc.getElementById('dayDetailPlanRow').textContent;
  console.log('Calendar day-detail for swapped date shows the final swapped content:', calPlanText.includes(finalMondayContent) ? 'OK' : 'FAIL', '| got:', calPlanText.replace(/\s+/g,' ').trim());
  doc.getElementById('closeDayDetail').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
