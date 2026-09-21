const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function firePointer(el, type, opts){
  el.dispatchEvent(new window.PointerEvent(type, Object.assign({bubbles:true, cancelable:true, pointerId:1}, opts)));
}

// jsdom has no real layout; the app picks a drop target from getBoundingClientRect-derived
// geometry, so give every .plan-row a synthetic rect purely from its own data-day.
const ROW_H = 50;
function rowCenterY(dayIdx){ return dayIdx*ROW_H + ROW_H/2; }
window.Element.prototype.getBoundingClientRect = function(){
  const dayAttr = this.getAttribute && this.getAttribute('data-day');
  if(this.classList && this.classList.contains('plan-row') && dayAttr!==null){
    const top = parseInt(dayAttr,10)*ROW_H;
    return { top, bottom: top+ROW_H, left:0, right:300, width:300, height:ROW_H, x:0, y:top };
  }
  return { top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0 };
};

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Switch to a 6-day plan (Mon-Sat) so today (Fri, idx 4) and Sat/Sun have real, distinct content.
  goPill('onb-days');
  await wait(20);
  const sixChip = [...doc.querySelectorAll('#dayCountChips .chip')].find(c=>c.getAttribute('data-count')==='6');
  sixChip.click();
  await wait(10);

  goPill('week');
  await wait(20);
  const weekList = doc.getElementById('weekList');
  const row = i => weekList.querySelector(`.plan-row[data-day="${i}"][data-week-idx="0"]`);
  const title = i => row(i).querySelector('.prow-title').textContent;

  // Capture today's planned workout before dragging -- this is the value that should actually
  // travel with the drag.
  goPill('week');
  await wait(20);
  const rawBeforeToday = title(4);
  const beforeSat = title(5);
  const beforeSun = title(6);
  console.log('Before anything -> Today(Fri) real workout:', rawBeforeToday, '| Sat:', beforeSat, '| Sun:', beforeSun);

  const todayRow = row(4);
  const sunRow = row(6);
  console.log('Today row is draggable (not yet completed):', todayRow.getAttribute('data-draggable')==='1' ? 'OK' : 'FAIL');

  // --- Drag today's workout onto Sunday ---
  firePointer(todayRow, 'pointerdown', {clientX:100, clientY:rowCenterY(4)});
  await wait(380);
  firePointer(todayRow, 'pointermove', {clientX:100, clientY:rowCenterY(6)});
  await wait(10);
  console.log('Sunday highlighted as drop-target while dragging today:', sunRow.classList.contains('drop-target') ? 'OK' : 'FAIL');
  firePointer(todayRow, 'pointerup', {clientX:100, clientY:rowCenterY(6)});
  await wait(20);

  const afterToday = title(4);
  const afterSat = title(5);
  const afterSun = title(6);
  console.log('After drag -> Today(Fri) slot:', afterToday, '| Sat:', afterSat, '| Sun:', afterSun);
  console.log('Sunday now holds Friday\'s original workout:', afterSun===rawBeforeToday ? 'OK' : 'FAIL');
  console.log('Today\'s slot backfilled by the cascade with Saturday\'s old content:', afterToday===beforeSat ? 'OK' : 'FAIL');
  console.log('Saturday backfilled with Sunday\'s old content:', afterSat===beforeSun ? 'OK' : 'FAIL');

  // --- Once today is completed, it should lock (no longer draggable) ---
  goPill('home');
  await wait(20);
  const recordBtn = doc.getElementById('recordBtn');
  if(!recordBtn.classList.contains('disabled')){
    recordBtn.click();
    await wait(950); // "recording" pulse delay, then the Log Performance sheet opens
    doc.getElementById('saveLogPerf').click(); // accept the seeded defaults -> startWorkout() fires
    await wait(50);
  }
  goPill('week');
  await wait(20);
  const todayRowAfterComplete = row(4);
  console.log('Today row becomes non-draggable once completed:', todayRowAfterComplete.getAttribute('data-draggable')===null ? 'OK' : 'FAIL');
  console.log('Today row has no drag handle once completed:', !todayRowAfterComplete.querySelector('.drag-handle') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
