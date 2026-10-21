const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// One workout, counted once: a workout started with "+ Add a workout" (Log as you go) on a day whose own
// workout has the same name is that workout. Done that way, the day's own one was left showing missed
// beside a done copy (an armwrestling workout, Tuesday). Now it's logged onto the day's own workout;
// and days logged the old way are put right when the app opens.
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


const open = (backend, today) => new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
  beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = today; }});
const text = el => (el ? el.textContent : '').replace(/\s+/g,' ').trim();
const EX = [{key:'Wrist wrench', name:'Wrist wrench', sets:1, reps:5}, {key:'Cable curls', name:'Cable curls', sets:1, reps:3}];
const DONE = {exercises:[{key:'Wrist wrench', name:'Wrist wrench', sets:[{weight:45.5, reps:10}, {weight:55.5, reps:5}]}, {key:'Cable curls', name:'Cable curls', sets:[{weight:50, reps:10}, {weight:65.5, reps:3}]}], time:31};
(async () => {
  // ---- Logged the old way on Tuesday: the day's own workout missed, a done copy beside it ----
  {
    const backend = makeBackend({});
    backend.db.profiles.u1 = {id:'u1', own_since:'2026-09-01'};
    backend.addLog('2026-09-15', {planned_type:'strength', planned_title:'Armwrestling workout', planned_detail:'', planned_exercises: EX});
    backend.db.planned_workouts = {pw1: {id:'pw1', user_id:'u1', log_date:'2026-09-15', session_type:'strength', title:'Armwrestling workout', detail:'',
      exercises: [{key:'Wrist wrench', name:'Wrist wrench', sets:5, reps:10}, {key:'Cable curls', name:'Cable curls', sets:5, reps:10}], completed:true, performance: DONE}};
    backend.db.planned_workouts.pw2 = {id:'pw2', user_id:'u1', log_date:'2026-09-15', session_type:'strength', title:'Grip finisher', detail:'', exercises:[], completed:true, performance:{exercises:[], time:5}};
    const dom = open(backend, '2026-09-16');
    await wait(400);
    const day = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-15');
    check("On opening, Tuesday's own workout takes what was done: marked done", day.completed_override===true, day.completed_override);
    check('...with the sets logged (31 min, both lifts)', day.performance && day.performance.time===31 && day.performance.exercises.length===2, JSON.stringify(day.performance));
    check('...and its exercises are the ones done', Array.isArray(day.planned_exercises) && day.planned_exercises[0].sets===5, JSON.stringify(day.planned_exercises));
    check('...the copy goes, so it counts once', !backend.db.planned_workouts.pw1);
    check('...while another workout that day, named differently, stays', !!backend.db.planned_workouts.pw2);
    dom.window.close();
  }
  // ---- A rest day: the same workout started and left, then started again and finished ----
  {
    const backend = makeBackend({});
    backend.db.planned_workouts = {
      pw1: {id:'pw1', user_id:'u1', log_date:'2026-09-15', session_type:'strength', title:'Armwrestling workout', detail:'',
        exercises: [{key:'Wrist wrench', name:'Wrist wrench', sets:1, reps:10}], completed:false, performance:null},
      pw2: {id:'pw2', user_id:'u1', log_date:'2026-09-15', session_type:'strength', title:'Armwrestling workout', detail:'',
        exercises: [{key:'Wrist wrench', name:'Wrist wrench', sets:5, reps:10}, {key:'Cable curls', name:'Cable curls', sets:5, reps:10}], completed:true, performance: DONE},
    };
    backend.addLog('2026-09-15', {completed_override:false});
    const dom = open(backend, '2026-09-16');
    await wait(400);
    check('A rest day with the workout left and then finished: the one left (nothing logged) goes', !backend.db.planned_workouts.pw1 && !!backend.db.planned_workouts.pw2, JSON.stringify(Object.keys(backend.db.planned_workouts)));
    const day = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-15');
    check('...and the day no longer reads "not done"', day.completed_override==null, day.completed_override);
    const doc = dom.window.document;
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(30);
    const tue = doc.querySelector('#weekStrip [data-date="2026-09-15"]');
    check('...so it shows done in the week (not missed)', !!tue && /done|complete/.test(tue.className) && !/missed/.test(tue.className), tue && tue.className);
    dom.window.close();
  }
  {
    // Today: one started and left is the one picked up again, not a third copy.
    const backend = makeBackend({});
    backend.db.planned_workouts = {pw1: {id:'pw1', user_id:'u1', log_date:'2026-09-15', session_type:'strength', title:'Armwrestling workout', detail:'',
      exercises: [{key:'Wrist wrench', name:'Wrist wrench', sets:1, reps:10}], completed:false, performance:null}};
    const dom = open(backend, '2026-09-15');
    await wait(400);
    const doc = dom.window.document, w = dom.window;
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(20);
    doc.getElementById('addTodayWorkoutBtn').click(); await wait(20);
    doc.getElementById('createLiveToggle').click(); await wait(10);
    const n = doc.getElementById('manualNameInput'); n.value = 'Armwrestling workout'; n.dispatchEvent(new w.Event('input', {bubbles:true}));
    doc.getElementById('saveManualEntry').click(); await wait(60);
    const rows = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].map(r=> r.getAttribute('data-exercise-key'));
    check("Starting it again by name picks up the one started earlier today (its exercise is there)", !doc.getElementById('logPerfOverlay').hidden && rows.join(',')==='Wrist wrench', rows.join(','));
    check('...without adding another copy', Object.keys(backend.db.planned_workouts).length===1, JSON.stringify(Object.keys(backend.db.planned_workouts)));
    dom.window.close();
  }
  // ---- A rest day moved there in Plan (saved as "Rest Day", marked not done), a workout added and finished ----
  {
    const backend = makeBackend({});
    backend.addLog('2026-09-15', {planned_type:'rest', planned_title:'Rest Day', planned_detail:'', completed_override:false});
    backend.db.planned_workouts = {pw2: {id:'pw2', user_id:'u1', log_date:'2026-09-15', session_type:'strength', title:'Armwrestling workout', detail:'',
      exercises: [{key:'Wrist wrench', name:'Wrist wrench', sets:5, reps:10}], completed:true, performance: DONE}};
    const dom = open(backend, '2026-09-16');
    await wait(400);
    const day = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-15');
    check('A moved-in rest day whose added workout is done: the old "not done" goes', day.completed_override==null, day.completed_override);
    check('...the workout itself is left as it was', backend.db.planned_workouts.pw2 && backend.db.planned_workouts.pw2.completed===true);
    const doc = dom.window.document;
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(30);
    const cell = () => doc.querySelector('#weekStrip [data-date="2026-09-15"]');
    check('...and it shows done in the week', !!cell() && /done/.test(cell().className) && !/missed/.test(cell().className), cell() && cell().className);
    // Its Completed toggle is the workout's own: off, then on again.
    cell().click(); await wait(30);
    doc.getElementById('dayCompleteToggle').click(); await wait(30);
    check("Turning that day's Completed off marks its workout not done", backend.db.planned_workouts.pw2.completed===false && /missed/.test(cell().className), cell().className);
    doc.getElementById('dayCompleteToggle').click(); await wait(30);
    check('...and on again, done -- with no day mark left behind', backend.db.planned_workouts.pw2.completed===true && /done/.test(cell().className) && day.completed_override==null, cell().className);
    dom.window.close();
  }
  // ---- Starting a workout named the same as today's own one ----
  {
    const backend = makeBackend({});
    backend.db.profiles.u1 = {id:'u1', own_since:'2026-09-01'};
    backend.addLog('2026-09-15', {planned_type:'strength', planned_title:'Armwrestling workout', planned_detail:'', planned_exercises: EX});
    backend.db.planned_workouts = {};
    const dom = open(backend, '2026-09-15');
    await wait(400);
    const doc = dom.window.document, w = dom.window;
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(20);
    doc.getElementById('addTodayWorkoutBtn').click(); await wait(20);
    doc.getElementById('createLiveToggle').click(); await wait(10);
    const n = doc.getElementById('manualNameInput'); n.value = 'armwrestling workout '; n.dispatchEvent(new w.Event('input', {bubbles:true}));
    doc.getElementById('saveManualEntry').click(); await wait(60);
    const rows = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].map(r=> r.getAttribute('data-exercise-key'));
    check("Starting 'Armwrestling workout' (any case) opens today's own one, with its exercises", !doc.getElementById('logPerfOverlay').hidden && rows.join(',')==='Wrist wrench,Cable curls', rows.join(','));
    check('...where more can still be added', !doc.getElementById('logPerfAddExercise').hidden);
    check('...and no copy is added beside it', !Object.values(backend.db.planned_workouts || {}).length, JSON.stringify(backend.db.planned_workouts));
    doc.getElementById('closeLogPerf').click(); await wait(20);
    // A differently named one still goes beside it.
    doc.getElementById('addTodayWorkoutBtn').click(); await wait(20);
    doc.getElementById('createLiveToggle').classList.contains('on') || doc.getElementById('createLiveToggle').click(); await wait(10);
    n.value = 'Lunch pump'; n.dispatchEvent(new w.Event('input', {bubbles:true}));
    doc.getElementById('saveManualEntry').click(); await wait(60);
    check('A workout with another name still goes beside it', doc.querySelectorAll('#logPerfExercisesList .exercise-log-row').length===0 && Object.values(backend.db.planned_workouts || {}).some(p=> p.title==='Lunch pump'), JSON.stringify(backend.db.planned_workouts));
    dom.window.close();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
