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
// geometry (not elementFromPoint, which would hit the floating dragged row itself in a real
// browser), so give every .plan-row a synthetic rect purely from its own data-day.
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

async function dragDrop(doc, srcRow, dstRow){
  const srcIdx = parseInt(srcRow.getAttribute('data-day'),10);
  const dstIdx = parseInt(dstRow.getAttribute('data-day'),10);
  firePointer(srcRow, 'pointerdown', {clientX:100, clientY:rowCenterY(srcIdx)});
  await wait(380);
  firePointer(srcRow, 'pointermove', {clientX:100, clientY:rowCenterY(dstIdx)});
  await wait(10);
  firePointer(srcRow, 'pointerup', {clientX:100, clientY:rowCenterY(dstIdx)});
  await wait(20);
}

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  goPill('week');
  await wait(20);

  // Default trainingDays is [0,2,4] (Mon/Wed/Fri) -- exactly the user's example.
  // Use week 1 ("Next Week") since every day there is draggable (week 0 only has Sat/Sun draggable, TODAY_IDX=4=Fri).
  function rowsOfWeek(w){
    return [0,1,2,3,4,5,6].map(i => doc.getElementById('weekList').querySelector(`.plan-row[data-day="${i}"][data-week-idx="${w}"]`));
  }
  function titles(w){
    return rowsOfWeek(w).map(r => r.querySelector('.prow-title').textContent);
  }

  console.log('Week 1 before any drag:', titles(1));
  const before = titles(1);
  console.log('Sanity: Mon/Wed/Fri have workouts, Tue/Thu/Sun rest (Sat too since 3-day split):', JSON.stringify(before));

  let rows = rowsOfWeek(1);
  await dragDrop(doc, rows[0], rows[2]); // drag Monday(0) onto Wednesday(2)

  const after = titles(1);
  console.log('Week 1 after dragging Mon -> Wed:', after);
  console.log('Mon now holds old Tue content (expect Rest Day):', after[0]===before[1] ? 'OK' : 'FAIL');
  console.log('Tue now holds old Wed content (expect a workout):', after[1]===before[2] ? 'OK' : 'FAIL');
  console.log('Wed now holds Monday\'s original dragged content:', after[2]===before[0] ? 'OK' : 'FAIL');
  console.log('Thu unaffected:', after[3]===before[3] ? 'OK' : 'FAIL');
  console.log('Fri unaffected:', after[4]===before[4] ? 'OK' : 'FAIL');
  console.log('Sat unaffected:', after[5]===before[5] ? 'OK' : 'FAIL');
  console.log('Sun unaffected:', after[6]===before[6] ? 'OK' : 'FAIL');

  // --- Reverse direction: drag a later day UP over an earlier one, verify the cascade goes the other way ---
  const before2 = titles(1); // state after the first drag
  rows = rowsOfWeek(1);
  await dragDrop(doc, rows[4], rows[0]); // drag Friday(4) up onto Monday(0)
  const after2 = titles(1);
  console.log('Reverse drag before:', before2);
  console.log('Reverse drag after (Fri -> Mon):', after2);
  console.log('Mon now holds Friday\'s original dragged content:', after2[0]===before2[4] ? 'OK' : 'FAIL');
  console.log('Tue now holds old Mon content:', after2[1]===before2[0] ? 'OK' : 'FAIL');
  console.log('Wed now holds old Tue content:', after2[2]===before2[1] ? 'OK' : 'FAIL');
  console.log('Thu now holds old Wed content:', after2[3]===before2[2] ? 'OK' : 'FAIL');
  console.log('Fri now holds old Thu content:', after2[4]===before2[3] ? 'OK' : 'FAIL');
  console.log('Sat/Sun unaffected (outside the drag range):', (after2[5]===before2[5] && after2[6]===before2[6]) ? 'OK' : 'FAIL');

  // --- Cross-week isolation still holds for the cascade ---
  const week0Before = titles(0);
  const week2Before = titles(2);
  rows = rowsOfWeek(1);
  await dragDrop(doc, rows[1], rows[3]); // another cascade within week 1
  console.log('Week 0 unaffected by week-1 cascade:', JSON.stringify(titles(0))===JSON.stringify(week0Before) ? 'OK' : 'FAIL');
  console.log('Week 2 unaffected by week-1 cascade:', JSON.stringify(titles(2))===JSON.stringify(week2Before) ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
