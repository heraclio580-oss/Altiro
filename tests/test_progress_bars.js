const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const goProgress = () => { goPill('calendar'); return wait(20); };

  await goProgress();
  const progBtn = doc.querySelector('#calProgToggle .tab-btn[data-view="progress"]');
  progBtn.click();
  await wait(20);

  // --- Initial render: 4 bars, "Now" selected by default, current bar bolded ---
  let bars = [...doc.querySelectorAll('#progBarChart .bar-col')];
  console.log('4 bars shown initially:', bars.length===4 ? 'OK' : `FAIL (${bars.length})`);
  const nowBar = bars.find(b=>b.getAttribute('data-offset')==='0');
  console.log('"Now" bar exists and is current+selected by default:', nowBar && nowBar.classList.contains('current') && nowBar.classList.contains('selected') ? 'OK' : 'FAIL');
  console.log('Detail card shows "This Week" range by default:', doc.getElementById('progWeekDetail').textContent.includes('This Week') ? 'OK' : 'FAIL');
  console.log('Prev button enabled, Next button disabled at the front:', !doc.getElementById('progWeeksPrev').disabled && doc.getElementById('progWeeksNext').disabled ? 'OK' : 'FAIL');

  // --- Click a past week's bar -> selection moves, detail updates, "Now" stops being highlighted ---
  bars.find(b=>b.getAttribute('data-offset')==='-2').click();
  await wait(10);
  // Re-query: renderProgress() rebuilds #progBarChart's innerHTML on every click, so the old
  // element references are now detached from the live DOM and must not be reused.
  const barsAfterClick = [...doc.querySelectorAll('#progBarChart .bar-col')];
  const pastBarFresh = barsAfterClick.find(b=>b.getAttribute('data-offset')==='-2');
  const nowBarFresh = barsAfterClick.find(b=>b.getAttribute('data-offset')==='0');
  console.log('Clicked past bar becomes selected:', pastBarFresh.classList.contains('selected') ? 'OK' : 'FAIL');
  console.log('"Now" bar no longer selected (but still marked current):', (!nowBarFresh.classList.contains('selected') && nowBarFresh.classList.contains('current')) ? 'OK' : 'FAIL');
  const detailAfterClick = doc.getElementById('progWeekDetail').textContent;
  console.log('Detail card updated away from "This Week":', !detailAfterClick.includes('This Week') ? 'OK' : 'FAIL');
  console.log('Detail card shows Workouts/Distance stat labels:', detailAfterClick.includes('Workouts') && detailAfterClick.includes('Distance') ? 'OK' : 'FAIL');

  // --- Paging back reveals older weeks; the newly-shown window's rightmost bar becomes selected ---
  const prevBtn = doc.getElementById('progWeeksPrev');
  prevBtn.click();
  await wait(10);
  bars = [...doc.querySelectorAll('#progBarChart .bar-col')];
  const offsetsAfterPrev = bars.map(b=>parseInt(b.getAttribute('data-offset'),10));
  console.log('Offsets after paging back once (expect -7..-4):', JSON.stringify(offsetsAfterPrev));
  console.log('Paging back shows strictly older weeks than the initial -3..0 window:', offsetsAfterPrev.every(o=>o<=-4) ? 'OK' : 'FAIL');
  console.log('Next button now enabled after paging back:', !doc.getElementById('progWeeksNext').disabled ? 'OK' : 'FAIL');
  const rightmostAfterPrev = bars.find(b=>parseInt(b.getAttribute('data-offset'),10)===Math.max(...offsetsAfterPrev));
  console.log('Rightmost bar in the new window is auto-selected:', rightmostAfterPrev.classList.contains('selected') ? 'OK' : 'FAIL');

  // --- Paging back repeatedly hits the cap (12 weeks) and Prev disables ---
  prevBtn.click(); await wait(10);
  console.log('Prev disabled at the 12-week cap:', doc.getElementById('progWeeksPrev').disabled ? 'OK' : 'FAIL');
  const cappedOffsets = [...doc.querySelectorAll('#progBarChart .bar-col')].map(b=>parseInt(b.getAttribute('data-offset'),10));
  console.log('Offsets at the cap (expect -11..-8):', JSON.stringify(cappedOffsets));
  console.log('Never goes past 12 weeks back:', Math.min(...cappedOffsets)===-11 ? 'OK' : 'FAIL');

  // A further click should be a no-op (still capped).
  prevBtn.click(); await wait(10);
  const stillCapped = [...doc.querySelectorAll('#progBarChart .bar-col')].map(b=>parseInt(b.getAttribute('data-offset'),10));
  console.log('Clicking Prev again at the cap does not go further:', JSON.stringify(stillCapped)===JSON.stringify(cappedOffsets) ? 'OK' : 'FAIL');

  // --- Paging forward twice should return to the original "Now" window ---
  const nextBtn = doc.getElementById('progWeeksNext');
  nextBtn.click(); await wait(10);
  nextBtn.click(); await wait(10);
  const backToNow = [...doc.querySelectorAll('#progBarChart .bar-col')].map(b=>parseInt(b.getAttribute('data-offset'),10));
  console.log('Paging forward twice returns to the -3..0 window:', JSON.stringify(backToNow)===JSON.stringify([-3,-2,-1,0]) ? 'OK' : 'FAIL');
  console.log('Next disabled again once back at the front:', doc.getElementById('progWeeksNext').disabled ? 'OK' : 'FAIL');

  // --- Sanity: "Now" week's computed workouts should be internally consistent with state.doneCount ---
  // (indirect check: the selected detail for offset 0 should be a small non-negative integer)
  const nowBarAgain = [...doc.querySelectorAll('#progBarChart .bar-col')].find(b=>b.getAttribute('data-offset')==='0');
  nowBarAgain.click();
  await wait(10);
  const nowWorkoutsText = doc.getElementById('progWeekDetail').querySelector('.wd-stat .v').textContent;
  console.log('"Now" week workouts value looks sane:', /^\d+$/.test(nowWorkoutsText) ? `OK (${nowWorkoutsText})` : `FAIL (${nowWorkoutsText})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
