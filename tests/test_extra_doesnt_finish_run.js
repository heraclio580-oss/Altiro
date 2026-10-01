const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Something else done today -- 50 push-ups at work, added as a workout and completed -- doesn't finish
// today's planned run or count its miles; the run is still there to do. A run logged on a run day, on
// the other hand, IS that day's run.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

async function runDay(){
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  const w = dom.window, doc = w.document;
  await wait(50);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  // An all-running plan, so today (a training day) is a run.
  go('adjust');
  for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
  doc.getElementById('applyAdjust').click();
  await wait(10);
  go('home'); await wait(20);
  return {w, doc, go};
}
const title = doc => doc.querySelector('#sessionCard .title').textContent;
const distance = doc => doc.getElementById('ovDistanceVal').textContent;

(async () => {
  // ---- push-ups added as a workout and completed ----
  {
    const {w, doc, go} = await runDay();
    const run = title(doc);
    check('(set-up) today is a planned run', /Run|Jog/.test(run), run);
    const before = distance(doc);
    doc.getElementById('addTodayWorkoutBtn').click(); await wait(20);
    doc.getElementById('manualNameInput').value = '50 Push-Ups';
    doc.getElementById('manualNameInput').dispatchEvent(new w.Event('input', {bubbles:true}));
    [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='strength').click();
    doc.getElementById('saveManualEntry').click(); await wait(20);
    doc.querySelector('#homeExtraWorkoutsWrap [data-start-extra]').click(); await wait(20);
    doc.getElementById('saveLogPerf').click(); await wait(30);
    if(!doc.getElementById('reviewOverlay')?.hidden) doc.getElementById('submitReviewBtn')?.click();
    go('home'); await wait(20);
    check('Push-ups added and completed: they show as done', !doc.querySelector('#homeExtraWorkoutsWrap [data-start-extra]'));
    check('...today\'s run is still the day\'s workout', title(doc)===run, title(doc));
    check('...and still to do: its Start button is there, not done', !doc.getElementById('recordBtn').classList.contains('done') && !doc.getElementById('recordBtn').classList.contains('disabled'));
    check('...and its miles aren\'t counted', distance(doc)===before, `${before} -> ${distance(doc)}`);
    go('calendar'); await wait(20);
    const cell = doc.querySelector('#calGrid .mo-cell.today');
    check('...the calendar doesn\'t show today done', cell && !cell.classList.contains('done'), cell && cell.className);
  }
  // ---- push-ups logged as already done ----
  {
    const {w, doc} = await runDay();
    const run = title(doc), before = distance(doc);
    doc.getElementById('addTodayWorkoutBtn').click(); await wait(20);
    doc.getElementById('manualNameInput').value = '50 Push-Ups';
    doc.getElementById('manualNameInput').dispatchEvent(new w.Event('input', {bubbles:true}));
    [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='strength').click();
    if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
    doc.getElementById('saveManualEntry').click(); await wait(20);
    check('Push-ups logged as already done: they\'re listed', doc.getElementById('homeEntriesWrap').textContent.includes('50 Push-Ups'));
    check('...without replacing today\'s run', title(doc)===run, title(doc));
    check('...or finishing it', !doc.getElementById('recordBtn').classList.contains('done') && !doc.getElementById('homeCompleteToggle').classList.contains('on'));
    check('...or counting its miles', distance(doc)===before, `${before} -> ${distance(doc)}`);
  }
  // ---- a run logged on a run day is that run ----
  {
    const {w, doc} = await runDay();
    doc.getElementById('addTodayWorkoutBtn').click(); await wait(20);
    doc.getElementById('manualNameInput').value = 'Lunch Run';
    doc.getElementById('manualNameInput').dispatchEvent(new w.Event('input', {bubbles:true}));
    [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
    if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
    doc.getElementById('saveManualEntry').click(); await wait(20);
    check('A run logged as done on a run day becomes the day\'s run, done', title(doc)==='Lunch Run' && doc.getElementById('recordBtn').classList.contains('done'), title(doc));
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
