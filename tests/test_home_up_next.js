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
  doc.getElementById('recordBtn').click();
  await wait(500);
  check('Start opens the run\'s log', !doc.getElementById('logPerfOverlay').hidden && !doc.getElementById('logPerfDistanceSection').hidden, doc.getElementById('logPerfOverlay').hidden);
  doc.getElementById('logPerfDistanceInput').value = '3.1';
  doc.getElementById('saveLogPerf').click();
  await wait(60);
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  check('With both done, Home shows the day as done', doc.getElementById('recordBtn').classList.contains('done') && /Evening Run/.test(flat(doc.getElementById('homeExtraWorkoutsWrap'))), flat(doc.getElementById('thEyebrow')));
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
