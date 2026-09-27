const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for a reported gap: editing a logged cardio workout (through the new Workout
// Summary -> Edit flow) updated the "Logged Workouts" bubble itself, but nothing that reads
// progress data -- Home's "This Week" distance card, Progress's week-detail, or even the day's own
// Scheduled/primary row -- ever re-read it. Root cause: creating/editing a manual entry never wrote
// to dayLog.actualRunDistance (the field weekStats() actually trusts first), and once a rest day's
// primary got promoted to reflect a logged entry (see promotePrimaryFromLog), nothing kept that
// promoted primary's own displayed text in sync with later edits to the entry it came from. Separately,
// Home's own distance card turned out to read a completely different, never-persisted accumulator
// (state.mileage) that manual entries never touched at all, even freshly created ones -- fixed by
// having it read weekStats() too, the same source Progress already used.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);

  // Log a cardio run on today (a rest day by default) -- 5 mi / 40 min.
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  await wait(10);
  if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('manualNameInput').value = 'Morning Run';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualDistanceInput').value = '5';
  doc.getElementById('manualDistanceInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualDurationMInput').value = '40';
  doc.getElementById('manualDurationMInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  goPill('home');
  await wait(20);
  console.log('Home "This Week" distance reflects the freshly-logged 5mi run:', doc.getElementById('ovDistanceVal').textContent==='5.0/15 mi' ? 'OK' : `FAIL (${doc.getElementById('ovDistanceVal').textContent})`);

  goPill('progress');
  await wait(20);
  console.log('Progress week-detail also reflects the 5mi run:', doc.getElementById('progWeekDetail').textContent.includes('5.0 mi') ? 'OK' : `FAIL (${doc.getElementById('progWeekDetail').textContent})`);

  // Now edit it through the Workout Summary's Edit button -- correct the distance to 8 mi.
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  console.log('Scheduled row shows the original 5mi before editing:', doc.getElementById('dayDetailPlanRow').textContent.includes('5 mi') ? 'OK' : `FAIL (${doc.getElementById('dayDetailPlanRow').textContent})`);

  doc.querySelector('#dayDetailEntries .manual-entry[data-entry-id]').click();
  await wait(20);
  doc.getElementById('editWorkoutSummaryBtn').click();
  await wait(20);
  doc.getElementById('manualDistanceInput').value = '8';
  doc.getElementById('manualDistanceInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  console.log('Scheduled/primary row updates to the corrected 8mi (not stuck on the stale 5mi):',
    doc.getElementById('dayDetailPlanRow').textContent.includes('8 mi') && !doc.getElementById('dayDetailPlanRow').textContent.includes('5 mi') ? 'OK' : `FAIL (${doc.getElementById('dayDetailPlanRow').textContent})`);

  goPill('home');
  await wait(20);
  console.log('Home "This Week" distance reflects the EDITED 8mi, not the original 5mi:', doc.getElementById('ovDistanceVal').textContent==='8.0/15 mi' ? 'OK' : `FAIL (${doc.getElementById('ovDistanceVal').textContent})`);

  goPill('progress');
  await wait(20);
  const progText = doc.getElementById('progWeekDetail').textContent;
  console.log('Progress week-detail also reflects the edited 8mi, not the original 5mi:', progText.includes('8.0 mi') && !progText.includes('5.0 mi') ? 'OK' : `FAIL (${progText})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
