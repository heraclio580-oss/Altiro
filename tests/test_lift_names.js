const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A lift of the user's own logged under slightly different spellings -- "Wrist wrench Left" twice, then
// "Wrist wrench left" typed fresh in a new workout -- is one lift: one row in Progress with all three
// days, its bests across them, and last time's numbers whichever spelling was used. Typed again with
// other capitals, it keeps the spelling it's been logged with most. Half pounds show as they were lifted.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const wrench = (key, sets)=> ({key, name:key, weight:sets[sets.length-1][0], reps:sets[sets.length-1][1], sets:sets.map(([weight, reps])=>({weight, reps}))});
const extraRows = [
  {id:1, user_id:'u1', log_date:'2026-09-02', session_type:'strength', title:'Cupping', detail:'', completed:true,
   exercises:[{key:'Wrist wrench Left', name:'Wrist wrench Left', sets:6, reps:10}],
   performance:{exercises:[wrench('Wrist wrench Left', [[40.5,10],[50.5,10],[60,10],[65.5,5],[70.5,5],[80.5,1]])]}},
  {id:2, user_id:'u1', log_date:'2026-09-11', session_type:'strength', title:'Cupping wrist wrench', detail:'', completed:true,
   exercises:[{key:'Wrist wrench Left', name:'Wrist wrench Left', sets:6, reps:10}],
   performance:{exercises:[wrench('Wrist wrench Left', [[40.5,20],[45.5,15],[50.5,10],[90,1],[99.5,1]])]}},
  {id:3, user_id:'u1', log_date:'2026-09-16', session_type:'strength', title:'Arm workout', detail:'', completed:true,
   exercises:[{key:'Wrist wrench left', name:'Wrist wrench left', sets:4, reps:10}],
   performance:{exercises:[wrench('Wrist wrench left', [[40.5,20],[45.5,20],[83,1],[99,1]])]}},
];
const logRows = [{id:'l1', user_id:'u1', log_date:'2026-09-18', completed_override:null, planned_type:'strength', planned_title:'Upper', planned_detail:'45 min',
  planned_exercises:[{key:'Seated Row', name:'Seated Row', sets:3, reps:10}], manual_entries:[]}];
