const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// A run from the watch (through Strava) has no route here to find its fastest stretches in, so its best
// efforts used to be its average pace: a 3.12 mi run at 9:34/mi whose fastest mile was 8:59 (Strava's
// own best effort) didn't beat a 9:16 mile. Strava's best efforts come with the run now (the strava
// function keeps them), and count instead: new runs, runs filed before they were kept, and -- while the
// database doesn't have that column yet -- runs still come in.
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
  const addStrava = (id, local_date, name, distance_m, moving_time_s, more) => {
    db.strava_activities[id] = {id, user_id:'u1', name, local_date, start_date: local_date+'T12:00:00Z', distance_m, moving_time_s, applied_at:null, ...(more || {})};
  };
  function from(table){
    let filters = [], op = 'select', payload = null, wantRows = false, cols = '';
    const matches = row => filters.every(([c,v,kind]) => kind==='is' ? row[c]==null : kind==='notnull' ? row[c]!=null : kind==='gte' ? row[c]>=v : row[c]===v);
    async function run(single){
      const rows = db[table];
      // (A database from before the best_efforts column: asking for it is an error.)
      if(opts.noBestsCol && table==='strava_activities' && /best_efforts/.test(cols)) return {data:null, error:{code:'42703', message:'column strava_activities.best_efforts does not exist'}};
      if(!rows) return {data: [], error:null}; // planned_workouts, progression_targets, personal_records, ...
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
      select(c){ wantRows = true; cols = String(c || ''); return api; },
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


function open(backend, today){
  return new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
    beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = today; }});
}
const STRAVA_BESTS = {'1mi': 539, '5k': 1780};

(async () => {
  // ---- A new run from Strava: its fastest mile (8:59) beats the 9:16 from Nov 3 ----
  {
    const backend = makeBackend({connected:true});
    backend.addLog('2026-11-03', {planned_type:'run', planned_title:'Tempo Run', planned_detail:'3 mi', completed_override:true, actual_run_distance:3.1,
      performance: {distance: 3.1, time: 30.5, source:'gps', route:['_p~iF~ps|U_ulLnnqC'], bests: {'1mi': 556, '5k': 1830}}});
    backend.db.profiles.u1.badges = {day_one:'2026-09-01', first_run:'2026-09-27', best_v: 2, best_1mi:['2026-11-03|556'], best_5k:['2026-11-03|1830']};
    backend.addStrava(201, '2026-11-14', 'Recovery Jog', 5021, 1792, {best_efforts: STRAVA_BESTS});
    const dom = open(backend, '2026-11-14');
    await wait(2500);
    const doc = dom.window.document;
    const s = backend.db.strava_activities[201];
    check('The run comes in from Strava', !!s.applied_at);
    const logged = [...Object.values(backend.db.workout_logs).map(r=> r.performance), ...Object.values(backend.db.manual_entries).map(e=> e.performance)].find(p=> p && p.stravaId===201);
    check('...with Strava\'s best efforts', !!logged && logged.bests && logged.bests['1mi']===539 && logged.bests['5k']===1780 && logged.bestsFrom==='strava', JSON.stringify(logged));
    const saved = backend.db.profiles.u1.badges || {};
    check('Its 8:59 mile is the new fastest mile (not its 9:34 average)', (saved.best_1mi||[])[0]==='2026-11-14|539', JSON.stringify(saved.best_1mi));
    check('...and its 5K is Strava\'s 29:40', (saved.best_5k||[])[0]==='2026-11-14|1780', JSON.stringify(saved.best_5k));
    const moment = doc.getElementById('badgeOverlay') && !doc.getElementById('badgeOverlay').hidden ? doc.getElementById('badgeBody').textContent.replace(/\s+/g,' ') : '';
    check('...celebrated: "fastest 1 mile 8:59"', /fastest 1 mile 8:59/i.test(moment), moment);
    dom.window.close();
  }

  // ---- A run filed before Strava's best efforts were kept: it gets them on the next sync ----
  {
    const backend = makeBackend({connected:true});
    const id = backend.addLog('2026-11-14', {planned_type:'run', planned_title:'Recovery Jog', planned_detail:'3 mi', completed_override:true, actual_run_distance:3.12,
      performance: {distance: 3.12, time: 29.87, source:'strava', stravaId: 201, fromWatch: true, numbersFrom: 'strava'}});
    backend.addStrava(201, '2026-11-14', 'Recovery Jog', 5021, 1792, {best_efforts: STRAVA_BESTS, applied_at: '2026-11-14T17:00:00Z'});
    const dom = open(backend, '2026-11-15');
    await wait(2500);
    const perf = backend.db.workout_logs[id].performance;
    check('Filed before: it takes Strava\'s best efforts now', perf.bests && perf.bests['1mi']===539 && perf.bestsFrom==='strava', JSON.stringify(perf));
    check('...and keeps everything else', perf.distance===3.12 && perf.stravaId===201 && perf.time===29.87, JSON.stringify(perf));
    dom.window.close();
  }

  // ---- A run tracked here with GPS, then the watch's copy with Strava's best efforts: Strava's win ----
  {
    const backend = makeBackend({connected:true});
    const id = backend.addLog('2026-11-14', {planned_type:'run', planned_title:'Recovery Jog', planned_detail:'3 mi', completed_override:true, actual_run_distance:3.1,
      performance: {distance: 3.1, time: 29.9, source:'gps', route:['_p~iF~ps|U_ulLnnqC'], startedAt: Date.parse('2026-11-14T11:58:00Z'), finishedAt: Date.parse('2026-11-14T12:28:00Z'), bests: {'1mi': 552, '5k': 1795, '10k': 0}}});
    backend.addStrava(201, '2026-11-14', 'Recovery Jog', 5021, 1792, {best_efforts: STRAVA_BESTS});
    const dom = open(backend, '2026-11-14');
    await wait(2500);
    const perf = backend.db.workout_logs[id].performance;
    check('GPS run + the watch\'s copy: Strava\'s best efforts', perf.bests && perf.bests['1mi']===539 && perf.bests['5k']===1780 && perf.stravaId===201, JSON.stringify(perf && perf.bests));
    dom.window.close();
  }

  // ---- No best_efforts column yet: runs still come in, at their average pace ----
  {
    const backend = makeBackend({connected:true, noBestsCol:true});
    backend.addStrava(201, '2026-11-14', 'Recovery Jog', 5021, 1792);
    const dom = open(backend, '2026-11-14');
    await wait(2500);
    check('Without the column: the run still comes in', !!backend.db.strava_activities[201].applied_at);
    dom.window.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
