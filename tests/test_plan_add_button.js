const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function click(el){ el.dispatchEvent(new window.Event('click', {bubbles:true, cancelable:true})); }

// Restructured Plan rows into card-style "bubbles" (www/index.html planListRowHtml) and added a
// "+ Add" button to every day -- including days that already have a workout -- so a second workout
// can be added to a day, or a rest day filled in, straight from the Plan list without opening Day
// Detail first. This exercises that button end to end.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('week');
  await wait(20);
  const weekList = doc.getElementById('weekList');
  const rowFor = i => weekList.querySelector(`.plan-row[data-day="${i}"][data-week-idx="0"]`);

  // Sunday (idx 6) is a future rest day under the default Mon/Wed/Fri split with today = Friday (idx 4).
  const sunRow = rowFor(6);
  console.log('Every day row has a +Add button:', !!sunRow.querySelector('.prow-add') ? 'OK' : 'FAIL');
  console.log('Sunday starts as Rest Day:', sunRow.querySelector('.prow-title').textContent==='Rest Day' ? 'OK' : 'FAIL');

  // --- Clicking +Add opens Create Workout for that date directly, no Day Detail stop ---
  click(sunRow.querySelector('.prow-add'));
  await wait(10);
  console.log('Create Workout sheet opened:', doc.getElementById('manualEntryOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Day Detail did NOT open:', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('Date field pre-filled with Sunday\'s date:', doc.getElementById('manualDateInput').value==='2026-09-20' ? 'OK' : `FAIL (${doc.getElementById('manualDateInput').value})`);
  console.log('No row left marked as a reorder source (the click did not arm a drag/tap-move):', !weekList.querySelector('.reorder-source') ? 'OK' : 'FAIL');

  // A future day defaults Create Workout to "just plan it", not "log it as done".
  console.log('Defaults to planning (not logging as already done) since Sunday is in the future:', !doc.getElementById('createCompletedToggle').classList.contains('on') ? 'OK' : 'FAIL');

  // --- Fill it in and save ---
  doc.getElementById('manualNameInput').value = 'Long Run';
  doc.getElementById('manualVolumeInput').value = '8 mi';
  click(doc.getElementById('saveManualEntry'));
  await wait(20);
  console.log('Create Workout sheet closed after saving:', doc.getElementById('manualEntryOverlay').hidden===true ? 'OK' : 'FAIL');

  const wl = doc.getElementById('weekList');
  const sunRowAfter = wl.querySelector('.plan-row[data-day="6"][data-week-idx="0"]');
  console.log('Plan list re-rendered with the new workout on Sunday:', sunRowAfter.querySelector('.prow-title').textContent==='Long Run' ? 'OK' : `FAIL (${sunRowAfter.querySelector('.prow-title').textContent})`);

  // --- +Add on a day that ALREADY has a workout still opens Create Workout for that same day ---
  // Friday (idx 4, today) has a real workout by default under this seed's plan.
  const friRow = wl.querySelector('.plan-row[data-day="4"][data-week-idx="0"]');
  const friTitleBefore = friRow.querySelector('.prow-title').textContent;
  console.log('Friday (today) already has a real workout (not Rest Day):', friTitleBefore!=='Rest Day' ? 'OK' : `FAIL (${friTitleBefore})`);
  click(friRow.querySelector('.prow-add'));
  await wait(10);
  console.log('+Add on a day with an existing workout still opens Create Workout:', doc.getElementById('manualEntryOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Pre-filled with Friday\'s date, not Sunday\'s:', doc.getElementById('manualDateInput').value==='2026-09-18' ? 'OK' : `FAIL (${doc.getElementById('manualDateInput').value})`);
  doc.getElementById('closeManualEntry').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
