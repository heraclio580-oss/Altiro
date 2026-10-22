const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Reset to Suggested Plan on a day whose workout was dragged to another day brings it back -- it isn't
// copied. (A long run moved from Saturday to Sunday, then Saturday reset: two long runs, 32 mi instead
// of 22.5.) The reset is only offered on a day that's different from the plan.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
function firePointer(el, type, opts){ el.dispatchEvent(new window.PointerEvent(type, Object.assign({bubbles:true, cancelable:true, pointerId:1}, opts))); }
const ROW_H = 50;
const rowCenterY = i => i*ROW_H + ROW_H/2;
window.Element.prototype.getBoundingClientRect = function(){
  const flatAttr = this.getAttribute && this.getAttribute('data-flat-idx');
  if(this.classList && this.classList.contains('plan-row') && flatAttr!==null){
    const top = parseInt(flatAttr,10)*ROW_H;
    return { top, bottom: top+ROW_H, left:0, right:300, width:300, height:ROW_H, x:0, y:top };
  }
  return { top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0 };
};
async function dragDrop(src, dst){
  const s = parseInt(src.getAttribute('data-flat-idx'),10), d = parseInt(dst.getAttribute('data-flat-idx'),10);
  firePointer(src, 'pointerdown', {clientX:100, clientY:rowCenterY(s)}); await wait(380);
  firePointer(src, 'pointermove', {clientX:100, clientY:rowCenterY(d)}); await wait(10);
  firePointer(src, 'pointerup', {clientX:100, clientY:rowCenterY(d)}); await wait(30);
}

(async () => {
  await wait(50);
  const doc = window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'week').click();
  await wait(20);
  // Next week (every day of it can be moved): a workout day followed by a rest day.
  const row = i => doc.getElementById('weekList').querySelector(`.plan-row[data-day="${i}"][data-week-idx="1"]`);
  const title = i => row(i).querySelector('.prow-title').textContent;
  const titles = () => [0,1,2,3,4,5,6].map(title);
  const before = titles();
  const w = [0,1,2,3,4,5].find(i=> before[i]!=='Rest Day' && before[i+1]==='Rest Day');
  check('(set-up) next week has a workout day followed by a rest day', w!=null, JSON.stringify(before));
  const workout = before[w], count = () => titles().filter(t=> t===workout).length;
  // (A tap: pressed and let go without moving. A rest day opens its own view.)
  const openDay = async i => { const y = rowCenterY(parseInt(row(i).getAttribute('data-flat-idx'),10)); firePointer(row(i), 'pointerdown', {clientX:100, clientY:y}); await wait(20); firePointer(row(i), 'pointerup', {clientX:100, clientY:y}); await wait(30); };

  await dragDrop(row(w), row(w+1));
  check(`Moving "${workout}" to the next day`, title(w)==='Rest Day' && title(w+1)===workout, JSON.stringify(titles()));

  await openDay(w);
  const reset = doc.getElementById('ddResetPlanBtn');
  check('The day it left offers Reset to Suggested Plan', !!reset);
  reset.click(); await wait(30);
  doc.getElementById('closeDayDetail').click(); await wait(20);
  check('Resetting it brings the workout back', title(w)===workout, JSON.stringify(titles()));
  check('...and takes it off the day it was moved to (one of it, not two)', title(w+1)==='Rest Day' && count()===before.filter(t=> t===workout).length, JSON.stringify(titles()));
  check('...so the week is just as the plan had it', JSON.stringify(titles())===JSON.stringify(before), JSON.stringify(titles()));

  // Moved there and back: both days are the plan's own again -- nothing to reset.
  await dragDrop(row(w), row(w+1));
  await dragDrop(row(w+1), row(w));
  check('(set-up) moved there and back', JSON.stringify(titles())===JSON.stringify(before), JSON.stringify(titles()));
  await openDay(w+1);
  check('A day that matches the plan doesn\'t offer Reset to Suggested Plan', !doc.getElementById('ddResetPlanBtn'));
  doc.getElementById('closeDayDetail').click();

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
