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
// loaded week block now). This test drags within week 1, so rowCenterY takes a within-week
// day index and adds the week-1 offset (7) itself.
const ROW_H = 50;
function rowCenterY(dayIdx){ return (7+dayIdx)*ROW_H + ROW_H/2; }
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

  function rowAt(w, i){
    return doc.getElementById('weekList').querySelector(`.plan-row[data-day="${i}"][data-week-idx="${w}"]`);
  }
  function titles(w){
    return [0,1,2,3,4,5,6].map(i => rowAt(w,i).querySelector('.prow-title').textContent);
  }

  const before = titles(1);
  const monRow = rowAt(1, 0);

  // --- Long-press Monday, hover over Wednesday: Tue+Wed should preview-shift up, Thu/Fri untouched ---
  firePointer(monRow, 'pointerdown', {clientX:100, clientY:rowCenterY(0)});
  await wait(380);
  firePointer(monRow, 'pointermove', {clientX:100, clientY:rowCenterY(2)});
  await wait(10);

  const tue = rowAt(1,1), wed = rowAt(1,2), thu = rowAt(1,3), fri = rowAt(1,4);
  console.log('Tue previewing shift (shifting class):', tue.classList.contains('shifting') ? 'OK' : 'FAIL');
  console.log('Tue transform is translateY(-100%):', tue.style.transform.includes('-100%') ? 'OK' : 'FAIL');
  console.log('Wed previewing shift (shifting class):', wed.classList.contains('shifting') ? 'OK' : 'FAIL');
  console.log('Wed transform is translateY(-100%):', wed.style.transform.includes('-100%') ? 'OK' : 'FAIL');
  console.log('Thu NOT part of preview:', !thu.classList.contains('shifting') ? 'OK' : 'FAIL');
  console.log('Fri NOT part of preview:', !fri.classList.contains('shifting') ? 'OK' : 'FAIL');
  console.log('Wed marked as drop-target too:', wed.classList.contains('drop-target') ? 'OK' : 'FAIL');
  console.log('No data mutation yet (still original titles):', JSON.stringify(titles(1))===JSON.stringify(before) ? 'OK' : 'FAIL');

  // --- Extend the hover further to Friday: preview range should grow to include Thu and Fri ---
  firePointer(monRow, 'pointermove', {clientX:100, clientY:rowCenterY(4)});
  await wait(10);
  console.log('Preview range extended -> Thu now shifting:', thu.classList.contains('shifting') ? 'OK' : 'FAIL');
  console.log('Preview range extended -> Fri now shifting:', fri.classList.contains('shifting') ? 'OK' : 'FAIL');
  console.log('Wed still shifting (still inside range):', wed.classList.contains('shifting') ? 'OK' : 'FAIL');
  console.log('Old target (Wed) drop-target class cleared once target moved on:', !wed.classList.contains('drop-target') ? 'OK' : 'FAIL');
  console.log('New target (Fri) has drop-target:', fri.classList.contains('drop-target') ? 'OK' : 'FAIL');

  // --- Move hover to "nothing" (simulate dragging off any valid row): preview should fully clear ---
  firePointer(monRow, 'pointermove', {clientX:100, clientY:9999});
  await wait(10);
  console.log('Preview fully cleared when hovering nothing -> Tue reset:', (!tue.classList.contains('shifting') && tue.style.transform==='') ? 'OK' : 'FAIL');
  console.log('Preview fully cleared -> Wed reset:', (!wed.classList.contains('shifting') && wed.style.transform==='') ? 'OK' : 'FAIL');
  console.log('Preview fully cleared -> Thu reset:', (!thu.classList.contains('shifting') && thu.style.transform==='') ? 'OK' : 'FAIL');
  console.log('Preview fully cleared -> Fri reset:', (!fri.classList.contains('shifting') && fri.style.transform==='') ? 'OK' : 'FAIL');

  // Drop over nothing -> cancelled, no data change.
  firePointer(monRow, 'pointerup', {clientX:100, clientY:9999});
  await wait(20);
  console.log('Cancelled drop -> no data mutation:', JSON.stringify(titles(1))===JSON.stringify(before) ? 'OK' : 'FAIL');
  console.log('Dragged row transform reset after cancel:', monRow.style.transform==='' ? 'OK' : 'FAIL');

  // --- Reverse direction: drag Friday up over Monday, preview should shift the range DOWN (+100%) ---
  const friRow2 = rowAt(1,4);
  firePointer(friRow2, 'pointerdown', {clientX:100, clientY:rowCenterY(4)});
  await wait(380);
  firePointer(friRow2, 'pointermove', {clientX:100, clientY:rowCenterY(0)});
  await wait(10);
  const mon2 = rowAt(1,0), tue2 = rowAt(1,1), wed2 = rowAt(1,2), thu2 = rowAt(1,3);
  console.log('Reverse drag: Mon shifting down (+100%):', mon2.style.transform.includes('100%') && !mon2.style.transform.includes('-100%') ? 'OK' : 'FAIL');
  console.log('Reverse drag: Tue shifting down (+100%):', tue2.style.transform.includes('100%') && !tue2.style.transform.includes('-100%') ? 'OK' : 'FAIL');
  console.log('Reverse drag: Wed shifting down (+100%):', wed2.style.transform.includes('100%') && !wed2.style.transform.includes('-100%') ? 'OK' : 'FAIL');
  console.log('Reverse drag: Thu shifting down (+100%):', thu2.style.transform.includes('100%') && !thu2.style.transform.includes('-100%') ? 'OK' : 'FAIL');

  // Now actually drop (commit) and verify the final data matches the earlier cascade test's expectation,
  // and all inline preview transforms are gone after the re-render (fresh DOM nodes never had them).
  firePointer(friRow2, 'pointerup', {clientX:100, clientY:rowCenterY(0)});
  await wait(20);
  const after = titles(1);
  console.log('Committed reverse drag -> Mon holds old Fri content:', after[0]===before[4] ? 'OK' : 'FAIL');
  console.log('Committed reverse drag -> Tue holds old Mon content:', after[1]===before[0] ? 'OK' : 'FAIL');
  const freshMon = rowAt(1,0);
  console.log('Fresh re-rendered row has no leftover inline transform:', freshMon.style.transform==='' ? 'OK' : 'FAIL');
  console.log('Fresh re-rendered row has no leftover shifting class:', !freshMon.classList.contains('shifting') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
