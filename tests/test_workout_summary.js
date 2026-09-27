const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Covers the Workout Summary overlay itself: tapping a completed/logged workout bubble in Day
// Detail's "Logged Workouts" list should open a read-only recap (not the edit form), with a small
// Edit button at the bottom that's the only way in from there to actually change it.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);

  // Log a strength entry with notes -- exercises the plain free-text (non-cardio) summary path.
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Push-ups';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='strength').click();
  doc.getElementById('manualVolumeInput').value = '40';
  doc.getElementById('manualVolumeInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualNotesInput').value = 'Felt strong today';
  doc.getElementById('manualNotesInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  const bubble = doc.querySelector('#dayDetailEntries .manual-entry[data-entry-id]');
  bubble.click();
  await wait(20);

  console.log('Tapping the bubble opens the summary overlay:', doc.getElementById('workoutSummaryOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Edit form did NOT open:', doc.getElementById('manualEntryOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('Summary title is the workout name:', doc.getElementById('workoutSummaryTitle').textContent==='Push-ups' ? 'OK' : `FAIL (${doc.getElementById('workoutSummaryTitle').textContent})`);
  console.log('Non-cardio summary shows the plain volume text:', doc.getElementById('workoutSummaryDetail').textContent==='40' ? 'OK' : `FAIL (${doc.getElementById('workoutSummaryDetail').textContent})`);
  console.log('No stats-grid for a non-cardio entry:', doc.getElementById('workoutSummaryStats').innerHTML.trim()==='' ? 'OK' : `FAIL (${doc.getElementById('workoutSummaryStats').innerHTML})`);
  console.log('Notes section is visible and shows the logged note:',
    doc.getElementById('workoutSummaryNotesSection').hidden===false && doc.getElementById('workoutSummaryNotes').textContent==='Felt strong today' ? 'OK' : 'FAIL');

  // Close via the X -- should NOT open the edit form, and Day Detail should still be open underneath.
  doc.getElementById('closeWorkoutSummary').click();
  await wait(20);
  console.log('Closing the summary with X does not open the edit form:', doc.getElementById('manualEntryOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('Day Detail is still open after closing the summary:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');

  // Re-open and use the small Edit button this time.
  doc.querySelector('#dayDetailEntries .manual-entry[data-entry-id]').click();
  await wait(20);
  doc.getElementById('editWorkoutSummaryBtn').click();
  await wait(20);
  console.log('Summary closes and Create Workout opens, pre-filled, via the Edit button:',
    doc.getElementById('workoutSummaryOverlay').hidden===true && doc.getElementById('manualEntryOverlay').hidden===false
    && doc.getElementById('manualNameInput').value==='Push-ups' ? 'OK' : 'FAIL');
  doc.getElementById('closeManualEntry').click();
  await wait(10);

  // A logged, notes-free entry should hide the Notes section entirely.
  doc.querySelector('#dayDetailEntries .manual-entry[data-entry-id]').click();
  await wait(10);
  doc.getElementById('editWorkoutSummaryBtn').click();
  await wait(10);
  doc.getElementById('manualNotesInput').value = '';
  doc.getElementById('manualNotesInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  doc.querySelector('#dayDetailEntries .manual-entry[data-entry-id]').click();
  await wait(20);
  console.log('Notes section is hidden once notes are cleared:', doc.getElementById('workoutSummaryNotesSection').hidden===true ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
