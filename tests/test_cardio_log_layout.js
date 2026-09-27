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
  // Create Workout now always defaults to "just planned" (not done), regardless of day -- so
  // switching to Run while still in that default state shows the pace-target field, not the
  // cardio log rows (those are reserved for "already done" logging).
  console.log('Run defaults to planning mode (Completed off) -- pace-target field shown, cardio section hidden:',
    doc.getElementById('cardioLogSection').hidden && !doc.getElementById('createPaceSection').hidden ? 'OK' : 'FAIL');

  // Marking it "already done" is what reveals the cardio log rows.
  doc.getElementById('createCompletedToggle').click();
  await wait(10);
  console.log('Marking Run as already done shows the cardio section, hides Volume:',
    doc.getElementById('manualVolumeSection').hidden && !doc.getElementById('cardioLogSection').hidden ? 'OK' : 'FAIL');
  console.log('Date defaults to the day Day Detail was opened for:', doc.getElementById('manualDateInput').value.length>0 ? `OK (${doc.getElementById('manualDateInput').value})` : 'FAIL');
  console.log('Pace shows the empty placeholder before anything is entered:', doc.getElementById('manualPaceDisplay').textContent==='-:--/mi' ? 'OK' : `FAIL (${doc.getElementById('manualPaceDisplay').textContent})`);

  // Switching back to "planning" (not yet done) falls back to the target-pace field again.
  doc.getElementById('createCompletedToggle').click();
  await wait(10);
  console.log('Switching to planning mode hides the cardio section and shows the pace-target field instead:',
    doc.getElementById('cardioLogSection').hidden && !doc.getElementById('createPaceSection').hidden ? 'OK' : 'FAIL');
  doc.getElementById('createCompletedToggle').click(); // back to "already done"
  await wait(10);

  // Fill in Duration + Distance, confirm the pace auto-computes live.
  doc.getElementById('manualNameInput').value = 'Tempo Run';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualDurationMInput').value = '30';
  doc.getElementById('manualDurationMInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualDistanceInput').value = '4';
  doc.getElementById('manualDistanceInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  console.log('Pace auto-computes from Duration/Distance (30 min / 4 mi = 7:30/mi):', doc.getElementById('manualPaceDisplay').textContent==='7:30/mi' ? 'OK' : `FAIL (${doc.getElementById('manualPaceDisplay').textContent})`);

  doc.getElementById('saveManualEntry').click();
  await wait(20);

  const bubbleText = doc.getElementById('dayDetailEntries').textContent;
  console.log('Logged entry shows the distance and duration derived from the structured fields:',
    bubbleText.includes('4 mi') && bubbleText.includes('30:00') ? 'OK' : `FAIL (${bubbleText})`);

  // Tapping the logged run opens Log Performance, pre-filled from the stored structured fields (not
  // re-parsed from the display string).
  const bubble = doc.querySelector('#dayDetailEntries .manual-entry[data-entry-id]');
  bubble.click();
  await wait(20);
  console.log('Tapping the logged run opens Log Performance:', doc.getElementById('logPerfOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Pre-fills Distance:', doc.getElementById('logPerfDistanceInput').value==='4' ? 'OK' : `FAIL (${doc.getElementById('logPerfDistanceInput').value})`);
  console.log('Pre-fills Total Time as 0:30:00:', ['logPerfTimeHInput','logPerfTimeMInput','logPerfTimeSInput'].map(id=>doc.getElementById(id).value).join(':')==='0:30:0' ? 'OK' : `FAIL (${['logPerfTimeHInput','logPerfTimeMInput','logPerfTimeSInput'].map(id=>doc.getElementById(id).value).join(':')})`);

  // Correct the distance and save -- still exactly one entry, not a duplicate.
  doc.getElementById('logPerfDistanceInput').value = '5';
  doc.getElementById('saveLogPerf').click();
  await wait(20);
  const entriesAfter = [...doc.querySelectorAll('#dayDetailEntries .manual-entry')];
  console.log('Still exactly one entry after correcting the distance:', entriesAfter.length===1 ? 'OK' : `FAIL (${entriesAfter.length})`);
  console.log('Entry reflects the corrected distance:', doc.getElementById('dayDetailEntries').textContent.includes('5 mi') ? 'OK' : `FAIL (${doc.getElementById('dayDetailEntries').textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
