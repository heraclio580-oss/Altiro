const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test: tapping a logged workout's bubble in Day Detail used to have no edit path at all
// (only delete), so the only way to "fix" a logged entry was to log a brand new one on top of it,
// silently leaving a duplicate at the bottom of the list. Tapping a bubble should now open it for
// editing and save changes IN PLACE, while an explicit "+ Create Workout" still adds a genuinely
// new entry when that's actually intended.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  console.log('Day Detail opened for today:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');

  // Log a first workout.
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Morning Run';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  doc.getElementById('manualVolumeInput').value = '3 mi';
  doc.getElementById('manualVolumeInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  console.log('One entry logged:', doc.querySelectorAll('#dayDetailEntries .manual-entry').length===1 ? 'OK' : `FAIL (${doc.querySelectorAll('#dayDetailEntries .manual-entry').length})`);

  // Tap the bubble to edit it.
  const bubble = doc.querySelector('#dayDetailEntries .manual-entry[data-entry-id]');
  console.log('Logged bubble is marked editable:', bubble.classList.contains('editable') ? 'OK' : 'FAIL');
  bubble.click();
  await wait(20);
  console.log('Create Workout sheet opens pre-filled with the existing entry:',
    doc.getElementById('manualNameInput').value==='Morning Run' && doc.getElementById('manualVolumeInput').value==='3 mi' ? 'OK' : `FAIL (name=${doc.getElementById('manualNameInput').value}, vol=${doc.getElementById('manualVolumeInput').value})`);
  console.log('Sheet title reads "Edit Workout":', doc.getElementById('manualEntryTitleLabel').textContent==='Edit Workout' ? 'OK' : `FAIL (${doc.getElementById('manualEntryTitleLabel').textContent})`);

  // Correct the distance and save.
  doc.getElementById('manualVolumeInput').value = '3.5 mi';
  doc.getElementById('manualVolumeInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  const entriesAfterEdit = [...doc.querySelectorAll('#dayDetailEntries .manual-entry')];
  console.log('Still exactly ONE entry after editing (not appended as a second one):', entriesAfterEdit.length===1 ? 'OK' : `FAIL (${entriesAfterEdit.length})`);
  console.log('That entry reflects the corrected distance:', doc.getElementById('dayDetailEntries').textContent.includes('3.5 mi') ? 'OK' : `FAIL (${doc.getElementById('dayDetailEntries').textContent})`);
  console.log('The original "3 mi" text is gone (genuinely edited, not duplicated):', !doc.getElementById('dayDetailEntries').textContent.includes('3 mi') || doc.getElementById('dayDetailEntries').textContent.match(/3 mi/g)===null ? 'OK' : `FAIL (${doc.getElementById('dayDetailEntries').textContent})`);

  // Now explicitly add a SECOND, genuinely new workout -- this must still append, not overwrite.
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  console.log('A fresh "+ Create Workout" open is NOT pre-filled from the previous edit:', doc.getElementById('manualNameInput').value==='' ? 'OK' : `FAIL (${doc.getElementById('manualNameInput').value})`);
  doc.getElementById('manualNameInput').value = 'Evening Stretch';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  const entriesAfterAdd = [...doc.querySelectorAll('#dayDetailEntries .manual-entry')];
  console.log('Intentionally adding a new workout results in exactly TWO entries:', entriesAfterAdd.length===2 ? 'OK' : `FAIL (${entriesAfterAdd.length})`);
  console.log('Both the edited original and the new one are present:',
    doc.getElementById('dayDetailEntries').textContent.includes('Morning Run') && doc.getElementById('dayDetailEntries').textContent.includes('Evening Stretch') ? 'OK' : `FAIL (${doc.getElementById('dayDetailEntries').textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
