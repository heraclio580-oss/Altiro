const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// 2026-09-17 is a Thursday -- a rest day under the default Mon/Wed/Fri split, with Wednesday
// (2026-09-16, "yesterday") a real training day that we'll deliberately leave un-completed so it
// shows as genuinely "missed", not just buildWeek()'s auto-blanked history.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-17'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function firePointer(el, type, opts){
  el.dispatchEvent(new window.PointerEvent(type, Object.assign({bubbles:true, cancelable:true, pointerId:1}, opts)));
}
// jsdom has no real layout; the app picks a drop target from getBoundingClientRect-derived geometry,
// so give every .plan-row a synthetic rect from its flat index (see test_reorder_cascade.js).
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

// Reported: today's rest slot needed to swap with YESTERDAY's missed workout -- slide the rest day
// up, slide the missed workout down into today -- but every past day was unconditionally locked
// (data-draggable never set once dd.isPast), regardless of whether anything on it was ever actually
// completed. Fix: a day is only locked once it's genuinely completed; a missed (past, not-done) day
// is just as free to move as any future one.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // --- Plan a real (not-done) workout for yesterday (Wednesday) so it reads as genuinely missed ---
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="2"]').click(); // Wed = index 2
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Missed Leg Day';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
  // Create Workout already defaults "Mark as Completed" off -- leave it off so Wednesday stays missed.
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  goPill('week');
  await wait(20);
  const weekList = doc.getElementById('weekList');
  const rowFor = i => weekList.querySelector(`.plan-row[data-day="${i}"][data-week-idx="0"]`);
  const todayRow = () => [...weekList.querySelectorAll('.plan-row[data-week-idx="0"]')].find(r=>r.classList.contains('today'));

  console.log('Today (Thursday) starts as Rest Day:', todayRow().querySelector('.prow-title').textContent==='Rest Day' ? 'OK' : 'FAIL');
  console.log('Wednesday shows the real missed workout, not blanked to Rest Day:', rowFor(2).querySelector('.prow-title').textContent==='Missed Leg Day' ? 'OK' : `FAIL (${rowFor(2).querySelector('.prow-title').textContent})`);
  console.log('Wednesday is marked missed:', rowFor(2).className.includes('missed') ? 'OK' : `FAIL (${rowFor(2).className})`);

  console.log('A missed (past, not completed) day IS draggable -- no longer locked just for being in the past:',
    rowFor(2).getAttribute('data-draggable')==='1' ? 'OK' : 'FAIL');
  console.log('It has a grip handle too:', !!rowFor(2).querySelector('.drag-handle') ? 'OK' : 'FAIL');

  // --- Press-and-hold-drag today's row up onto Wednesday to swap them ---
  const todayFlat = parseInt(todayRow().getAttribute('data-flat-idx'),10); // 3
  const wedFlat = parseInt(rowFor(2).getAttribute('data-flat-idx'),10); // 2
  firePointer(todayRow(), 'pointerdown', {clientX:100, clientY:rowCenterY(todayFlat)});
  await wait(380);
  firePointer(todayRow(), 'pointermove', {clientX:100, clientY:rowCenterY(wedFlat)});
  await wait(10);
  console.log('Wednesday (missed, now unlocked) is highlighted as a drop target while dragging today:', rowFor(2).classList.contains('drop-target') ? 'OK' : 'FAIL');
  firePointer(todayRow(), 'pointerup', {clientX:100, clientY:rowCenterY(wedFlat)});
  await wait(20);

  console.log('Today now holds the missed workout, moved forward into today\'s slot:',
    todayRow().querySelector('.prow-title').textContent==='Missed Leg Day' ? 'OK' : `FAIL (${todayRow().querySelector('.prow-title').textContent})`);
  console.log('Wednesday now holds Rest Day (today\'s original content, slid back):',
    rowFor(2).querySelector('.prow-title').textContent==='Rest Day' ? 'OK' : `FAIL (${rowFor(2).querySelector('.prow-title').textContent})`);
  console.log('Today is NOT auto-marked done just from the move (still pending):',
    !todayRow().className.includes('done') ? 'OK' : `FAIL (${todayRow().className})`);
  console.log('Today is still draggable after the move (not completed):', todayRow().getAttribute('data-draggable')==='1' ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
