const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-19'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function firePointer(el, type, opts){
  el.dispatchEvent(new window.PointerEvent(type, Object.assign({bubbles:true, cancelable:true, pointerId:1}, opts)));
}

// Root-cause regression test for a reported bug: a rest day (including today, when today happens to
// be a rest day) used to be generated with completed:true baked in, purely so status displays could
// short-circuit -- but nothing actually completed it. That flag leaked two ways: (1) Day Detail's
// "Completed" toggle showed ON for a day nothing was ever done on, and (2) far worse, dragging a rest
// day's raw slot into another date (getRawDaySlot -> writeDaySlot, used by every Plan cascade) baked
// that same "completed:true" in as an explicit completedOverride on the destination date. Once that
// date's local week rolled forward and it became "today", isTodayDone() trusted the stale override
// and reported it already done -- which makes a day non-draggable (both as a source and, critically,
// as a drop TARGET, since captureSlotGeometry() only considers draggable rows), exactly matching
// "no other days can be moved to replace [today's rest day]". Fix: rest/empty slots never carry
// completed:true at all -- only a real workout does.
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

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // 2026-09-19 is a Saturday -- a rest day under the default Mon/Wed/Fri split, and "today".
  goPill('week');
  await wait(20);
  const weekList = doc.getElementById('weekList');
  const todayRow = weekList.querySelector('.plan-row.today');
  console.log('Today is a rest day:', todayRow.querySelector('.prow-title').textContent==='Rest Day' ? 'OK' : 'FAIL');
  console.log('A never-touched rest-day today is still draggable (not falsely marked completed):',
    todayRow.getAttribute('data-draggable')==='1' ? 'OK' : `FAIL (${todayRow.outerHTML.slice(0,120)})`);
  console.log('...and it has a grip handle, confirming it is a real drop target too:',
    !!todayRow.querySelector('.drag-handle') ? 'OK' : 'FAIL');

  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  console.log('Day Detail\'s Completed toggle is OFF for a never-touched rest-day today:',
    !doc.getElementById('dayCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // --- Drag a future rest day into another future slot -- its "completed" flag must NOT persist as
  // an explicit completedOverride on the destination date (the actual leak that corrupted a later day) ---
  goPill('week');
  await wait(20);
  const rowAt = (w,i) => doc.getElementById('weekList').querySelector(`.plan-row[data-day="${i}"][data-week-idx="${w}"]`);
  // Week 1 (next week), default Mon/Wed/Fri: Tuesday (i=1) is a rest day, Thursday (i=3) also rest.
  console.log('Week 1 Tuesday starts as Rest Day:', rowAt(1,1).querySelector('.prow-title').textContent==='Rest Day' ? 'OK' : 'FAIL');
  const srcFlat = parseInt(rowAt(1,1).getAttribute('data-flat-idx'),10);
  const dstFlat = parseInt(rowAt(1,0).getAttribute('data-flat-idx'),10); // Monday, a real training day
  firePointer(rowAt(1,1), 'pointerdown', {clientX:100, clientY:rowCenterY(srcFlat)});
  await wait(380);
  firePointer(rowAt(1,1), 'pointermove', {clientX:100, clientY:rowCenterY(dstFlat)});
  await wait(10);
  firePointer(rowAt(1,1), 'pointerup', {clientX:100, clientY:rowCenterY(dstFlat)});
  await wait(20);
  const mondayAfter = doc.getElementById('weekList').querySelector('.plan-row[data-day="0"][data-week-idx="1"]');
  console.log('After dragging Tuesday onto Monday, Monday now holds the Rest Day content:',
    mondayAfter.querySelector('.prow-title').textContent==='Rest Day' ? 'OK' : `FAIL (${mondayAfter.querySelector('.prow-title').textContent})`);
  console.log('That destination day is STILL draggable (no stale completed flag blocking it as a future drag source/target):',
    mondayAfter.getAttribute('data-draggable')==='1' ? 'OK' : 'FAIL');

  // Open Day Detail for that exact date (week 1's Monday = 2026-09-21) and confirm Completed reads
  // OFF, not baked-in ON from the dragged-in rest day's old default.
  goPill('calendar');
  await wait(20);
  const targetCell = doc.querySelector('.mo-cell[data-date="2026-09-21"]');
  targetCell.click();
  await wait(10);
  console.log('Day Detail for the dragged-onto date shows Rest Day:', doc.getElementById('dayDetailPlanRow').textContent.includes('Rest Day') ? 'OK' : 'FAIL');
  console.log('Its Completed toggle is OFF, not falsely inherited as done from the drag:',
    !doc.getElementById('dayCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
