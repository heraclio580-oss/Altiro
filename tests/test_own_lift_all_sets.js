const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A lift of the user's own keeps every set from last time as its numbers -- not just the heaviest. An
// armwrestler's Wrist wrench Left: 13 sets, 40.5 x 20 up to 99.5 x 1 and back down to 50.5 x 10. After
// the exercise was renamed, the next workout started all 13 sets at the heaviest (99.5 x 1), and the
// workout's card said "13 x 1 · 99.5 lb". Now all 13 come back as done, and the card shows the range.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const W = [40.5,45.5,50.5,57.5,62.5,67.5,76,83,90,99.5,50.5,50.5,50.5], R = [20,15,10,10,5,5,1,1,1,1,10,10,10];
const SETS = W.map((w, i)=> ({weight: w, reps: R[i]}));
const KEY = 'strength:Armwrestling › Wrist wrench Left';

// noSetsColumn: the database before `sets` was added to progression_targets.
function makeBackend(opts){
  const targets = {}, upserts = [];
  if(opts.target) targets[KEY] = {session_key: KEY, ...opts.target};
  const own = [{key:'Wrist wrench Left', name:'Wrist wrench Left', sets:13, reps:10}];
  const logRows = [
    // Last Friday, logged before the exercise was renamed (it was "Wrist wrench" then).
    {id:'w1', user_id:'u1', log_date:'2026-09-11', completed_override:true, planned_type:'strength', planned_title:'Armwrestling', planned_detail:'60 min', planned_exercises:[{key:'Wrist wrench', name:'Wrist wrench', sets:13, reps:10}], manual_entries:[],
     performance:{exercises:[{key:'Wrist wrench', name:'Wrist wrench', weight:99.5, reps:1, sets:SETS, own:true}]}},
    {id:'w2', user_id:'u1', log_date:'2026-09-18', completed_override:null, planned_type:'strength', planned_title:'Armwrestling', planned_detail:'60 min', planned_exercises:own, manual_entries:[]},
  ];
  function from(table){
    let op = 'select', payload = null;
    const filters = {};
    const api = {
      select(){ return api; }, eq(c, v){ filters[c] = v; return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ return api; },
      update(p){ op = 'update'; payload = p; return api; }, upsert(p){ op = 'upsert'; payload = p; return api; },
      maybeSingle(){
        if(table==='workout_logs') return Promise.resolve({data: logRows.find(r=>r.log_date===filters.log_date) || null, error:null});
        return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:4, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-09-07'} : null, error:null});
      },
      then(res, rej){
        let error = null;
        if(op==='upsert' && table==='progression_targets'){
          if(opts.noSetsColumn && 'sets' in payload) error = {code:'PGRST204', message:"Could not find the 'sets' column of 'progression_targets' in the schema cache"};
          else { targets[payload.session_key] = payload; upserts.push(payload); }
        }
        const data = op==='select' ? (table==='workout_logs' ? logRows : table==='progression_targets' ? Object.values(targets) : []) : null;
        return Promise.resolve({data, error}).then(res, rej);
      },
    };
    return api;
  }
  return { targets, upserts, createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}
async function open(opts){
  const backend = makeBackend(opts);
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(250);
  const doc = dom.window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  return {doc, backend, dom};
}
const cardLine = doc => { const li = [...doc.querySelectorAll('#sessionCard .r-exercise-list li')].find(l=> /Wrist wrench Left/.test(l.textContent)); return li ? li.textContent.replace(/\s+/g,' ').trim() : ''; };
const setsShown = doc => [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row[data-exercise-key="Wrist wrench Left"] .set-log-row')].map(r=> r.querySelector('[data-field="weight"]').value+'x'+r.querySelector('[data-field="reps"]').value);
const want = SETS.map(s=> s.weight+'x'+s.reps).join(' ');

(async () => {
  {
    // Its numbers since the rename: every set from last time.
    const {doc} = await open({target: {weight:99.5, reps:1, sets:SETS}});
    check('The card shows how many sets and the range, not just the heaviest', /13 sets · 40\.5–99\.5 lb/.test(cardLine(doc)), cardLine(doc));
    doc.getElementById('recordBtn').click();
    await wait(950);
    check('Renamed since last time: all 13 sets come back as they were done', setsShown(doc).join(' ')===want, setsShown(doc).join(' '));
  }
  {
    // Done today (the same 13, the last one heavier): every set is saved as its numbers.
    const {doc, backend, dom} = await open({target: {weight:99.5, reps:1, sets:SETS}});
    doc.getElementById('recordBtn').click();
    await wait(950);
    const rows = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row[data-exercise-key="Wrist wrench Left"] .set-log-row')];
    rows[12].querySelector('[data-field="weight"]').value = '55';
    doc.getElementById('saveLogPerf').click();
    await wait(40);
    const saved = backend.upserts.filter(u=> u.session_key===KEY).pop();
    check('Saved: every set, as done', saved && Array.isArray(saved.sets) && saved.sets.map(s=> s.weight+'x'+s.reps).join(' ')===want.replace(/50\.5x10$/, '55x10'), saved && JSON.stringify(saved.sets));
    check('...and still the heaviest as its weight (Progress, records)', saved && saved.weight===99.5 && saved.reps===1, saved && saved.weight+'x'+saved.reps);
  }
  {
    // The database without the new column yet: the numbers are still saved (without the sets).
    const {doc, backend} = await open({noSetsColumn: true});
    doc.getElementById('recordBtn').click();
    await wait(950);
    doc.getElementById('saveLogPerf').click();
    await wait(40);
    const saved = backend.upserts.filter(u=> u.session_key===KEY).pop();
    check('Without the sets column: the rest is still saved', saved && saved.weight>0 && !('sets' in saved), saved && JSON.stringify(saved));
  }
  {
    // Numbers set by hand (the workout's lift numbers) are for every set.
    const {doc, backend} = await open({target: {weight:99.5, reps:1, sets:SETS}});
    const li = [...doc.querySelectorAll('#sessionCard .r-exercise-list li[data-lift-key]')].find(l=> /Wrist wrench Left/.test(l.textContent));
    if(li){
      li.click();
      await wait(30);
      const tuner = doc.querySelector('[data-tuner]');
      tuner.querySelector('[data-lift-field="weight"]').value = '60';
      tuner.querySelector('[data-lift-field="reps"]').value = '8';
      doc.querySelector('[data-tune-save]').click();
      await wait(30);
      const saved = backend.upserts.filter(u=> u.session_key===KEY).pop();
      check('Numbers typed in by hand replace last time\'s sets', saved && saved.weight===60 && saved.reps===8 && saved.sets==null, saved && JSON.stringify(saved));
    } else check('The card\'s lift can be tapped to set its numbers', false, cardLine(doc));
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
