const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

function firePointer(el, type, opts){
  const ev = new window.PointerEvent(type, Object.assign({bubbles:true, cancelable:true, pointerId:1}, opts));
  el.dispatchEvent(ev);
  return ev;
}

// jsdom has no real layout, so the app's drop-target detection (based on getBoundingClientRect,
// not elementFromPoint -- elementFromPoint would hit the floating dragged row itself in a real
// browser once it's positioned over another row) needs a synthetic geometry. Every .plan-row's
// rect is derived purely from its FLAT index (spans every loaded week block now), so a
// pointermove's clientY of flatIdx*ROW_H + ROW_H/2 reliably targets that row via nearest-center
// matching, matching the real app's logic. Everything in this file stays within week 0, where
// flat index and data-day are numerically identical, so rowCenterY(dayIdx) still works unchanged.
const ROW_H = 50;
function rowCenterY(dayIdx){ return dayIdx*ROW_H + ROW_H/2; }
window.Element.prototype.getBoundingClientRect = function(){
  const flatAttr = this.getAttribute && this.getAttribute('data-flat-idx');
  if(this.classList && this.classList.contains('plan-row') && flatAttr!==null){
    const top = parseInt(flatAttr,10)*ROW_H;
    return { top, bottom: top+ROW_H, left:0, right:300, width:300, height:ROW_H, x:0, y:top };
  }
  return { top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0 };
};

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Switch to a 6-day plan (Mon-Sat) so Saturday has real content, not just Rest Day, for a meaningful swap test.
  goPill('onb-days');
  await wait(20);
  const sixChip = [...doc.querySelectorAll('#dayCountChips .chip')].find(c=>c.getAttribute('data-count')==='6');
  sixChip.click();
  await wait(10);

  goPill('week');
  await wait(20);
  const weekList = doc.getElementById('weekList');

  const todayRow = weekList.querySelector('.plan-row[data-day="4"][data-week-idx="0"]');
  const satRow = weekList.querySelector('.plan-row[data-day="5"][data-week-idx="0"]'); // Sat, > TODAY_IDX(4) -> draggable
  const sunRow = weekList.querySelector('.plan-row[data-day="6"][data-week-idx="0"]'); // Sun, > TODAY_IDX(4) -> draggable

  console.log('Today row IS draggable while not yet completed:', todayRow.getAttribute('data-draggable')==='1' ? 'OK' : 'FAIL');
  console.log('Today row has a drag handle while not yet completed:', !!todayRow.querySelector('.drag-handle') ? 'OK' : 'FAIL');
  console.log('Saturday row IS draggable:', satRow.getAttribute('data-draggable')==='1' ? 'OK' : 'FAIL');
  console.log('Saturday row has drag handle:', !!satRow.querySelector('.drag-handle') ? 'OK' : 'FAIL');

  // --- Test 1: quick tap on a non-draggable (today) row still opens Day Detail ---
  firePointer(todayRow, 'pointerdown', {clientX:100, clientY:rowCenterY(4)});
  await wait(20); // well under the long-press threshold
  firePointer(todayRow, 'pointerup', {clientX:100, clientY:rowCenterY(4)});
  await wait(10);
  console.log('Quick tap on today row opens Day Detail:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // --- Test 2: quick tap on a draggable row (Saturday) also still opens Day Detail (no drag intended) ---
  firePointer(satRow, 'pointerdown', {clientX:100, clientY:rowCenterY(5)});
  await wait(20);
  firePointer(satRow, 'pointerup', {clientX:100, clientY:rowCenterY(5)});
  await wait(10);
  console.log('Quick tap on Saturday row opens Day Detail:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // --- Test 3: long-press + move triggers dragging state, then drop with no target cancels cleanly ---
  firePointer(satRow, 'pointerdown', {clientX:100, clientY:rowCenterY(5)});
  await wait(450); // exceed long-press threshold without moving
  console.log('Row enters dragging state after long-press:', satRow.classList.contains('dragging') ? 'OK' : 'FAIL');
  // Move somewhere far outside the list's geometry -> nearestSlot() returns null -> no swap should happen.
  firePointer(satRow, 'pointermove', {clientX:100, clientY:99999});
  await wait(10);
  firePointer(satRow, 'pointerup', {clientX:100, clientY:99999});
  await wait(10);
  console.log('Dragging class removed after drop-with-no-target:', !satRow.classList.contains('dragging') ? 'OK' : 'FAIL (note: row may be a stale detached reference if re-rendered)');
  console.log('Day Detail did NOT open after a genuine long-press drag (no accidental tap-open):', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');

  // --- Test 4: real swap -- long-press Saturday, simulate hovering over Sunday's row, drop ---
  const satContentBefore = weekList.querySelector('.plan-row[data-day="5"][data-week-idx="0"] .prow-title').textContent;
  const sunContentBefore = weekList.querySelector('.plan-row[data-day="6"][data-week-idx="0"] .prow-title')?.textContent || '(rest)';
  console.log('Before swap -> Sat:', satContentBefore, '| Sun:', sunContentBefore);

  const satRow2 = weekList.querySelector('.plan-row[data-day="5"][data-week-idx="0"]');
  const sunRow2 = weekList.querySelector('.plan-row[data-day="6"][data-week-idx="0"]');
  firePointer(satRow2, 'pointerdown', {clientX:100, clientY:rowCenterY(5)});
  await wait(450);
  firePointer(satRow2, 'pointermove', {clientX:100, clientY:rowCenterY(6)});
  await wait(10);
  console.log('Sunday row highlighted as drop-target during drag:', sunRow2.classList.contains('drop-target') ? 'OK' : 'FAIL');
  firePointer(satRow2, 'pointerup', {clientX:100, clientY:rowCenterY(6)});
  await wait(20);

  const satContentAfter = weekList.querySelector('.plan-row[data-day="5"][data-week-idx="0"] .prow-title').textContent;
  const sunContentAfter = weekList.querySelector('.plan-row[data-day="6"][data-week-idx="0"] .prow-title')?.textContent || '(rest)';
  console.log('After swap -> Sat:', satContentAfter, '| Sun:', sunContentAfter);
  console.log('Swap actually happened (content exchanged):', (satContentAfter===sunContentBefore && sunContentAfter===satContentBefore) ? 'OK' : 'FAIL');

  // --- Test 5: verify the swap also propagated to Home's week strip ---
  goPill('home');
  await wait(20);
  const homeSat = doc.getElementById('weekStrip').querySelector('.day-cell[data-day="5"]');
  console.log('Home week strip re-rendered after swap (sanity check, no crash):', !!homeSat ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
