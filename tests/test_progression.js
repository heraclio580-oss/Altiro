const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Today's default session (Upper Body Strength) is a strength session, which is exactly what we need
// to exercise the new Log Performance sheet + progression engine end to end via pure DOM interaction
// (the app's script is wrapped in an IIFE, so internal state/functions are intentionally not exposed
// on window -- matching every other test file in this suite).
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);

  const title = doc.getElementById('sessionCard').querySelector('.title').textContent;
  console.log('Today\'s session is a strength session:', title.includes('Upper Body Strength') ? 'OK' : `FAIL (${title})`);

  const recordBtn = doc.getElementById('recordBtn');
  console.log('Record button actionable:', !recordBtn.classList.contains('disabled') && !recordBtn.classList.contains('done') ? 'OK' : 'FAIL');
  console.log('Home shows a Next Suggested hint before recording:', doc.getElementById('sessionCard').textContent.includes('lb') ? 'OK' : 'FAIL');

  recordBtn.click();
  await wait(950);

  console.log('Log Performance sheet opened after recording pulse:', doc.getElementById('logPerfOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Weight/Reps sections visible for strength:', !doc.getElementById('logPerfWeightSection').hidden && !doc.getElementById('logPerfRepsSection').hidden ? 'OK' : 'FAIL');
  console.log('Time section hidden for strength:', doc.getElementById('logPerfTimeSection').hidden ? 'OK' : 'FAIL');
  const seededWeight = parseFloat(doc.getElementById('logPerfWeightInput').value);
  const seededReps = parseFloat(doc.getElementById('logPerfRepsInput').value);
  console.log('Seeded weight/reps look sane:', seededWeight>0 && seededReps>0 ? `OK (${seededWeight} lb x ${seededReps})` : 'FAIL');

  // Meet the target reps with a non-"hard" feel -> should progress next time.
  doc.getElementById('logPerfWeightInput').value = seededWeight;
  doc.getElementById('logPerfRepsInput').value = seededReps;
  doc.getElementById('saveLogPerf').click();
  await wait(30);

  console.log('Navigated to Summary screen:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');
  console.log('Summary shows the actual logged weight/reps:', doc.getElementById('summaryStats').textContent.includes(`${seededWeight} lb x ${seededReps}`) ? 'OK' : 'FAIL');
  console.log('Summary includes a Next Suggested stat:', doc.getElementById('summaryStats').textContent.includes('Next Suggested') ? 'OK' : 'FAIL');
  console.log('Progression note visible:', doc.getElementById('summaryProgressNote').hidden===false ? 'OK' : 'FAIL');
  const upMsgExpected = `Nice work — next time we'll suggest ${seededWeight+5} lb.`;
  console.log('Progression note shows the "up" message with +5 lb target:', doc.getElementById('summaryProgressMsg').textContent === upMsgExpected ? 'OK' : `FAIL (got: ${doc.getElementById('summaryProgressMsg').textContent})`);

  // Go back to Home; the suggested target for the SAME session title should now be 5 lb higher.
  goPill('home');
  await wait(20);
  console.log('Record button correctly shows done for today:', doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');

  // Reopen today's slot via the Completed toggle (flips the stale-override back to "not done"),
  // purely through the same DOM affordance an end user has -- no internal state poking.
  doc.getElementById('homeEntriesWrap'); // ensure home is fully rendered
  const scrollTarget = doc.getElementById('sessionCard');
  doc.getElementById('screen-home').scrollTop = scrollTarget.offsetTop;
  const completeToggle = doc.getElementById('homeCompleteToggle');
  completeToggle.click();
  await wait(20);
  console.log('Record button actionable again after toggling not-done:', !doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');

  doc.getElementById('recordBtn').click();
  await wait(950);
  const secondSeededWeight = parseFloat(doc.getElementById('logPerfWeightInput').value);
  console.log('Second round reseeds with the progressed (+5 lb) weight:', secondSeededWeight === seededWeight+5 ? 'OK' : `FAIL (${secondSeededWeight} vs expected ${seededWeight+5})`);

  // This time, miss the rep target with a "Too Hard" feel -> should hold steady, not advance or regress.
  doc.getElementById('logPerfWeightInput').value = secondSeededWeight;
  doc.getElementById('logPerfRepsInput').value = 1;
  const hardChip = [...doc.querySelectorAll('#logPerfFeelChips .chip')].find(c => c.getAttribute('data-feel') === 'hard');
  hardChip.click();
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  const holdMsgExpected = `Solid effort — we'll suggest the same ${secondSeededWeight} lb next time.`;
  console.log('Progression note shows the "hold steady" message after a hard/missed session:', doc.getElementById('summaryProgressMsg').textContent === holdMsgExpected ? 'OK' : `FAIL (got: ${doc.getElementById('summaryProgressMsg').textContent})`);

  // Third round: verify the target genuinely held steady (didn't creep up or down) and that
  // canceling the Log Performance sheet doesn't get the user stuck or falsely mark the day done.
  goPill('home');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  const thirdSeededWeight = parseFloat(doc.getElementById('logPerfWeightInput').value);
  console.log('Weight held steady (no change) after the missed/hard session:', thirdSeededWeight === secondSeededWeight ? 'OK' : `FAIL (${thirdSeededWeight} vs expected ${secondSeededWeight})`);

  doc.getElementById('closeLogPerf').click();
  await wait(10);
  console.log('Cancel closes the sheet and resets the record button (not stuck "recording"):', doc.getElementById('logPerfOverlay').hidden===true && !doc.getElementById('recordBtn').classList.contains('recording') ? 'OK' : 'FAIL');
  console.log('Cancel does NOT mark the day completed:', !doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
