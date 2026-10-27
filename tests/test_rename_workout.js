const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Renaming a workout: Edit on a done workout the user made (added, logged, or built as they went) has
// its name at the top -- change it, save, and the new name is what Today, the day, the Calendar and the
// Summary show (and what's saved). Left empty, the old name stays. The plan's own workouts keep their
// names: there's no box. Each exercise in it can be renamed too (a pencil by its name); and sets whose
// reps change read "13 sets" rather than "13 x 1". And on the Summary, a long list of sets wraps under the exercise's name instead
// of running off the side of the card.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
function makeBackend(opts){
  const db = {
    profiles: {u1: {id:'u1'}},
    workout_logs: {},
    manual_entries: {},
    strava_activities: {},
    planned_workouts: {},
  };
  const invokes = [];
  let connected = !!opts.connected;
  let nextId = 1;
  const newId = () => 'id' + (nextId++);
  const addLog = (log_date, fields) => { const id = newId(); db.workout_logs[id] = {id, user_id:'u1', log_date, completed_override:null, ...fields}; return id; };
  const addStrava = (id, local_date, name, distance_m, moving_time_s) => {
    db.strava_activities[id] = {id, user_id:'u1', name, local_date, start_date: local_date+'T12:00:00Z', distance_m, moving_time_s, applied_at:null};
  };
  function from(table){
    let filters = [], op = 'select', payload = null, wantRows = false, cols = '';
    const matches = row => filters.every(([c,v,kind]) => kind==='is' ? row[c]==null : kind==='notnull' ? row[c]!=null : kind==='gte' ? row[c]>=v : row[c]===v);
    async function run(single){
      const rows = db[table];
      if(!rows) return {data: [], error:null}; // planned_workouts, progression_targets, personal_records, ...
      // A database that doesn't have the climb column yet.
      if(op==='select' && table==='strava_activities' && opts.noClimbColumn && /elev_gain_m/.test(cols)) return {data:null, error:{code:'42703', message:'column strava_activities.elev_gain_m does not exist'}};
      if(op==='insert'){
        const id = newId(); rows[id] = {id, ...payload};
        return {data: rows[id], error:null};
      }
      if(op==='delete'){ Object.values(rows).filter(matches).forEach(r=> delete rows[r.id]); return {data:null, error:null}; }
      if(op==='update'){
        const hit = Object.values(rows).filter(matches);
        hit.forEach(r => Object.assign(r, payload));
        return {data: wantRows ? hit.map(r=>({id:r.id})) : null, error:null};
      }
      const hit = Object.values(rows).filter(matches);
      if(single) return {data: hit[0] || null, error:null};
      if(table==='workout_logs'){
        return {data: hit.map(r => ({...r, manual_entries: Object.values(db.manual_entries).filter(e=>e.workout_log_id===r.id)})), error:null};
      }
      return {data: hit, error:null};
    }
    const api = {
      select(c){ wantRows = true; cols = c || ''; return api; },
      eq(c,v){ filters.push([c,v,'eq']); return api; },
      is(c){ filters.push([c,null,'is']); return api; },
      not(c){ filters.push([c,null,'notnull']); return api; },
      gte(c,v){ filters.push([c,v,'gte']); return api; },
      order(){ return api; },
      insert(p){ op='insert'; payload=p; return api; },
      update(p){ op='update'; payload=p; wantRows=false; return api; },
      upsert(){ op='noop'; return api; }, delete(){ op='delete'; return api; },
      maybeSingle(){ return run(true); },
      then(res, rej){ return run(false).then(res, rej); },
    };
    return api;
  }
  function createClient(){
    const user = {id:'u1', email:'runner@example.com'};
    return {
      auth: {
        async getSession(){ return {data:{session:{user}}}; },
        onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
        async signOut(){ return {error:null}; },
      },
      from,
      functions: {
        async invoke(name, {body}){
          invokes.push(body);
          if(opts.notDeployed){
            return {data:null, error:{message:'Edge Function returned a non-2xx status code', context:{status:404, json: async()=>({})}}};
          }
          if(body.action==='connect'){ connected = true; return {data:{connected:true, athlete_name:'Sam Runner', fetched:0}, error:null}; }
          if(body.action==='sync') return {data: connected ? {connected:true, athlete_name:'Sam Runner', fetched:0} : {connected:false}, error:null};
          if(body.action==='disconnect'){ connected = false; return {data:{connected:false}, error:null}; }
          if(body.action==='authorize_url') return {data:{url:'https://www.strava.com/oauth/authorize?x=1'}, error:null};
          return {data:null, error:{message:'?', context:{status:400, json: async()=>({error:'unknown_action'})}}};
        },
      },
    };
  }
  return { db, invokes, addLog, addStrava, createClient };
}

