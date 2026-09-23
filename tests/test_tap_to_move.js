const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
// 2026-09-17 is a Thursday -- a rest day under the default Mon/Wed/Fri plan, with Friday
// (a real training day) as "tomorrow".
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-17'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function tap(el){
  el.dispatchEvent(new window.PointerEvent('pointerdown', {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:100}));
  el.dispatchEvent(new window.PointerEvent('pointerup', {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:100}));
}

// Reported: press-and-hold-then-drag reordering on the Plan page wasn't reliably completing on a
// real phone, even after loosening the long-press timing twice. Since that can't be reproduced or
// debugged from here (jsdom has no real touch input), adds a second, gesture-free way to do the
// same thing: tap a row's grip handle to "pick it up," then tap any other day in the same week to
// swap it there -- two plain taps, no hold duration or drag distance involved at all. Reuses the
// exact same reorderWithinWeek() the drag commits with, so results are identical either way.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('week');
  await wait(20);
  const weekList = doc.getElementById('weekList');
  const rowFor = i => weekList.querySelector(`.plan-row[data-day="${i}"][data-week-idx="0"]`);
  const title = i => rowFor(i).querySelector('.prow-title').textContent;
  const todayIdx = [...weekList.querySelectorAll('.plan-row[data-week-idx="0"]')].findIndex(r=>r.classList.contains('today'));
  console.log('Today starts as Rest Day, tomorrow has a real workout:', title(todayIdx)==='Rest Day' && title(todayIdx+1)!=='Rest Day' ? 'OK' : `FAIL (today=${title(todayIdx)}, tomorrow=${title(todayIdx+1)})`);
  const tomorrowTitleBefore = title(todayIdx+1);

  // --- Tap tomorrow's grip handle to pick it up ---
  const tomorrowHandle = rowFor(todayIdx+1).querySelector('.drag-handle');
  console.log('Tomorrow has a grip handle:', !!tomorrowHandle ? 'OK' : 'FAIL');
  tap(tomorrowHandle);
  await wait(10);
  console.log('Tomorrow\'s row is marked as the picked-up reorder source:', rowFor(todayIdx+1).classList.contains('reorder-source') ? 'OK' : 'FAIL');
  console.log('Today\'s row is marked as an eligible reorder target:', rowFor(todayIdx).classList.contains('reorder-target') ? 'OK' : 'FAIL');
  console.log('Day Detail did NOT open from tapping the grip:', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');

  // --- Tap today's row body to complete the move ---
  tap(rowFor(todayIdx));
  await wait(20);
  console.log('Today now holds tomorrow\'s original workout:', title(todayIdx)===tomorrowTitleBefore ? 'OK' : `FAIL (${title(todayIdx)})`);
  console.log('Tomorrow now holds Rest Day (today\'s old content):', title(todayIdx+1)==='Rest Day' ? 'OK' : `FAIL (${title(todayIdx+1)})`);
  console.log('Day Detail did NOT open from the completing tap either:', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('No row is left marked as a pending reorder source:', !weekList.querySelector('.reorder-source') ? 'OK' : 'FAIL');

  goPill('home');
  await wait(20);
  console.log('Home reflects the swap too:', doc.getElementById('sessionCard').querySelector('.title').textContent.includes(tomorrowTitleBefore) ? 'OK' : 'FAIL');

  // --- Tapping the SAME row's handle twice cancels the pending move ---
  goPill('week');
  await wait(20);
  const laterIdx = Math.min(todayIdx+3, 6);
  const laterTitleBefore = title(laterIdx);
  const laterHandle = rowFor(laterIdx).querySelector('.drag-handle');
  tap(laterHandle);
  await wait(10);
  console.log('Picked up a later day:', rowFor(laterIdx).classList.contains('reorder-source') ? 'OK' : 'FAIL');
  tap(laterHandle); // tap the same handle again
  await wait(10);
  console.log('Tapping the same handle again cancels the pending move:', !weekList.querySelector('.reorder-source') ? 'OK' : 'FAIL');
  console.log('Nothing actually moved:', title(laterIdx)===laterTitleBefore ? 'OK' : `FAIL (${title(laterIdx)})`);

  // --- Once today is completed, its handle disappears and can't be picked up ---
  goPill('home');
  await wait(20);
  const recordBtn = doc.getElementById('recordBtn');
  if(!recordBtn.classList.contains('disabled')){
    recordBtn.click();
    await wait(950);
    doc.getElementById('saveLogPerf').click();
    await wait(50);
  }
  goPill('week');
  await wait(20);
  console.log('Today has no grip handle once completed:', !rowFor(todayIdx).querySelector('.drag-handle') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
