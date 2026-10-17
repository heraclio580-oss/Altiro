const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// Workouts the user built: a lift keeps its numbers in each workout. A user with a Chest & Back day on
// Sunday and a Chest day on Wednesday (Bench Press in both) changed one and saw it on the other: the
// numbers were the lift's, shared by every workout it was in. Now Sunday's bench carries on to next
// Sunday's, and Wednesday's is its own -- its reps as built, and its sets from its own last time.
// (The plan's own lifts still share one set of numbers across the week: that's how it progresses them.)
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
    let filters = [], op = 'select', payload = null, wantRows = false, conflict = [];
    const rows_ok = t => !!db[t];
    const matches = row => filters.every(([c,v,kind]) => kind==='is' ? row[c]==null : kind==='notnull' ? row[c]!=null : kind==='gte' ? row[c]>=v : row[c]===v);
    async function run(single){
      const rows = db[table];
      if(!rows) return {data: [], error:null}; // planned_workouts, progression_targets, personal_records, ...
      if(op==='upsert'){ const hit = Object.values(rows).find(r=> conflict.every(c=> r[c]===payload[c])); if(hit) Object.assign(hit, payload); else { const id = newId(); rows[id] = {id, ...payload}; } return {data:null, error:null}; }
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
      select(){ wantRows = true; return api; },
      eq(c,v){ filters.push([c,v,'eq']); return api; },
      is(c){ filters.push([c,null,'is']); return api; },
      not(c){ filters.push([c,null,'notnull']); return api; },
      gte(c,v){ filters.push([c,v,'gte']); return api; },
      order(){ return api; },
      insert(p){ op='insert'; payload=p; return api; },
      update(p){ op='update'; payload=p; wantRows=false; return api; },
      upsert(p, o){ op = rows_ok(table) ? 'upsert' : 'noop'; payload = p; conflict = (o && o.onConflict || '').split(','); return api; }, delete(){ op='delete'; return api; },
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

const CHEST_BACK = [{key:'Bench Press', name:'Bench Press', sets:4, reps:8}, {key:'Bent-Over Row', name:'Bent-Over Row', sets:4, reps:8}];
const CHEST = [{key:'Bench Press', name:'Bench Press', sets:3, reps:12}, {key:'Chest Fly', name:'Chest Fly', sets:3, reps:12}];
function makeDays(backend){
  backend.db.progression_targets = {};
  [['2026-10-11', 'Chest & Back', CHEST_BACK], ['2026-10-14', 'Chest Day', CHEST], ['2026-10-18', 'Chest & Back', CHEST_BACK], ['2026-10-21', 'Chest Day', CHEST]]
    .forEach(([d, title, ex])=> backend.addLog(d, {planned_type:'strength', planned_title:title, planned_detail:'45 min', planned_exercises: ex}));
}
function open(backend, today){
  return new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
    beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = today; }});
}
const benchSets = doc=>{ const row = doc.querySelector('#logPerfExercisesList .exercise-log-row[data-exercise-key="Bench Press"]');
  return row ? [...row.querySelectorAll('.set-log-row')].map(r=> `${r.querySelector('[data-field="weight"]').value}x${r.querySelector('[data-field="reps"]').value}`) : null; };

(async () => {
  const backend = makeBackend({connected:false});
  makeDays(backend);
  // ---- Sunday: Chest & Back, bench at 185 for 8 ----
  let dom = open(backend, '2026-10-11'); await wait(400);
  let doc = dom.window.document;
  check('(set-up) Sunday is the Chest & Back day', /Chest & Back/.test(doc.querySelector('#sessionCard .title').textContent), doc.querySelector('#sessionCard .title').textContent);
  doc.getElementById('recordBtn').click(); await wait(950);
  const row = doc.querySelector('#logPerfExercisesList .exercise-log-row[data-exercise-key="Bench Press"]');
  [...row.querySelectorAll('.set-log-row')].forEach(r=>{ r.querySelector('[data-field="weight"]').value = '185'; r.querySelector('[data-field="reps"]').value = '8'; });
  doc.getElementById('saveLogPerf').click(); await wait(300);
  const keys = Object.values(backend.db.progression_targets).map(t=> `${t.session_key}=${t.weight}x${t.reps}`);
  check('Logged: the bench\'s numbers are saved in the Chest & Back workout', keys.includes('strength:Chest & Back › Bench Press=185x8'), JSON.stringify(keys));
  check('...not as Bench Press for every workout', !keys.some(k=> /^strength:Bench Press=185/.test(k)), JSON.stringify(keys));
  dom.window.close();

  // ---- Wednesday: Chest Day keeps its own 3 x 12, and doesn't start from Sunday's 185 ----
  dom = open(backend, '2026-10-14'); await wait(400);
  doc = dom.window.document;
  check('(set-up) Wednesday is the Chest Day', /Chest Day/.test(doc.querySelector('#sessionCard .title').textContent));
  doc.getElementById('recordBtn').click(); await wait(950);
  const wed = benchSets(doc);
  check('Wednesday\'s Chest Day: its bench is 3 sets of 12, not Sunday\'s 185 x 8', wed && wed.length===3 && wed.every(s=> !/^185/.test(s) && /x12$/.test(s)), JSON.stringify(wed));
  // Change Wednesday's bench to 135 x 12 by logging it.
  const wrow = doc.querySelector('#logPerfExercisesList .exercise-log-row[data-exercise-key="Bench Press"]');
  [...wrow.querySelectorAll('.set-log-row')].forEach(r=>{ r.querySelector('[data-field="weight"]').value = '135'; r.querySelector('[data-field="reps"]').value = '12'; });
  doc.getElementById('saveLogPerf').click(); await wait(300);
  const keys2 = Object.values(backend.db.progression_targets).map(t=> `${t.session_key}=${t.weight}x${t.reps}`);
  check('Logging Wednesday\'s leaves Sunday\'s alone', keys2.includes('strength:Chest & Back › Bench Press=185x8') && keys2.includes('strength:Chest Day › Bench Press=135x12'), JSON.stringify(keys2));
  dom.window.close();

  // ---- Next Sunday: Chest & Back carries on from last Sunday ----
  dom = open(backend, '2026-10-18'); await wait(400);
  doc = dom.window.document;
  doc.getElementById('recordBtn').click(); await wait(950);
  const sun2 = benchSets(doc);
  check('Next Sunday\'s Chest & Back starts from last Sunday\'s 185 x 8 (not Wednesday\'s 135)', sun2 && sun2.length>=1 && sun2.every(s=> s==='185x8'), JSON.stringify(sun2));
  dom.window.close();

  // ---- And next Wednesday from last Wednesday ----
  dom = open(backend, '2026-10-21'); await wait(400);
  doc = dom.window.document;
  doc.getElementById('recordBtn').click(); await wait(950);
  const wed2 = benchSets(doc);
  check('Next Wednesday\'s Chest Day starts from last Wednesday\'s 135 x 12', wed2 && wed2.length===3 && wed2.every(s=> s==='135x12'), JSON.stringify(wed2));
  dom.window.close();

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
