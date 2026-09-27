const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-27'; } }); // Sunday
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Home's "This Week" Distance card measures miles run against the miles actually PLANNED this week --
// each run's own mileage as the user wrote it in its name -- instead of a fixed 15 mi goal. Mirrors
// the reported week: Tue "Progression run 4.5 miles" (ran 4.02), Wed "Easy 3.75miles" (ran 4.2),
// Thu "6.5 mile easy run" (ran 5.25), and today's still-planned "16mile progressive long run"
// -> 13.5 of 30.75 planned miles.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const input = (id, v) => { const el = doc.getElementById(id); el.value = v; el.dispatchEvent(new window.Event('input', {bubbles:true})); };

  async function logRun(dateKey, name, miles, minutes){
    goPill('calendar');
    await wait(20);
    doc.querySelector(`.mo-cell[data-date="${dateKey}"]`).click();
    await wait(20);
    doc.getElementById('addWorkoutBtn').click();
    await wait(20);
    [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
    if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
    input('manualNameInput', name);
    input('manualDistanceInput', String(miles));
    input('manualDurationMInput', String(minutes));
    doc.getElementById('saveManualEntry').click();
    await wait(20);
    doc.getElementById('closeDayDetail').click();
    await wait(10);
  }
  await logRun('2026-09-22', 'Progression run 4.5 miles', 4.02, 41);
  await logRun('2026-09-23', 'Easy 3.75miles', 4.2, 46);
  await logRun('2026-09-24', '6.5 mile easy run', 5.25, 62);

  // Today's long run: planned, not done yet.
  goPill('home');
  await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
  if(doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  input('manualNameInput', '16mile progressive long run');
  input('manualVolumeInput', '3+hours');
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  goPill('home');
  await wait(20);
  const val = doc.getElementById('ovDistanceVal').textContent;
  console.log('Distance card reads miles run / miles planned (13.5/30.75 mi):', val==='13.5/30.75 mi' ? 'OK' : `FAIL (${val})`);
  const bar = doc.getElementById('ovDistanceBar').style.width;
  console.log('Progress bar reflects 13.47 of 30.75 (44%):', bar==='44%' ? 'OK' : `FAIL (${bar})`);

  // A second, separate run logged the same day counts once in each total, not zero times.
  await logRun('2026-09-24', 'Shakeout 2 mi', 2, 18);
  goPill('home');
  await wait(20);
  const val2 = doc.getElementById('ovDistanceVal').textContent;
  console.log('A second run on the same day adds to both totals (15.5/32.75 mi):', val2==='15.5/32.75 mi' ? 'OK' : `FAIL (${val2})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