async function open(today, backend){
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/Altiro/', beforeParse(w){
    w.__ALTIRO_TEST_TODAY__ = today;
    if(backend) w.supabase = {createClient: ()=> backend.createClient()};
  } });
  await wait(backend ? 400 : 50);
  const w = dom.window, doc = w.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('home'); await wait(20);
  const click = async el => { (typeof el==='string' ? doc.querySelector(el) : el).click(); await wait(25); };
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', {bubbles:true})); };
  return {w, doc, go, click, type};
}
const text = el => (el ? el.textContent : '').replace(/\s+/g,' ').trim();
const arm = [[41,20],[46,15],[51,10],[58,10],[63,5],[68,5],[73,5],[78,3],[83,3],[88,2],[93,1],[78,5],[63,10]];

(async () => {
  // ---- A workout built as it was done, on a rest day (Sat Sep 19) ----
  const s1 = await open('2026-09-19');
  {
    const {doc, go, click, type} = s1;
    const sheet = doc.getElementById('logPerfOverlay'), nameSec = doc.getElementById('logPerfNameSection'), nameIn = doc.getElementById('logPerfNameInput');
    await click('#addTodayWorkoutBtn');
    await click('#createLiveToggle');
    type(doc.getElementById('manualNameInput'), 'Armwrestling');
    await click('#saveManualEntry');
    check('Recording a workout: no name box (it was just named)', !sheet.hidden && nameSec.hidden);
    const rowOf = key => [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].find(r=>r.getAttribute('data-exercise-key')===key);
    for(const lift of ['Wrist wrench Left', 'Wrist wrench Right']){
      type(doc.getElementById('logPerfAddExerciseInput'), lift); await click('#logPerfAddExerciseBtn');
      const key = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].pop().getAttribute('data-exercise-key');
      for(let i=0; i<arm.length; i++){
        if(i>0) await click(rowOf(key).querySelector('[data-step="1"]'));
        const r = rowOf(key).querySelectorAll('.set-log-row')[i];
        type(r.querySelector('[data-field="weight"]'), String(arm[i][0])); type(r.querySelector('[data-field="reps"]'), String(arm[i][1]));
      }
    }
    type(doc.getElementById('logPerfAddExerciseInput'), 'Curl'); await click('#logPerfAddExerciseBtn');
    const ck = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].pop().getAttribute('data-exercise-key');
    const cr = rowOf(ck).querySelectorAll('.set-log-row')[0];
    type(cr.querySelector('[data-field="weight"]'), '30'); type(cr.querySelector('[data-field="reps"]'), '10');
    await click('#saveLogPerf');
    if(doc.getElementById('reviewOverlay') && !doc.getElementById('reviewOverlay').hidden) doc.getElementById('submitReviewBtn')?.click();
    await wait(30);
    // Its Summary, opened from the day.
    go('home'); await wait(20);
    const openSummary = async () => {
      go('home'); await wait(20);
      await click(doc.querySelector('#weekStrip .day-cell.today'));
      await click('#dayDetailPlanRow');
    };
    await openSummary();
    check('(set-up) the done workout opens its Summary, with Edit', !doc.getElementById('screen-summary').hidden && !doc.getElementById('summaryEditBtn').hidden);
    // The Summary's exercises: a long list of sets goes under the name; a short one stays beside it.
    const seRows = [...doc.querySelectorAll('#summaryExercisesList .se-row')];
    const left = seRows.find(r=> /Wrist wrench Left/.test(text(r))), curl = seRows.find(r=> /Curl/.test(text(r)));
    check('Summary: 13 sets go under the exercise\'s name, wrapping (not off the side of the card)', left && left.classList.contains('stack') && /41x20/.test(text(left)) && /63x10/.test(text(left)), left && left.className);
    check('...a short one stays beside its name', curl && !curl.classList.contains('stack'), curl && curl.className);
    check('...and the sets are allowed to wrap (they used to be kept on one line)', /\.summary-exercises \.se-result\{[^}]*overflow-wrap:anywhere/.test(html) && !/\.summary-exercises \.se-result\{[^}]*flex-shrink:0/.test(html));
    await click('#summaryEditBtn');
    check('Edit: the workout\'s name is at the top, ready to change', !sheet.hidden && !nameSec.hidden && nameIn.value==='Armwrestling' && /Workout name/.test(text(nameSec)), nameIn.value);
    type(nameIn, '  Wrist   Wrench Day ');
    await click('#saveLogPerf');
    check('Saved: the Summary has the new name', /^Wrist Wrench Day ·/.test(text(doc.getElementById('summarySessTitle'))), text(doc.getElementById('summarySessTitle')));
    check('...and still every set that was logged', /63x10/.test(text(doc.getElementById('summaryExercisesList'))));
    go('home'); await wait(20);
    check('Today shows the new name', /Wrist Wrench Day/.test(text(doc.querySelector('#sessionCard .title'))) && !/Armwrestling/.test(text(doc.getElementById('sessionCard'))), text(doc.querySelector('#sessionCard .title')));
    check('...still done', doc.getElementById('recordBtn').classList.contains('done'));
    go('calendar'); await wait(20);
    check('The Calendar too', /Wrist/.test(text(doc.querySelector('.mo-cell[data-date="2026-09-19"]'))) && !/Armwrest/.test(text(doc.querySelector('.mo-cell[data-date="2026-09-19"]'))), text(doc.querySelector('.mo-cell[data-date="2026-09-19"]')));
    await openSummary();
    await click('#summaryEditBtn');
    check('Edit again: the new name is in the box', nameIn.value==='Wrist Wrench Day', nameIn.value);
    type(nameIn, '   ');
    await click('#saveLogPerf');
    check('Saved with the name left empty: it keeps its name', /^Wrist Wrench Day ·/.test(text(doc.getElementById('summarySessTitle'))), text(doc.getElementById('summarySessTitle')));
    // ---- Its exercises' names ----
    await click('#summaryEditBtn');
    const exRow = key => [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].find(r=> r.getAttribute('data-exercise-key')===key);
    const label = key => text(exRow(key).querySelector('.exercise-log-name .ex-rx'));
    check('13 sets with different reps read "13 sets" (not "13 x 1")', label('Wrist wrench Left')==='13 sets', label('Wrist wrench Left'));
    check('...one set reads as before', /^1 x 10$/.test(label('Curl')), label('Curl'));
    const reps0 = exRow('Curl').querySelector('[data-field="reps"]');
    await click(exRow('Curl').querySelector('[data-step="1"]'));
    const reps1 = exRow('Curl').querySelectorAll('[data-field="reps"]')[1];
    type(reps1, '8'); await wait(10);
    check('...and it changes as the reps are typed (10 then 8: "2 sets")', label('Curl')==='2 sets', label('Curl'));
    type(reps1, '10'); await wait(10);
    check('...(both 10 again: "2 x 10")', label('Curl')==='2 x 10', label('Curl'));
    await click(exRow('Curl').querySelector('[data-step="-1"]'));
    const pencils = [...doc.querySelectorAll('#logPerfExercisesList [data-rename-ex]')];
    check('Each exercise has a pencil to rename it', pencils.length===3);
    const boxOf = key => exRow(key).querySelector('[data-rename-input]');
    check('...its box is out of sight until the pencil is tapped', boxOf('Wrist wrench Left').hidden && /\.ex-rename-input\[hidden\]\{display:none;\}/.test(html));
    await click(exRow('Wrist wrench Left').querySelector('[data-rename-ex]'));
    check('Tapping it: the name, ready to change', !boxOf('Wrist wrench Left').hidden && boxOf('Wrist wrench Left').value==='Wrist wrench Left');
    type(boxOf('Wrist wrench Left'), 'Cupping wrench L');
    await click(exRow('Wrist wrench Right').querySelector('[data-rename-ex]'));
    type(boxOf('Wrist wrench Right'), 'hammer curl'); // one of the app's own
    await click(exRow('Curl').querySelector('[data-rename-ex]'));
    type(boxOf('Curl'), 'Cupping wrench L'); // already taken by another one here
    await click('#saveLogPerf');
    const list = text(doc.getElementById('summaryExercisesList'));
    check('Saved: the Summary has the new names, each with its sets', /Cupping wrench L/.test(list) && /Hammer Curl/.test(list) && !/Wrist wrench/.test(list) && (list.match(/63x10/g)||[]).length===2, list.slice(0, 200));
    check('...a name another exercise already has isn\'t taken twice (Curl stays Curl)', /Curl/.test(list.replace(/Hammer Curl/g, '')), list);
    check('...and the workout\'s name is untouched', /^Wrist Wrench Day ·/.test(text(doc.getElementById('summarySessTitle'))));
    await click('#summaryEditBtn');
    check('Edit again: the renamed exercises, with every set as logged', !!exRow('Cupping wrench L') && !!exRow('Hammer Curl') && exRow('Cupping wrench L').querySelectorAll('.set-log-row').length===13 && exRow('Hammer Curl').querySelectorAll('.set-log-row').length===13 && exRow('Hammer Curl').querySelectorAll('.set-log-row')[0].querySelector('[data-field="weight"]').value==='41');
    check('...an app lift renamed to gets its demo', !!exRow('Hammer Curl').querySelector('.ex-demo-btn[data-demo="Hammer Curl"]') && !exRow('Cupping wrench L').querySelector('.ex-demo-btn'));
    await click(exRow('Curl').querySelector('[data-rename-ex]'));
    type(boxOf('Curl'), '   ');
    await click('#saveLogPerf');
    check('A name left empty keeps the old one', /Curl/.test(text(doc.getElementById('summaryExercisesList')).replace(/Hammer Curl/g, '')));
  }

  // ---- A plan workout: its name stays the plan's ----
  {
    const {doc, go, click} = await open('2026-09-18'); // a Friday: a training day on the default plan
    const planned = text(doc.querySelector('#sessionCard .title'));
    await click('#recordBtn'); await wait(400);
    await click('#saveLogPerf');
    if(doc.getElementById('reviewOverlay') && !doc.getElementById('reviewOverlay').hidden) doc.getElementById('submitReviewBtn')?.click();
    await wait(30);
    go('home'); await wait(20);
    await click(doc.querySelector('#weekStrip .day-cell.today'));
    await click('#dayDetailPlanRow');
    if(!doc.getElementById('screen-summary').hidden) await click('#summaryEditBtn');
    check(`A plan workout (${planned}): Edit has no name box`, !doc.getElementById('logPerfOverlay').hidden && doc.getElementById('logPerfNameSection').hidden);
    check('...and no pencils on its exercises', !doc.querySelector('#logPerfExercisesList [data-rename-ex]'));
  }

  // ---- An added workout beside the plan's, signed in: the new name is saved to the account ----
  {
    const backend = makeBackend({});
    const {doc, go, click, type} = await open('2026-09-18', backend);
    const planned = text(doc.querySelector('#sessionCard .title'));
    await click('#addTodayWorkoutBtn');
    await click('#createLiveToggle');
    type(doc.getElementById('manualNameInput'), 'Lunch pump');
    await click('#saveManualEntry'); await wait(50);
    type(doc.getElementById('logPerfAddExerciseInput'), 'Curl'); await click('#logPerfAddExerciseBtn');
    const r = doc.querySelector('#logPerfExercisesList .set-log-row');
    type(r.querySelector('[data-field="weight"]'), '30'); type(r.querySelector('[data-field="reps"]'), '10');
    await click('#saveLogPerf');
    if(doc.getElementById('reviewOverlay') && !doc.getElementById('reviewOverlay').hidden) doc.getElementById('submitReviewBtn')?.click();
    await wait(80);
    const row = () => Object.values(backend.db.planned_workouts)[0];
    check('(set-up) the added workout is saved, beside the plan\'s', row() && row().title==='Lunch pump', JSON.stringify(row()));
    go('home'); await wait(20);
    await click(doc.querySelector('#weekStrip .day-cell.today'));
    const extraRow = [...doc.querySelectorAll('#dayDetailOverlay [data-extra-id], #dayDetailOverlay .extra-row, #dayDetailOverlay .dd-extra')].find(e=> /Lunch pump/.test(text(e)));
    check('(set-up) it\'s on the day', !!extraRow, text(doc.getElementById('dayDetailOverlay')).slice(0,300));
    if(extraRow){
      await click(extraRow);
      if(!doc.getElementById('screen-summary').hidden) await click('#summaryEditBtn');
      check('An added workout: Edit has its name', !doc.getElementById('logPerfNameSection').hidden && doc.getElementById('logPerfNameInput').value==='Lunch pump');
      type(doc.getElementById('logPerfNameInput'), 'Arm pump');
      doc.querySelector('#logPerfExercisesList [data-rename-ex]').click(); await wait(20);
      type(doc.querySelector('#logPerfExercisesList [data-rename-input]'), 'Cable curl');
      await click('#saveLogPerf'); await wait(60);
      check('...renamed, and saved to the account', row().title==='Arm pump', row().title);
      check('...its exercise too', JSON.stringify((row().exercises||[]).map(e=> e.key+'/'+e.name))==='["Cable curl/Cable curl"]', JSON.stringify(row().exercises));
      go('home'); await wait(20);
      check('...the plan\'s workout is untouched', text(doc.querySelector('#sessionCard .title'))===planned && /Arm pump/.test(text(doc.getElementById('homeExtraWorkoutsWrap'))), text(doc.getElementById('homeExtraWorkoutsWrap')));
    }
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
