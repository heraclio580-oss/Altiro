const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

function submitReview(doc, rating){
  doc.getElementById('reviewRatingSlider').value = String(rating);
  doc.getElementById('reviewRatingSlider').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('submitReviewBtn').click();
}
function exerciseRows(doc){
  return [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')];
}
function readSeeded(doc){
  return exerciseRows(doc).map(row => ({
    key: row.getAttribute('data-exercise-key'),
    weight: parseFloat(row.querySelector('[data-field="weight"]').value),
    reps: parseFloat(row.querySelector('[data-field="reps"]').value),
  }));
}
function fillRow(row, weight, reps){
  row.querySelector('[data-field="weight"]').value = weight;
  row.querySelector('[data-field="reps"]').value = reps;
}

// Today's default session (Upper Body Strength) is a strength session with a real 4-exercise
// template (Bench Press, Bent-Over Row, Overhead Press, Bicep Curl -- all weighted, none
// bodyweight), which is exactly what's needed to exercise the new per-exercise Log Performance
// sheet + post-workout review + per-exercise progression engine end to end via pure DOM
// interaction (the app's script is wrapped in an IIFE, so internal state/functions are
// intentionally not exposed on window -- matching every other test file in this suite).
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);

  const title = doc.getElementById('sessionCard').querySelector('.title').textContent;
  console.log('Today\'s session is a strength session:', title.includes('Upper Body Strength') ? 'OK' : `FAIL (${title})`);
  console.log('Home shows the exercise list for today\'s session:', doc.getElementById('sessionCard').textContent.includes('Bench Press') ? 'OK' : 'FAIL');

  const recordBtn = doc.getElementById('recordBtn');
  console.log('Record button actionable:', !recordBtn.classList.contains('disabled') && !recordBtn.classList.contains('done') ? 'OK' : 'FAIL');

  recordBtn.click();
  await wait(950);

  console.log('Log Performance sheet opened after recording pulse:', doc.getElementById('logPerfOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('The single session-level weight/reps inputs are hidden (structured exercises replace them):', doc.getElementById('logPerfWeightSection').hidden && doc.getElementById('logPerfRepsSection').hidden ? 'OK' : 'FAIL');
  console.log('Time section hidden for strength:', doc.getElementById('logPerfTimeSection').hidden ? 'OK' : 'FAIL');
  const rows1 = exerciseRows(doc);
  console.log('One row per exercise in the template (4):', rows1.length===4 ? 'OK' : `FAIL (${rows1.length})`);
  const expectedNames = ['Bench Press','Bent-Over Row','Overhead Press','Bicep Curl'];
  console.log('Rows match the Upper Body Strength template, in order:', expectedNames.every((n,i)=>rows1[i].getAttribute('data-exercise-key')===n) ? 'OK' : `FAIL (${rows1.map(r=>r.getAttribute('data-exercise-key'))})`);

  const seeded1 = readSeeded(doc);
  console.log('Seeded weight/reps for every exercise look sane:', seeded1.every(s=>s.weight>0 && s.reps>0) ? `OK (${JSON.stringify(seeded1)})` : `FAIL (${JSON.stringify(seeded1)})`);

  // Meet every exercise's rep target as-is (seeded values already meet themselves) and save.
  doc.getElementById('saveLogPerf').click();
  await wait(30);

  console.log('Navigated to Summary screen:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');
  const summaryExText = doc.getElementById('summaryExercisesList').textContent;
  console.log('Summary\'s exercise list shows all 4 logged results:', seeded1.every(s=>summaryExText.includes(`${s.weight} lb x ${s.reps}`)) ? 'OK' : `FAIL (${summaryExText})`);
  console.log('Review card is shown before any progression result:', doc.getElementById('summaryReviewCard').hidden===false ? 'OK' : 'FAIL');
  console.log('No progression note yet either:', doc.getElementById('summaryProgressNote').hidden===true ? 'OK' : 'FAIL');

  // Great (non-"hard") rating, reps met -> every exercise should advance.
  submitReview(doc, 5);
  await wait(30);

  console.log('Review card hides after submitting:', doc.getElementById('summaryReviewCard').hidden===true ? 'OK' : 'FAIL');
  console.log('Progression note visible:', doc.getElementById('summaryProgressNote').hidden===false ? 'OK' : 'FAIL');
  console.log('Progression note reports all 4 exercises advancing:', doc.getElementById('summaryProgressMsg').textContent === 'Nice work — 4 of 4 exercises get heavier next time.' ? 'OK' : `FAIL (got: ${doc.getElementById('summaryProgressMsg').textContent})`);

  // Go back to Home; reopen today's slot via the Completed toggle, purely through the same DOM
  // affordance an end user has -- no internal state poking.
  goPill('home');
  await wait(20);
  console.log('Record button correctly shows done for today:', doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  console.log('Record button actionable again after toggling not-done:', !doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');

  doc.getElementById('recordBtn').click();
  await wait(950);
  const seeded2 = readSeeded(doc);
  console.log('Second round reseeds every exercise +5 lb from last time:', seeded1.every((s,i)=>seeded2[i].weight===s.weight+5) ? 'OK' : `FAIL (${JSON.stringify(seeded2)} vs +5 of ${JSON.stringify(seeded1)})`);

  // This time, miss every rep target AND give it a rough (hard) rating -> should hold steady.
  const rows2 = exerciseRows(doc);
  rows2.forEach((row,i)=> fillRow(row, seeded2[i].weight, 1));
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  submitReview(doc, 1);
  await wait(30);
  console.log('Progression note reports 0 exercises advancing on a hard/missed session:', doc.getElementById('summaryProgressMsg').textContent === "Solid effort — we'll suggest the same weights next time." ? 'OK' : `FAIL (got: ${doc.getElementById('summaryProgressMsg').textContent})`);

  // Third round: verify weights genuinely held steady (didn't creep up or down), and that
  // canceling the Log Performance sheet doesn't get the user stuck or falsely mark the day done.
  goPill('home');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  const seeded3 = readSeeded(doc);
  console.log('Weights held steady (no change) after the missed/hard session:', seeded2.every((s,i)=>seeded3[i].weight===s.weight) ? 'OK' : `FAIL (${JSON.stringify(seeded3)} vs ${JSON.stringify(seeded2)})`);

  doc.getElementById('closeLogPerf').click();
  await wait(10);
  console.log('Cancel closes the sheet and resets the record button (not stuck "recording"):', doc.getElementById('logPerfOverlay').hidden===true && !doc.getElementById('recordBtn').classList.contains('recording') ? 'OK' : 'FAIL');
  console.log('Cancel does NOT mark the day completed:', !doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
