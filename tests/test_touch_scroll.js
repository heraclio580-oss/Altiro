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
// browser), so give every .plan-row a synthetic rect purely from its FLAT index (spans every
// loaded week block now). Everything in this file stays within week 0, where flat index and
// data-day are numerically identical, so rowCenterY(dayIdx) still works unchanged.
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
  goPill('week');
  await wait(20);

  const weekList = doc.getElementById('weekList');
  const satRow = weekList.querySelector('.plan-row[data-day="5"][data-week-idx="0"]');
  const screenEl = doc.getElementById('screen-week');

  // A quick touch swipe (below the long-press threshold, well before it fires) on a draggable
  // row should forward scroll manually, since the row's touch-action:none blocks native scroll.
  Object.defineProperty(screenEl, 'scrollTop', {value: 100, writable:true, configurable:true});
  firePointer(satRow, 'pointerdown', {clientX:100, clientY:200, pointerType:'touch'});
  firePointer(satRow, 'pointermove', {clientX:100, clientY:170, pointerType:'touch'}); // moved up 30px, fast -> should cancel long-press and scroll
  await wait(10);
  console.log('Quick touch swipe on draggable row manually scrolled the screen (scrollTop changed):', screenEl.scrollTop !== 100 ? `OK (now ${screenEl.scrollTop})` : 'FAIL');
  firePointer(satRow, 'pointerup', {clientX:100, clientY:170, pointerType:'touch'});
  await wait(10);
  console.log('No accidental Day Detail open after a cancelled swipe:', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');

  // Same fast swipe with a MOUSE pointer should NOT trigger manual scroll (avoids surprising desktop behavior).
  Object.defineProperty(screenEl, 'scrollTop', {value: 200, writable:true, configurable:true});
  firePointer(satRow, 'pointerdown', {clientX:100, clientY:200, pointerType:'mouse'});
  firePointer(satRow, 'pointermove', {clientX:100, clientY:170, pointerType:'mouse'});
  await wait(10);
  console.log('Mouse swipe on draggable row does NOT trigger manual scroll:', screenEl.scrollTop===200 ? 'OK' : 'FAIL');
  firePointer(satRow, 'pointerup', {clientX:100, clientY:170, pointerType:'mouse'});
  await wait(10);

  // A genuine long-press-then-drag (touch) should still work end to end and NOT get diverted into scroll-forwarding.
  Object.defineProperty(screenEl, 'scrollTop', {value: 300, writable:true, configurable:true});
  const sunRow = weekList.querySelector('.plan-row[data-day="6"][data-week-idx="0"]');
  const satBefore = satRow.querySelector('.prow-title').textContent;
  const sunBefore = sunRow.querySelector('.prow-title')?.textContent || '(rest)';
  firePointer(satRow, 'pointerdown', {clientX:100, clientY:rowCenterY(5), pointerType:'touch'});
  await wait(380); // exceed the new 320ms threshold, staying still
  console.log('Long-press engaged dragging (touch):', satRow.classList.contains('dragging') ? 'OK' : 'FAIL');
  firePointer(satRow, 'pointermove', {clientX:100, clientY:rowCenterY(6), pointerType:'touch'});
  await wait(10);
  firePointer(satRow, 'pointerup', {clientX:100, clientY:rowCenterY(6), pointerType:'touch'});
  await wait(20);
  const wl = doc.getElementById('weekList');
  const satAfter = wl.querySelector('.plan-row[data-day="5"][data-week-idx="0"] .prow-title').textContent;
  const sunAfter = wl.querySelector('.plan-row[data-day="6"][data-week-idx="0"] .prow-title')?.textContent || '(rest)';
  console.log('Real long-press-drag still swaps correctly on touch:', (satAfter===sunBefore && sunAfter===satBefore) ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
