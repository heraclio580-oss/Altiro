const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Covers logging a cardio Duration that needs real hour:minute:second precision (e.g. a long run
// past an hour) -- the Duration stat used to be a single "minutes" number box that couldn't express
// seconds at all and got unwieldy for anything over an hour.
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
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  await wait(10);
  doc.getElementById('createCompletedToggle').click();
  await wait(10);

  doc.getElementById('manualNameInput').value = 'Half Marathon';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));

  // 1 hour, 23 minutes, 45 seconds.
  doc.getElementById('manualDurationHInput').value = '1';
  doc.getElementById('manualDurationHInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualDurationMInput').value = '23';
  doc.getElementById('manualDurationMInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualDurationSInput').value = '45';
  doc.getElementById('manualDurationSInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualDistanceInput').value = '13.1';
  doc.getElementById('manualDistanceInput').dispatchEvent(new window.Event('input', {bubbles:true}));

  // 83.75 min / 13.1 mi = 6.393... min/mi = 6:24/mi.
  console.log('Pace auto-computes correctly from an hour-plus duration:',
    doc.getElementById('manualPaceDisplay').textContent==='6:24/mi' ? 'OK' : `FAIL (${doc.getElementById('manualPaceDisplay').textContent})`);

  doc.getElementById('saveManualEntry').click();
  await wait(20);

  const bubbleText = doc.getElementById('dayDetailEntries').textContent;
  console.log('Logged entry shows the real h:mm:ss duration (not rounded to :00 seconds):',
    bubbleText.includes('1:23:45') ? 'OK' : `FAIL (${bubbleText})`);

  const bubble = doc.querySelector('#dayDetailEntries .manual-entry[data-entry-id]');
  bubble.click();
  await wait(20);
  console.log('Tapping it opens Log Performance with the real h:m:s time (1:23:45):',
    ['logPerfTimeHInput','logPerfTimeMInput','logPerfTimeSInput'].map(id=>doc.getElementById(id).value).join(':')==='1:23:45' ? 'OK' : `FAIL (${['logPerfTimeHInput','logPerfTimeMInput','logPerfTimeSInput'].map(id=>doc.getElementById(id).value).join(':')})`);

  // A duration under an hour should not show a leading "0:" hours segment.
  doc.getElementById('logPerfTimeHInput').value = '0';
  doc.getElementById('logPerfTimeMInput').value = '9';
  doc.getElementById('logPerfTimeSInput').value = '5';
  doc.getElementById('saveLogPerf').click();
  await wait(20);
  console.log('Sub-hour duration displays as m:ss, no leading hour segment:',
    doc.getElementById('dayDetailEntries').textContent.includes('9:05') && !doc.getElementById('dayDetailEntries').textContent.includes('0:09:05') ? 'OK' : `FAIL (${doc.getElementById('dayDetailEntries').textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
