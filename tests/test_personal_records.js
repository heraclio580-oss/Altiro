const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

function addPR(doc, exercise, value){
  doc.getElementById('prExerciseInput').value = exercise;
  doc.getElementById('prValueInput').value = String(value);
  doc.getElementById('addPrBtn').click();
}

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('progress');
  await wait(20);
  console.log('Progress view shows the Personal Records section:', !!doc.getElementById('prList') ? 'OK' : 'FAIL');
  console.log('Starts with "no PRs" message:', doc.getElementById('prList').textContent.includes('No PRs logged yet') ? 'OK' : 'FAIL');

  addPR(doc, 'Bench Press', 135);
  await wait(20);
  console.log('New PR appears in the list:', doc.getElementById('prList').textContent.includes('Bench Press') && doc.getElementById('prList').textContent.includes('135') ? 'OK' : 'FAIL');
  console.log('Form clears after adding:', doc.getElementById('prExerciseInput').value==='' && doc.getElementById('prValueInput').value==='' ? 'OK' : 'FAIL');
  console.log('Single entry is marked as the current best (PR badge):', doc.getElementById('prList').textContent.includes('PR') ? 'OK' : 'FAIL');

  // Adding a submission that doesn't beat it should still be recorded (full history, not overwritten).
  addPR(doc, 'Bench Press', 125);
  await wait(20);
  const listText = doc.getElementById('prList').textContent;
  console.log('Both Bench Press entries are kept (full history, not overwritten):', (listText.match(/135/g)||[]).length>=1 && (listText.match(/125/g)||[]).length>=1 ? 'OK' : `FAIL (${listText})`);

  addPR(doc, 'Squat', 225);
  await wait(20);
  console.log('A different exercise is tracked separately:', doc.getElementById('prList').textContent.includes('Squat') && doc.getElementById('prList').textContent.includes('225') ? 'OK' : 'FAIL');

  // Validation: blank exercise or non-numeric value should be rejected, not silently accepted.
  const beforeCount = doc.querySelectorAll('#prList .manual-entry').length;
  doc.getElementById('prExerciseInput').value = '';
  doc.getElementById('prValueInput').value = '999';
  doc.getElementById('addPrBtn').click();
  await wait(20);
  console.log('Blank exercise name is rejected (no new entry added):', doc.querySelectorAll('#prList .manual-entry').length===beforeCount ? 'OK' : 'FAIL');

  // A PR entered for an exercise with no existing progression data yet should seed a starting
  // target for it -- verified against today's actual session title so it feeds a real Record flow.
  goPill('home');
  await wait(20);
  const todayTitle = doc.getElementById('sessionCard').querySelector('.title').textContent.split(',')[0].trim();
  goPill('progress');
  await wait(20);
  addPR(doc, todayTitle, 150);
  await wait(20);
  goPill('home');
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  if(!doc.getElementById('logPerfWeightSection').hidden){
    console.log('PR for today\'s exact session title seeded its progression target (150 lb pre-filled):', doc.getElementById('logPerfWeightInput').value==='150' ? 'OK' : `FAIL (${doc.getElementById('logPerfWeightInput').value})`);
    doc.getElementById('closeLogPerf').click();
  } else {
    console.log('(Today is not a strength session in this run -- skipping the PR-seeds-progression check)');
  }
  await wait(10);

  // Delete a PR entry.
  goPill('progress');
  await wait(20);
  const squatDelBtn = [...doc.querySelectorAll('#prList .manual-entry')].find(el=>el.textContent.includes('Squat'))?.querySelector('[data-pr-del]');
  console.log('Delete button exists on a PR entry:', !!squatDelBtn ? 'OK' : 'FAIL');
  squatDelBtn.click();
  await wait(20);
  console.log('Squat entry removed after delete:', !doc.getElementById('prList').textContent.includes('Squat') ? 'OK' : 'FAIL');
  console.log('Bench Press entries untouched by deleting Squat:', doc.getElementById('prList').textContent.includes('Bench Press') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
