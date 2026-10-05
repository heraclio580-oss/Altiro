const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// "Log as you go": from Today's + Add Workout, a switch starts a workout straight away -- Log
// Performance opens with the clock running and no exercises, and each one (name, then each set's
// weight and reps) is added while it's being done. What's typed is kept as it's typed (closing
// mid-workout loses nothing), and finishing saves it like any recorded workout.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

async function open(today){
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = today; } });
  await wait(50);
  const w = dom.window, doc = w.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('home'); await wait(20);
  return {w, doc, go};
}
const text = el => (el ? el.textContent : '').replace(/\s+/g,' ').trim();

(async () => {
  // Saturday Sep 19: a rest day on the default Mon/Wed/Fri plan.
  const {w, doc, go} = await open('2026-09-19');
  const click = async el => { (typeof el==='string' ? doc.querySelector(el) : el).click(); await wait(20); };
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', {bubbles:true})); };
  check('(set-up) today is a rest day', /Rest Day/.test(text(doc.querySelector('#sessionCard .title'))));
  await click('#addTodayWorkoutBtn');
  const toggle = doc.getElementById('createLiveToggle');
  check('Adding a workout today offers "Log as you go"', !doc.getElementById('createLiveSection').hidden && /Log as you go/.test(text(doc.getElementById('createLiveSection'))) && !toggle.classList.contains('on'));
  await click(toggle);
  check('On: just a name -- the rest of the form steps aside', doc.getElementById('manualTypeSection').hidden && doc.getElementById('createExercisesSection').hidden && doc.getElementById('createCompletedSection').hidden && doc.getElementById('saveManualEntry').textContent==='Start workout');
  await click('#saveManualEntry');
  const sheet = doc.getElementById('logPerfOverlay');
  check('Start workout (no name needed) opens Log Performance straight away', !sheet.hidden && doc.getElementById('manualEntryOverlay').hidden);
  check('...with the clock running', !doc.getElementById('logPerfTimeSection').hidden && !doc.getElementById('logPerfTimeNote').hidden);
  check('...no exercises yet, and a box to add one', doc.querySelectorAll('#logPerfExercisesList .exercise-log-row').length===0 && !doc.getElementById('logPerfAddExercise').hidden && !doc.getElementById('logPerfLiveEmpty').hidden);
  check('...instead of the single weight/reps fields', doc.getElementById('logPerfWeightSection').hidden);
  check('...suggesting exercise names', doc.querySelectorAll('#logPerfExerciseNames option').length>50);

  const add = async name => { type(doc.getElementById('logPerfAddExerciseInput'), name); await click('#logPerfAddExerciseBtn'); };
  const row = key => [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].find(r=>r.getAttribute('data-exercise-key')===key);
  const sets = key => [...row(key).querySelectorAll('.set-log-row')].map(r=>[r.querySelector('[data-field="weight"]').value, r.querySelector('[data-field="reps"]').value]);
  await add('bench press');
  check('Typing a lift adds it, under its own name, with one set', !!row('Bench Press') && /Bench Press/.test(text(row('Bench Press'))) && sets('Bench Press').length===1);
  const [wIn, rIn] = row('Bench Press').querySelectorAll('.set-log-row input');
  type(wIn, '135'); type(rIn, '8');
  row('Bench Press').querySelector('.set-check-dot').click(); await wait(20);
  row('Bench Press').querySelector('[data-step="1"]').click(); await wait(20);
  check('+ adds the next set, starting from the last one', JSON.stringify(sets('Bench Press'))===JSON.stringify([['135','8'],['135','8']]), JSON.stringify(sets('Bench Press')));
  await add('Cable Crossover Machine');
  check('Any name works, even one the app doesn\'t know', !!row('Cable Crossover Machine'));
  check('...and adding it keeps everything typed so far', JSON.stringify(sets('Bench Press'))===JSON.stringify([['135','8'],['135','8']]) && row('Bench Press').querySelector('.set-check-dot').classList.contains('checked'), JSON.stringify(sets('Bench Press')));
  const [cw, cr] = row('Cable Crossover Machine').querySelectorAll('.set-log-row input');
  type(cw, '40'); type(cr, '12'); await wait(20);
  check('What\'s typed is saved on the phone as it\'s typed', /"40"/.test(w.localStorage.getItem('altiro_log_draft')||''));

  // Closing mid-workout and coming back: everything is still there.
  await click('#closeLogPerf');
  check('Closed mid-workout: it\'s today\'s workout, still to do', /Workout/.test(text(doc.querySelector('#sessionCard .title'))) && !doc.getElementById('recordBtn').classList.contains('done'));
  await click('#recordBtn'); await wait(400);
  check('Back in: both exercises and every set as they were', !sheet.hidden && JSON.stringify(sets('Bench Press'))===JSON.stringify([['135','8'],['135','8']]) && JSON.stringify(sets('Cable Crossover Machine'))===JSON.stringify([['40','12']]));
  await add('Push-Up');
  row('Push-Up').querySelector('.live-remove').click(); await wait(20);
  check('An exercise added by mistake can be removed', !row('Push-Up') && !!row('Bench Press'));

  await click('#saveLogPerf');
  if(!doc.getElementById('reviewOverlay')?.hidden) doc.getElementById('submitReviewBtn')?.click();
  go('home'); await wait(30);
  check('Finishing saves it: today\'s workout, done', doc.getElementById('recordBtn').classList.contains('done'));
  check('...and the phone\'s copy is cleared', !w.localStorage.getItem('altiro_log_draft'));
  go('progress'); await wait(20);
  doc.querySelector('[data-act-day="2026-09-19"]')?.click(); await wait(10);
  const act = text(doc.querySelector('#progActivity .act-detail'));
  check('...counted on Progress: 3 sets, 28 reps', /3 sets · 28 reps/.test(act), act);
  go('home'); await wait(20);
  doc.querySelector('#weekStrip .day-cell.today').click(); await wait(20);
  doc.getElementById('dayDetailPlanRow').click(); await wait(20);
  check('...and reopening it shows what was done', !sheet.hidden && JSON.stringify(sets('Bench Press'))===JSON.stringify([['135','8'],['135','8']]) && doc.getElementById('logPerfAddExercise').hidden);
  await click('#closeLogPerf');

  // Not today: no switch (it's for doing a workout now).
  go('calendar'); await wait(20);
  doc.querySelector('.mo-cell[data-date="2026-09-22"]').click(); await wait(20);
  await click('#addWorkoutBtn');
  check('Adding to another day: no "Log as you go"', doc.getElementById('createLiveSection').hidden && doc.getElementById('saveManualEntry').textContent==='Save Workout');
  await click('#closeManualEntry');
  await click('#closeDayDetail');

  // A training day: it goes beside the plan's workout, not in place of it.
  {
    const {w: w2, doc: d2, go: go2} = await open('2026-09-18');
    const planned = text(d2.querySelector('#sessionCard .title'));
    d2.getElementById('addTodayWorkoutBtn').click(); await wait(20);
    d2.getElementById('createLiveToggle').click(); await wait(10);
    const n = d2.getElementById('manualNameInput'); n.value = 'Lunch pump'; n.dispatchEvent(new w2.Event('input', {bubbles:true}));
    d2.getElementById('saveManualEntry').click(); await wait(30);
    const inp = d2.getElementById('logPerfAddExerciseInput'); inp.value = 'Curl'; inp.dispatchEvent(new w2.Event('input', {bubbles:true}));
    inp.dispatchEvent(new w2.KeyboardEvent('keydown', {key:'Enter', bubbles:true})); await wait(20);
    check('On a training day: the started workout sits beside today\'s plan (Enter adds too)', d2.querySelectorAll('#logPerfExercisesList .exercise-log-row').length===1 && (() => { d2.getElementById('closeLogPerf').click(); return true; })());
    go2('home'); await wait(20);
    check('...today\'s planned workout is unchanged', text(d2.querySelector('#sessionCard .title'))===planned && /Lunch pump/.test(text(d2.getElementById('homeExtraWorkoutsWrap'))), planned);
  }
  // Spanish
  {
    const {doc: d3, go: go3} = await open('2026-09-19');
    go3('settings'); await wait(10);
    d3.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
    go3('home'); await wait(20);
    d3.getElementById('addTodayWorkoutBtn').click(); await wait(20);
    d3.getElementById('createLiveToggle').click(); await wait(10);
    check('In Spanish', /Registrar sobre la marcha/.test(text(d3.getElementById('createLiveSection'))) && d3.getElementById('saveManualEntry').textContent==='Empezar entrenamiento');
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
