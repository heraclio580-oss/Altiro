const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
// 2026-09-17 is a Thursday -- a rest day under the default Mon/Wed/Fri plan, with Friday
// (a real training day) as "tomorrow" -- matches the reported use case exactly.
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-17'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function tapRow(row){
  row.dispatchEvent(new window.PointerEvent('pointerdown', {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:100}));
  row.dispatchEvent(new window.PointerEvent('pointerup', {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:100}));
}

// Reported issue: dragging a future day's workout onto today's slot on the Plan page wasn't
// reliably swapping today's old content into the vacated slot (long-press-drag gesture recognition
// is inherently fragile on a real touchscreen -- unreproducible here, jsdom has no real layout/
// touch input). Adds an explicit, gesture-free alternative: a "Move to Today" button in Day Detail
// for any future day, reusing the exact same reorderWithinWeek() swap the drag interaction commits
// with, so the result is guaranteed identical without depending on drag timing at all.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('week');
  await wait(20);
  const weekList = doc.getElementById('weekList');
  const title = i => weekList.querySelector(`.plan-row[data-day="${i}"][data-week-idx="0"] .prow-title`).textContent;
  const todayIdx = [...weekList.querySelectorAll('.plan-row[data-week-idx="0"]')].findIndex(r=>r.classList.contains('today'));
  console.log('Today starts as Rest Day, tomorrow has a real workout:', title(todayIdx)==='Rest Day' && title(todayIdx+1)!=='Rest Day' ? 'OK' : `FAIL (today=${title(todayIdx)}, tomorrow=${title(todayIdx+1)})`);
  const tomorrowTitleBefore = title(todayIdx+1);

  const tomorrowRow = weekList.querySelector(`.plan-row[data-day="${todayIdx+1}"][data-week-idx="0"]`);
  tapRow(tomorrowRow);
  await wait(20);
  console.log('Tapping tomorrow\'s row opens Day Detail:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');

  const btn = doc.getElementById('ddMoveToTodayBtn');
  console.log('"Move to Today" button is offered for a future day:', !!btn ? 'OK' : 'FAIL');
  btn.click();
  await wait(20);

  console.log('Day Detail closes after the move:', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('Today now holds tomorrow\'s workout:', title(todayIdx)===tomorrowTitleBefore ? 'OK' : `FAIL (${title(todayIdx)})`);
  console.log('Tomorrow now holds Rest Day (today\'s old content, correctly shifted down):', title(todayIdx+1)==='Rest Day' ? 'OK' : `FAIL (${title(todayIdx+1)})`);

  goPill('home');
  await wait(20);
  console.log('Home\'s session card reflects the swap:', doc.getElementById('sessionCard').querySelector('.title').textContent.includes(tomorrowTitleBefore) ? 'OK' : 'FAIL');

  // Once today is already done, the button should stop being offered -- moving a workout onto an
  // already-completed today would silently bury real completion history.
  goPill('week');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = 0;
  goPill('home');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  goPill('week');
  await wait(20);
  const laterRow = weekList.querySelector(`.plan-row[data-day="${Math.min(todayIdx+2,6)}"][data-week-idx="0"]`);
  tapRow(laterRow);
  await wait(20);
  console.log('"Move to Today" is NOT offered once today is already completed:', !doc.getElementById('ddMoveToTodayBtn') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