function makeBackend(hidden){
  function from(table){
    let op = 'select';
    const filters = {};
    const api = {
      select(){ return api; }, eq(c, v){ filters[c] = v; return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; }, in(){ return api; }, limit(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ op = 'delete'; return api; }, update(){ op = 'update'; return api; }, upsert(){ op = 'upsert'; return api; }, single(){ return api.maybeSingle(); },
      maybeSingle(){
        if(table==='workout_logs') return Promise.resolve({data: logRows.find(r=>r.log_date===filters.log_date) || null, error:null});
        return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:4, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-08-31', hidden_lifts: hidden || null} : null, error:null});
      },
      then(res, rej){
        const data = op!=='select' ? null : table==='workout_logs' ? logRows : table==='planned_workouts' ? extraRows : [];
        return Promise.resolve({data, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}
async function openApp(opts){
  opts = opts || {};
  const backend = makeBackend(opts.hidden);
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){
      w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      if(opts.hiddenLocal) w.localStorage.setItem('altiro_hidden_lifts', JSON.stringify(opts.hiddenLocal));
    } });
  await wait(300);
  const w = dom.window, doc = w.document;
  for(const id of ['badgeOverlay', 'locPromptOverlay']) doc.getElementById(id).hidden = true;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  return {w, doc, go};
}
const wrenchRows = doc => [...doc.querySelectorAll('#liftProgress .lift-row:not(.hidden-lift)')].filter(r=> /wrist wrench left/i.test(r.textContent));

(async () => {
  let {w, doc, go} = await openApp();
  go('progress');
  await wait(30);
  let rows = wrenchRows(doc);
  check('Progress: one Wrist wrench left, not two', rows.length===1, rows.map(r=> r.querySelector('.lr-name').textContent).join(' | '));
  check('...named as it was last logged', rows[0] && rows[0].querySelector('.lr-name').textContent==='Wrist wrench left', rows[0] && rows[0].querySelector('.lr-name').textContent);
  rows[0].click();
  await wait(20);
  const body = doc.getElementById('liftDetailBody');
  const days = [...body.querySelectorAll('.lift-hist .dt')].map(e=> e.textContent);
  check('Its history has all three days', days.length===3 && days.some(d=> /Sep 2/.test(d)) && days.some(d=> /Sep 11/.test(d)) && days.some(d=> /Sep 16/.test(d)), days.join(' | '));
  check('Half pounds show as lifted: 40.5×20, not 41×20', /40\.5×20/.test(body.textContent) && !/\b41×20/.test(body.textContent), [...body.querySelectorAll('.lift-hist .st')].map(e=> e.textContent).join(' / '));
  const tiles = [...body.querySelectorAll('.act-tile')].map(t=> t.textContent.replace(/\s+/g, ' ').trim());
  check('Heaviest across all three days: 99.5 lb (Sep 11, spelled "Left")', tiles.some(t=> /Heaviest/i.test(t) && /99\.5 lb/.test(t) && /Sep 11/.test(t)), tiles.join(' | '));
  check('Whole numbers stay whole', /83×1/.test(body.textContent) && !/83\.0/.test(body.textContent));
  doc.getElementById('closeLiftDetail').click();

  // Hiding it hides it whatever the spelling; bringing it back brings it all back.
  rows[0].querySelector('[data-lift-hide]').click();
  await wait(20);
  check('Hidden: gone from the list', wrenchRows(doc).length===0);
  doc.getElementById('liftsHiddenBtn').click();
  await wait(10);
  doc.querySelector('#liftProgress .lift-row.hidden-lift [data-lift-restore]').click();
  await wait(20);
  check('...and back as one lift', wrenchRows(doc).length===1);
  w.close();

  // Hidden earlier under the old spelling: still hidden.
  ({w, doc, go} = await openApp({hidden: ['Wrist wrench Left'], hiddenLocal: ['Wrist wrench Left']}));
  go('progress');
  await wait(30);
  check('Hidden earlier as "Wrist wrench Left": still hidden', wrenchRows(doc).length===0);
  w.close();

  // Typed again with other capitals, while doing a workout.
  ({w, doc, go} = await openApp());
  go('home');
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(950);
  const input = doc.getElementById('logPerfAddExerciseInput');
  input.focus();
  input.value = 'wrist wrench left';
  input.dispatchEvent(new w.Event('input', {bubbles:true}));
  await wait(10);
  const sugg = [...doc.querySelectorAll('#logPerfAddSuggest button')].map(b=> b.textContent);
  check('Typed with other capitals: the spelling used before is suggested', sugg.includes('Wrist wrench Left'), sugg.join(' | '));
  doc.getElementById('logPerfAddExerciseBtn').click();
  await wait(30);
  const keys = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].map(r=> r.getAttribute('data-exercise-key'));
  check('Added: it keeps the spelling logged most ("Wrist wrench Left", twice)', keys.includes('Wrist wrench Left') && !keys.includes('wrist wrench left'), keys.join(' | '));
  const row = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].find(r=> r.getAttribute('data-exercise-key')==='Wrist wrench Left');
  const sets = row ? [...row.querySelectorAll('.set-log-row')].map(s=> s.querySelector('[data-field="weight"]').value+'x'+s.querySelector('[data-field="reps"]').value) : [];
  check('...and starts from last time, Sep 16 (spelled "left")', sets.join(' ')==='40.5x20 45.5x20 83x1 99x1', sets.join(' '));
  doc.getElementById('closeLogPerf').click();
  await wait(20);

  // Building a workout of their own with it.
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  const item = doc.querySelector('#createExercisesList .exercise-edit-item');
  doc.getElementById('manualNameInput').value = 'Grip';
  item.querySelector('.ex-name').value = 'WRIST  WRENCH LEFT';
  item.querySelector('.ex-sets').value = 3; item.querySelector('.ex-reps').value = 10;
  doc.getElementById('saveManualEntry').click();
  await wait(30);
  const grip = [...doc.querySelectorAll('#homeExtraWorkoutsWrap [data-start-extra]')].pop();
  grip.click();
  await wait(950);
  const gripKeys = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].map(r=> r.getAttribute('data-exercise-key'));
  check('A new workout with it typed in capitals keeps the spelling used before', gripKeys.join()==='Wrist wrench Left', gripKeys.join(' | '));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
