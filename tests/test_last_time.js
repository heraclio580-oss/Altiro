const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Someone following their own program: their lifts start each week from what they actually did last
// time -- every set's weight and reps -- and their numbers become what they just did, never a guess and
// never an automatic jump.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

function makeBackend(){
  const targets = {}, perfUpdates = [];
  const upperA = [{key:'Incline Hammer Press', name:'Incline Hammer Press', sets:3, reps:10}, {key:'Cable Lateral Raise', name:'Cable Lateral Raise', sets:3, reps:12}];
  const logRows = [
    // Last Friday: Upper A, logged -- four sets on the press.
    {id:'w1', user_id:'u1', log_date:'2026-09-11', completed_override:true, planned_type:'strength', planned_title:'Upper A', planned_detail:'60 min', planned_exercises:upperA, manual_entries:[],
     performance:{exercises:[{key:'Incline Hammer Press', name:'Incline Hammer Press', weight:155, reps:8, sets:[{weight:135,reps:10},{weight:145,reps:9},{weight:155,reps:8},{weight:155,reps:7}]}]}},
    // Today (Friday): the same workout, repeated.
    {id:'w2', user_id:'u1', log_date:'2026-09-18', completed_override:null, planned_type:'strength', planned_title:'Upper A', planned_detail:'60 min', planned_exercises:upperA, manual_entries:[]},
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
        if(op==='upsert' && table==='progression_targets') targets[payload.session_key] = payload;
        if(op==='update' && table==='workout_logs' && payload.performance) perfUpdates.push(payload.performance);
        const data = op==='select' ? (table==='workout_logs' ? logRows : table==='progression_targets' ? Object.values(targets) : []) : null;
        return Promise.resolve({data, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { targets, perfUpdates, createClient: () => ({
    auth: {
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; },
      async signOut(){ return {error:null}; },
    },
    from,
  })};
}

(async () => {
  const backend = makeBackend();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(250);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('home');
  await wait(20);
  console.log("Today is the user's own Upper A:", /Upper A/.test(doc.getElementById('sessionCard').textContent) ? 'OK' : `FAIL (${doc.getElementById('sessionCard').textContent.slice(0,80)})`);
  doc.getElementById('recordBtn').click();
  await wait(950);
  const exRow = key => doc.querySelector(`#logPerfExercisesList .exercise-log-row[data-exercise-key="${key}"]`);
  const sets = key => [...exRow(key).querySelectorAll('.set-log-row')].map(r=>r.querySelector('[data-field="weight"]').value+'x'+r.querySelector('[data-field="reps"]').value);
  console.log('The press starts from last Friday, set by set (all 4 sets):', sets('Incline Hammer Press').join(' ')==='135x10 145x9 155x8 155x7' ? 'OK' : `FAIL (${sets('Incline Hammer Press').join(' ')})`);
  console.log('...a lift not logged before starts from its planned sets and reps:', sets('Cable Lateral Raise').length===3 && sets('Cable Lateral Raise').every(s=>/x12$/.test(s)) ? 'OK' : `FAIL (${sets('Cable Lateral Raise').join(' ')})`);

  // Today they go up on the last set.
  const last = [...exRow('Incline Hammer Press').querySelectorAll('.set-log-row')][3];
  last.querySelector('[data-field="weight"]').value = '160';
  last.querySelector('[data-field="reps"]').value = '6';
  const lat = [...exRow('Cable Lateral Raise').querySelectorAll('.set-log-row')];
  lat.forEach(r=>{ r.querySelector('[data-field="weight"]').value = '25'; });
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  doc.getElementById('reviewRatingSlider').value = '5';
  doc.getElementById('reviewRatingSlider').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('submitReviewBtn').click();
  await wait(30);
  const press = backend.targets['strength:Incline Hammer Press'];
  console.log('The press\'s numbers become exactly what was done (160 x 6), no automatic +5:', press && press.weight===160 && press.reps===6 ? 'OK' : `FAIL (${JSON.stringify(press)})`);
  const raise = backend.targets['strength:Cable Lateral Raise'];
  console.log('...same for the lateral raise (25 x 12):', raise && raise.weight===25 && raise.reps===12 ? 'OK' : `FAIL (${JSON.stringify(raise)})`);
  const savedPerf = backend.perfUpdates[backend.perfUpdates.length-1];
  const savedPress = savedPerf && savedPerf.exercises.find(e=>e.key==='Incline Hammer Press');
  console.log('Every set is saved, for next time:', savedPress && savedPress.sets.map(s=>s.weight+'x'+s.reps).join(' ')==='135x10 145x9 155x8 160x6' ? 'OK' : `FAIL (${savedPress && JSON.stringify(savedPress.sets)})`);
  go('home');
  await wait(20);
  const line = [...doc.querySelectorAll('#sessionCard .r-exercise-list li')].find(li=>/Incline Hammer Press/.test(li.textContent));
  console.log('The workout shows the new numbers:', line && /x 6 · 160 lb/.test(line.textContent) ? `OK (${line.textContent.replace(/\s+/g,' ').trim()})` : `FAIL (${line && line.textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
