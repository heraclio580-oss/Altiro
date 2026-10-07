const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Today's workout done, a run still planned for later: the run takes Home's main card -- its name,
// description and Start button -- with the finished one marked done above it.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const flat = el => el ? el.textContent.replace(/\s+/g,' ').trim() : '';

(async () => {
  await wait(50);
  const doc = window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  const own = flat(doc.querySelector('#sessionCard .title'));
  // A run for later today, added alongside today's workout.
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
  doc.getElementById('manualNameInput').value = 'Evening Run';
  doc.getElementById('manualVolumeInput').value = '3 mi easy';
  doc.getElementById('saveManualEntry').click();
  await wait(30);
  check('(set-up) the run is planned, today\'s own workout still on top', flat(doc.querySelector('#sessionCard .title')).startsWith(own.split(',')[0]) && /Evening Run/.test(flat(doc.getElementById('homeExtraWorkoutsWrap'))));
  // Today's own workout: done.
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  check('Once it\'s done, the run takes the main card', /^Evening Run, 3 mi easy/.test(flat(doc.querySelector('#sessionCard .title'))), flat(doc.querySelector('#sessionCard .title')));
  check('...with the finished one marked done above it', flat(doc.querySelector('#sessionCard .home-done-line'))===`${own.split(',')[0]} done`, flat(doc.querySelector('#sessionCard .home-done-line')));
  check('...the top card says what\'s up next, ready to start', flat(doc.getElementById('thEyebrow'))==='Up next today' && flat(doc.getElementById('thTitle'))==='Time to run.' && !doc.getElementById('recordBtn').classList.contains('done'), flat(doc.getElementById('thEyebrow'))+' / '+flat(doc.getElementById('thTitle')));
  check('...and it isn\'t listed twice', !doc.getElementById('homeExtraWorkoutsWrap') || !/Evening Run/.test(flat(doc.getElementById('homeExtraWorkoutsWrap'))));
  // Its day details: the run is the day's workout; the finished one is down under the others.
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  check('Day details show the run as the day\'s workout, with Start', /Evening Run/.test(flat(doc.getElementById('dayDetailPlanRow'))) && !!doc.getElementById('ddStartWorkoutBtn'), flat(doc.getElementById('dayDetailPlanRow')).slice(0,80));
  const doneOwn = doc.querySelector('#dayDetailExtraWorkouts [data-done-own]');
  check('...and the finished workout listed as done at the bottom', doneOwn && flat(doneOwn).startsWith(own.split(',')[0]) && /Completed/.test(flat(doneOwn)) && !/Evening Run/.test(flat(doc.getElementById('dayDetailExtraWorkouts'))), flat(doc.getElementById('dayDetailExtraWorkouts')).slice(0,120));
  doc.getElementById('closeDayDetail').click();
  await wait(10);
  doc.getElementById('recordBtn').click();
  await wait(500);
  check('Start opens the run\'s log', !doc.getElementById('logPerfOverlay').hidden && !doc.getElementById('logPerfDistanceSection').hidden, doc.getElementById('logPerfOverlay').hidden);
  doc.getElementById('logPerfDistanceInput').value = '3.1';
  doc.getElementById('saveLogPerf').click();
  await wait(60);
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  check('With both done, Home shows the day as done', doc.getElementById('recordBtn').classList.contains('done') && /Evening Run/.test(flat(doc.getElementById('homeExtraWorkoutsWrap'))), flat(doc.getElementById('thEyebrow')));
  // ---- A rest day with two added workouts: the one still to do is the day's workout ----
  {
    const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-19'; } });
    await wait(60);
    const d2 = dom2.window.document;
    [...d2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(20);
    const addOne = async (type, name) => {
      d2.getElementById('addTodayWorkoutBtn').click(); await wait(20);
      [...d2.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type===type).click();
      d2.getElementById('manualNameInput').value = name; d2.getElementById('saveManualEntry').click(); await wait(30);
    };
    await addOne('strength', 'Cupping');
    await addOne('run', 'Ea');
    d2.getElementById('recordBtn').click(); await wait(500);   // records today's first one: Cupping
    d2.getElementById('saveLogPerf').click(); await wait(60);
    [...d2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(20);
    d2.querySelector('#weekStrip .day-cell.today').click(); await wait(20);
    check('Rest day: the run still to do is the day\'s workout in its details', /^SAT 19.*Ea/.test(flat(d2.getElementById('dayDetailPlanRow'))) && !!d2.getElementById('ddStartWorkoutBtn'), flat(d2.getElementById('dayDetailPlanRow')));
    const list = flat(d2.getElementById('dayDetailExtraWorkouts'));
    check('...the finished one is listed below, once, not the run again', /Cupping/.test(list) && !/Ea\b/.test(list) && (flat(d2.getElementById('dayDetailOverlay')).match(/Cupping/g)||[]).length===1, list);
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
