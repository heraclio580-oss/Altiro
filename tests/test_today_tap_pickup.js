const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function tap(el){
  el.dispatchEvent(new window.PointerEvent('pointerdown', {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:100}));
  el.dispatchEvent(new window.PointerEvent('pointerup', {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:100}));
}
// Plain array shift matching reorderAcrossPlan(s,t)'s own math: everything strictly between the
// two endpoints pulls back by one, and the target slot receives the originally-picked-up content.
function expectedAfterMove(before, s, t){
  const step = s<t ? 1 : -1;
  const out = before.slice();
  for(let i=s; i!==t; i+=step) out[i] = before[i+step];
  out[t] = before[s];
  return out;
}

// Reported: even after tap-to-move via the grip handle shipped, today's slot specifically was
// still hard to pick up on a real phone (the grip sits in a crowded corner next to the "Today"
// badge). Today is now special-cased: a plain tap ANYWHERE on its row body picks it up (the same
// "pop up" reorder-source feedback as tapping the grip), and it can then be moved to any future
// date -- including one in a different week block -- with one more tap, or by dragging it there.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('week');
  await wait(20);
  const weekList = doc.getElementById('weekList');
  const rowFor = (w,i) => weekList.querySelector(`.plan-row[data-day="${i}"][data-week-idx="${w}"]`);
  const titlesOfWeek = w => [0,1,2,3,4,5,6].map(i => rowFor(w,i).querySelector('.prow-title').textContent);
  const todayIdx = [...weekList.querySelectorAll('.plan-row[data-week-idx="0"]')].findIndex(r=>r.classList.contains('today'));

  console.log('Today row is draggable and has a grip handle:',
    rowFor(0,todayIdx).getAttribute('data-draggable')==='1' && !!rowFor(0,todayIdx).querySelector('.drag-handle') ? 'OK' : 'FAIL');

  // --- Tapping today's row BODY (not the grip) picks it up ---
  const week0Before = titlesOfWeek(0);
  tap(rowFor(0,todayIdx).querySelector('.prow-body'));
  await wait(10);
  console.log('Tapping today\'s row body picks it up as the reorder source:', rowFor(0,todayIdx).classList.contains('reorder-source') ? 'OK' : 'FAIL');
  console.log('Day Detail did NOT open from that tap:', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('A later same-week day is marked as an eligible reorder target:', rowFor(0,6).classList.contains('reorder-target') ? 'OK' : 'FAIL');

  // --- Tapping the SAME row again cancels the pending pick-up ---
  tap(rowFor(0,todayIdx));
  await wait(10);
  console.log('Tapping today again cancels the pending pick-up:', !weekList.querySelector('.reorder-source') ? 'OK' : 'FAIL');
  console.log('Nothing moved from cancelling:', JSON.stringify(titlesOfWeek(0))===JSON.stringify(week0Before) ? 'OK' : 'FAIL');

  // --- Pick today back up (body tap) and complete the move onto a later day in the SAME week ---
  tap(rowFor(0,todayIdx).querySelector('.prow-body'));
  await wait(10);
  tap(rowFor(0,6).querySelector('.prow-body')); // Sunday, last row of week 0
  await wait(20);
  const week0AfterSameWeek = titlesOfWeek(0);
  const expectedSameWeek = expectedAfterMove(week0Before, todayIdx, 6);
  console.log('Same-week move (via two body taps) produced the expected shift:',
    JSON.stringify(week0AfterSameWeek)===JSON.stringify(expectedSameWeek) ? 'OK' : `FAIL (got ${JSON.stringify(week0AfterSameWeek)}, expected ${JSON.stringify(expectedSameWeek)})`);
  console.log('No row left marked as a pending reorder source:', !weekList.querySelector('.reorder-source') ? 'OK' : 'FAIL');

  // --- Today (same date, now holding different content) can also be picked up by a body tap and
  // moved into a FUTURE WEEK BLOCK -- no longer capped at the current week the way it used to be ---
  const week1Before = titlesOfWeek(1);
  tap(rowFor(0,todayIdx).querySelector('.prow-body'));
  await wait(10);
  console.log('Today picked up again for the cross-week move:', rowFor(0,todayIdx).classList.contains('reorder-source') ? 'OK' : 'FAIL');
  tap(rowFor(1,0).querySelector('.prow-body')); // next week's Monday
  await wait(20);
  const week0AfterCrossWeek = titlesOfWeek(0);
  const week1AfterCrossWeek = titlesOfWeek(1);
  const combinedBefore = week0AfterSameWeek.concat(week1Before);
  const expectedCombined = expectedAfterMove(combinedBefore, todayIdx, 7); // flat idx of next week's Monday
  const combinedAfter = week0AfterCrossWeek.concat(week1AfterCrossWeek);
  console.log('Cross-week-block move (via two body taps starting on today) produced the expected shift:',
    JSON.stringify(combinedAfter)===JSON.stringify(expectedCombined) ? 'OK' : `FAIL (got ${JSON.stringify(combinedAfter)}, expected ${JSON.stringify(expectedCombined)})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
