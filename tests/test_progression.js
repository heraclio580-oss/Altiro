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
// Only weighted (non-bodyweight) rows carry a real weight/reps target to progress -- which exact
// session lands on "today" depends on the rotation, so this reads whatever's actually there rather
// than hardcoding a specific session/exercise list.
function readWeighted(doc){
  return exerciseRows(doc).filter(r=>!r.classList.contains('bodyweight')).map(row => ({
    key: row.getAttribute('data-exercise-key'),
    weight: parseFloat(row.querySelector('[data-field="weight"]').value),
    reps: parseFloat(row.querySelector('[data-field="reps"]').value),
  }));
}
function fillRow(doc, key, weight, reps){
  const row = exerciseRows(doc).find(r=>r.getAttribute('data-exercise-key')===key);
  row.querySelector('[data-field="weight"]').value = weight;
  row.querySelector('[data-field="reps"]').value = reps;
}

// Today's default session is whichever strength session the rotation lands on first (now that
// past days no longer consume a rotation slot -- see buildWeek()) -- every generated strength
// title has a real exercise template, so this drives the new per-exercise Log Performance sheet +
// post-workout review + per-exercise progression engine end to end via pure DOM interaction (the
// app's script is wrapped in an IIFE, so internal state/functions are intentionally not exposed on
// window -- matching every other test file in this suite), without assuming exactly which session
// or exercises are involved.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);

  const title = doc.getElementById('sessionCard').querySelector('.title').textContent;
  console.log('Today\'s session is a strength session with a real exercise breakdown:', doc.querySelector('#sessionCard .r-exercise-list') ? `OK (${title})` : `FAIL (${title})`);

  const recordBtn = doc.getElementById('recordBtn');
  console.log('Record button actionable:', !recordBtn.classList.contains('disabled') && !recordBtn.classList.contains('done') ? 'OK' : 'FAIL');

  recordBtn.click();
  await wait(950);

  console.log('Log Performance sheet opened after recording pulse:', doc.getElementById('logPerfOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('The single session-level weight/reps inputs are hidden (structured exercises replace them):', doc.getElementById('logPerfWeightSection').hidden && doc.getElementById('logPerfRepsSection').hidden ? 'OK' : 'FAIL');
  console.log('Time section hidden for strength:', doc.getElementById('logPerfTimeSection').hidden ? 'OK' : 'FAIL');
  const rows1 = exerciseRows(doc);
  console.log('One row rendered per template exercise:', rows1.length>0 ? `OK (${rows1.length})` : 'FAIL');

  const seeded1 = readWeighted(doc);
  console.log('This session has at least one weighted exercise to progress:', seeded1.length>0 ? `OK (${seeded1.length})` : 'FAIL');
  console.log('Seeded weight/reps for every weighted exercise look sane:', seeded1.every(s=>s.weight>0 && s.reps>0) ? `OK (${JSON.stringify(seeded1)})` : `FAIL (${JSON.stringify(seeded1)})`);

  // Meet every exercise's rep target as-is (seeded values already meet themselves) and save.
  doc.getElementById('saveLogPerf').click();
  await wait(30);

  console.log('Navigated to Summary screen:', doc.getElementById('screen-summary').hidden===false ? 'OK' : 'FAIL');
  const summaryExText = doc.getElementById('summaryExercisesList').textContent;
  console.log('Summary\'s exercise list shows every weighted result logged:', seeded1.every(s=>summaryExText.includes(`${s.weight} lb x ${s.reps}`)) ? 'OK' : `FAIL (${summaryExText})`);
  console.log('Review card is shown before any progression result:', doc.getElementById('summaryReviewCard').hidden===false ? 'OK' : 'FAIL');
  console.log('No progression note yet either:', doc.getElementById('summaryProgressNote').hidden===true ? 'OK' : 'FAIL');

  // Great (non-"hard") rating, reps met -> every weighted exercise should advance.
  submitReview(doc, 5);
  await wait(30);

  console.log('Review card hides after submitting:', doc.getElementById('summaryReviewCard').hidden===true ? 'OK' : 'FAIL');
  console.log('Progression note visible:', doc.getElementById('summaryProgressNote').hidden===false ? 'OK' : 'FAIL');
  const upMsgExpected = `Nice work — ${seeded1.length} of ${seeded1.length} exercises get heavier next time.`;
  console.log('Progression note reports every weighted exercise advancing:', doc.getElementById('summaryProgressMsg').textContent === upMsgExpected ? 'OK' : `FAIL (got: ${doc.getElementById('summaryProgressMsg').textContent}, expected: ${upMsgExpected})`);

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
  const seeded2 = readWeighted(doc);
  console.log('Second round reseeds every weighted exercise +5 lb from last time:', seeded1.every((s,i)=>seeded2[i].key===s.key && seeded2[i].weight===s.weight+5) ? 'OK' : `FAIL (${JSON.stringify(seeded2)} vs +5 of ${JSON.stringify(seeded1)})`);

  // This time, miss every rep target AND give it a rough (hard) rating -> should hold steady.
  seeded2.forEach(s => fillRow(doc, s.key, s.weight, 1));
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  submitReview(doc, 1);
  await wait(30);
  const holdMsgExpected = "Solid effort — we'll suggest the same weights next time.";
  console.log('Progression note reports 0 exercises advancing on a hard/missed session:', doc.getElementById('summaryProgressMsg').textContent === holdMsgExpected ? 'OK' : `FAIL (got: ${doc.getElementById('summaryProgressMsg').textContent})`);

  // Third round: verify weights genuinely held steady (didn't creep up or down), and that
  // canceling the Log Performance sheet doesn't get the user stuck or falsely mark the day done.
  goPill('home');
  await wait(20);
  doc.getElementById('screen-home').scrollTop = doc.getElementById('sessionCard').offsetTop;
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  const seeded3 = readWeighted(doc);
  console.log('Weights held steady (no change) after the missed/hard session:', seeded2.every((s,i)=>seeded3[i].key===s.key && seeded3[i].weight===s.weight) ? 'OK' : `FAIL (${JSON.stringify(seeded3)} vs ${JSON.stringify(seeded2)})`);

  doc.getElementById('closeLogPerf').click();
  await wait(10);
  console.log('Cancel closes the sheet and resets the record button (not stuck "recording"):', doc.getElementById('logPerfOverlay').hidden===true && !doc.getElementById('recordBtn').classList.contains('recording') ? 'OK' : 'FAIL');
  console.log('Cancel does NOT mark the day completed:', !doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
