const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The calendar moves between months by swiping left/right as well as with the arrows -- a short or
// mostly-vertical drag doesn't, and a swipe never opens the day it started on.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  await wait(50);
  const doc = window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'calendar').click();
  await wait(20);
  const month = () => doc.getElementById('calRange').textContent;
  const pane = doc.getElementById('calendarViewPane');
  function touch(type, x, y, target){
    const e = new window.Event(type, {bubbles:true, cancelable:true});
    Object.defineProperty(e, 'touches', {value: type==='touchend' ? [] : [{clientX:x, clientY:y}]});
    (target || pane).dispatchEvent(e);
  }
  async function swipe(fromX, toX, fromY=300, toY=300, target){
    touch('touchstart', fromX, fromY, target);
    for(let i=1; i<=5; i++) touch('touchmove', fromX + (toX-fromX)*i/5, fromY + (toY-fromY)*i/5, target);
    touch('touchend', toX, toY, target);
    await wait(450);
  }

  console.log('Starts on this month:', month()==='September 2026' ? 'OK' : `FAIL (${month()})`);
  await swipe(300, 120);
  console.log('Swipe left: next month:', month()==='October 2026' ? 'OK' : `FAIL (${month()})`);
  await swipe(100, 320);
  await swipe(100, 320);
  console.log('Swipe right (twice): back two months:', month()==='August 2026' ? 'OK' : `FAIL (${month()})`);
  await swipe(300, 270);
  console.log('A short drag doesn\'t change the month:', month()==='August 2026' ? 'OK' : `FAIL (${month()})`);
  await swipe(300, 230, 200, 500);
  console.log('A mostly up/down drag doesn\'t either (that\'s scrolling):', month()==='August 2026' ? 'OK' : `FAIL (${month()})`);
  console.log('The grid settles back in place:', doc.getElementById('calGrid').style.transform==='' ? 'OK' : `FAIL (${doc.getElementById('calGrid').style.transform})`);

  // A swipe that starts on a day doesn't open that day.
  const startCell = doc.querySelector('.mo-cell[data-date="2026-08-12"]');
  touch('touchstart', 300, 300, startCell);
  for(let i=1; i<=5; i++) touch('touchmove', 300 - 36*i, 300, startCell);
  touch('touchend', 120, 300, startCell);
  startCell.click(); // the tap a phone sends right after the finger lifts
  await wait(450);
  console.log('A swipe starting on a day doesn\'t open it:', month()==='September 2026' && doc.getElementById('dayDetailOverlay').hidden ? 'OK' : `FAIL (${month()}, ${doc.getElementById('dayDetailOverlay').hidden})`);
  await wait(450);
  doc.querySelector('.mo-cell[data-date="2026-09-12"]').click();
  await wait(20);
  console.log('...while a plain tap still does:', !doc.getElementById('dayDetailOverlay').hidden ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();

  console.log('The arrows still work too:', (doc.getElementById('calNext').click(), month()==='October 2026') ? 'OK' : `FAIL (${month()})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
