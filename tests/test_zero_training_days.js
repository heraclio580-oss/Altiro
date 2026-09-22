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
  const weekdayChip = i => doc.querySelectorAll('#adjWeekdayChips .chip')[i];

  goPill('adjust');
  await wait(20);

  // Default fixture is a 3-day (Mon/Wed/Fri) pattern -- deselect every remaining day one at a time.
  [0,2,4].forEach(i => weekdayChip(i).click());
  await wait(10);
  console.log('All 7 weekday chips can be deselected (no minimum-1 guard on the Adjust page):',
    [0,1,2,3,4,5,6].every(i=>!weekdayChip(i).classList.contains('sel')) ? 'OK' : 'FAIL');
  console.log('Day-count chips show none selected (0 matches no 2-6 preset):',
    ![...doc.querySelectorAll('#adjDayCountChips .chip')].some(c=>c.classList.contains('sel')) ? 'OK' : 'FAIL');
  console.log('Summary shows a friendly "plan each day yourself" note instead of "0 days a week":',
    doc.getElementById('adjDaysSummary').textContent.includes('0') === false ? 'OK' : `FAIL (${doc.getElementById('adjDaysSummary').textContent})`);

  doc.getElementById('applyAdjust').click();
  await wait(20);

  // Every day (past days keep their real history, but today/future have no auto-plan anymore) should
  // now show as a Rest Day, since there's no training day left to auto-generate a session for.
  goPill('home');
  await wait(20);
  console.log('Today has no auto-generated workout -- it\'s a Rest Day now:', doc.getElementById('sessionCard').textContent.includes('Rest Day') ? 'OK' : 'FAIL');

  doc.querySelector('#weekStrip .day-cell[data-day="5"]').click(); // Saturday, future
  await wait(20);
  console.log('A future day also has no auto-plan -- Rest Day:', doc.getElementById('dayDetailPlanRow').textContent.includes('Rest Day') ? 'OK' : 'FAIL');

  // With zero fixed training days, the user's only path to a workout on any given day is to plan
  // it themselves -- confirm the rest-day bubble still opens a blank Create Workout for exactly that.
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  console.log('Tapping the rest-day bubble still opens Create Workout so the user can plan it manually:', doc.getElementById('manualEntryOverlay').hidden===false ? 'OK' : 'FAIL');
  doc.getElementById('manualNameInput').value = 'Long Run';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  console.log('That manually-planned workout sticks despite zero training days configured:', doc.getElementById('dayDetailPlanRow').textContent.includes('Long Run') ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // Re-selecting days afterward still works normally.
  goPill('adjust');
  await wait(20);
  weekdayChip(1).click(); // Tuesday
  await wait(10);
  console.log('Re-selecting a day after being at zero works fine:', weekdayChip(1).classList.contains('sel') ? 'OK' : 'FAIL');
  console.log('Summary switches back to showing a count once at least one day is picked:', doc.getElementById('adjDaysSummary').textContent.includes('1') ? 'OK' : `FAIL (${doc.getElementById('adjDaysSummary').textContent})`);
  doc.getElementById('closeAdjust').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
