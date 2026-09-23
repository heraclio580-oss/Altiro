const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Covers the new structured Date/Duration/Distance/Pace layout used when logging an already-done
// cardio (run) entry via "+ Create Workout" -- replaces the old single free-text Volume field for
// that specific case only (strength/interval, and planning a future run, are unaffected).
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);

  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  console.log('Defaults to strength -- generic Volume section visible, cardio section hidden:',
    !doc.getElementById('manualVolumeSection').hidden && doc.getElementById('cardioLogSection').hidden ? 'OK' : 'FAIL');

  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  await wait(10);
  console.log('Switching to Run (already-done by default) shows the cardio section, hides Volume:',
    doc.getElementById('manualVolumeSection').hidden && !doc.getElementById('cardioLogSection').hidden ? 'OK' : 'FAIL');
  console.log('Date defaults to the day Day Detail was opened for:', doc.getElementById('manualDateInput').value.length>0 ? `OK (${doc.getElementById('manualDateInput').value})` : 'FAIL');
  console.log('Pace shows the empty placeholder before anything is entered:', doc.getElementById('manualPaceDisplay').textContent==='-:--/mi' ? 'OK' : `FAIL (${doc.getElementById('manualPaceDisplay').textContent})`);

  // Switching to "planning" (not yet done) should fall back to the target-pace field, not the cardio log rows.
  doc.getElementById('createCompletedToggle').click();
  await wait(10);
  console.log('Switching to planning mode hides the cardio section and shows the pace-target field instead:',
    doc.getElementById('cardioLogSection').hidden && !doc.getElementById('createPaceSection').hidden ? 'OK' : 'FAIL');
  doc.getElementById('createCompletedToggle').click(); // back to "already done"
  await wait(10);

  // Fill in Duration + Distance, confirm the pace auto-computes live.
  doc.getElementById('manualNameInput').value = 'Tempo Run';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualDurationInput').value = '30';
  doc.getElementById('manualDurationInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualDistanceInput').value = '4';
  doc.getElementById('manualDistanceInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  console.log('Pace auto-computes from Duration/Distance (30 min / 4 mi = 7:30/mi):', doc.getElementById('manualPaceDisplay').textContent==='7:30/mi' ? 'OK' : `FAIL (${doc.getElementById('manualPaceDisplay').textContent})`);

  doc.getElementById('saveManualEntry').click();
  await wait(20);

  const bubbleText = doc.getElementById('dayDetailEntries').textContent;
  console.log('Logged entry shows the distance and duration derived from the structured fields:',
    bubbleText.includes('4 mi') && bubbleText.includes('30 min') ? 'OK' : `FAIL (${bubbleText})`);

  // Re-open the bubble to edit -- Duration/Distance should be pre-filled from the stored structured
  // fields, not re-parsed from the display string.
  const bubble = doc.querySelector('#dayDetailEntries .manual-entry[data-entry-id]');
  bubble.click();
  await wait(20);
  console.log('Re-opening for edit pre-fills Duration:', doc.getElementById('manualDurationInput').value==='30' ? 'OK' : `FAIL (${doc.getElementById('manualDurationInput').value})`);
  console.log('Re-opening for edit pre-fills Distance:', doc.getElementById('manualDistanceInput').value==='4' ? 'OK' : `FAIL (${doc.getElementById('manualDistanceInput').value})`);
  console.log('Re-opening for edit pre-fills Pace:', doc.getElementById('manualPaceDisplay').textContent==='7:30/mi' ? 'OK' : `FAIL (${doc.getElementById('manualPaceDisplay').textContent})`);

  // Correct the distance and save -- still exactly one entry, not a duplicate.
  doc.getElementById('manualDistanceInput').value = '5';
  doc.getElementById('manualDistanceInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  const entriesAfter = [...doc.querySelectorAll('#dayDetailEntries .manual-entry')];
  console.log('Still exactly one entry after editing the distance:', entriesAfter.length===1 ? 'OK' : `FAIL (${entriesAfter.length})`);
  console.log('Entry reflects the corrected distance:', doc.getElementById('dayDetailEntries').textContent.includes('5 mi') ? 'OK' : `FAIL (${doc.getElementById('dayDetailEntries').textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
