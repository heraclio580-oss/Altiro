const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for a reported bug: once a rest day's logged workout gets promoted into the
// primary slot (see promotePrimaryFromLog), tapping that primary bubble to edit it always showed
// "Mark as Completed" OFF -- openManualEntryForEdit hardcoded that default under the old assumption
// that a primary bubble is always a not-yet-done plan, which stopped being true once a genuinely
// completed workout could live there. Worse, resaving with the toggle switched to ON went through
// the "create a brand new manualEntries record" path (since manualEntryEditingId is null for a
// primary edit), appending a duplicate to Logged Workouts every single time instead of updating the
// promoted primary in place.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Log a completed workout on Sunday (a future rest day under the default Mon/Wed/Fri split).
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="6"]').click();
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('manualNameInput').value = 'Evening Bike Ride';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  console.log('Sunday\'s primary was promoted to the logged workout:', doc.getElementById('dayDetailPlanRow').textContent.includes('Evening Bike Ride') ? 'OK' : 'FAIL');
  console.log('Exactly one entry in Logged Workouts so far:', doc.querySelectorAll('#dayDetailEntries .manual-entry').length===1 ? 'OK' : `FAIL (${doc.querySelectorAll('#dayDetailEntries .manual-entry').length})`);

  // Tap the primary bubble to edit it.
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  console.log('Sheet title reads "Edit Workout":', doc.getElementById('manualEntryTitleLabel').textContent==='Edit Workout' ? 'OK' : `FAIL (${doc.getElementById('manualEntryTitleLabel').textContent})`);
  console.log('"Mark as Completed" correctly defaults ON (this primary is already done):',
    doc.getElementById('createCompletedToggle').classList.contains('on') ? 'OK' : 'FAIL');

  // Resave without changing anything -- must NOT create a duplicate.
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  console.log('Still exactly one entry after resaving the already-done primary (no duplicate):',
    doc.querySelectorAll('#dayDetailEntries .manual-entry').length===1 ? 'OK' : `FAIL (${doc.querySelectorAll('#dayDetailEntries .manual-entry').length})`);
  console.log('Primary bubble still reads the same workout:', doc.getElementById('dayDetailPlanRow').textContent.includes('Evening Bike Ride') ? 'OK' : 'FAIL');

  // Now edit it again, rename it, and toggle OFF (correcting a mistaken "already done" log back to
  // just a plan) -- this should update the SAME primary slot, not create anything new either.
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  doc.getElementById('createCompletedToggle').click(); // now OFF
  doc.getElementById('manualNameInput').value = 'Evening Bike Ride (Revised)';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  console.log('Primary reflects the revised title:', doc.getElementById('dayDetailPlanRow').textContent.includes('Evening Bike Ride (Revised)') ? 'OK' : `FAIL (${doc.getElementById('dayDetailPlanRow').textContent})`);
  // The day stays "done" here -- the original manualEntries record (the real evidence something
  // happened) is untouched by editing the primary's own completed flag, and a real log always wins
  // over an explicit "not done" toggle (same rule saveManualEntry already applies when a fresh log
  // is created). Toggling the primary off only affects that slot, not the underlying log entry.
  console.log('Day stays marked done -- the original logged entry still counts regardless of the primary\'s own toggle:',
    doc.getElementById('dayCompleteToggle').classList.contains('on')===true ? 'OK' : 'FAIL');
  console.log('Still exactly one entry in Logged Workouts (the original log, untouched by editing the primary):',
    doc.querySelectorAll('#dayDetailEntries .manual-entry').length===1 ? 'OK' : `FAIL (${doc.querySelectorAll('#dayDetailEntries .manual-entry').length})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
