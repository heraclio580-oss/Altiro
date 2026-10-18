const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// A run tracked here gets its climb from terrain data along the route, which smooths away the small
// rises: a 14.7 mi run came out at 157 ft up / 417 down, where the watch's barometer said 223 / 486.
// When the watch's copy comes in from Strava, its climb is used instead, and the loss follows from the
// route's own net change (the start and finish heights terrain data gets right): 223 + 260 = 483.
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

const open = backend => new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
  beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; }});
const T0 = new Date(2026, 8, 18, 7, 0).getTime();
const FT = 0.3048;
const near = (a, b) => Math.abs(a - b) < 0.5;
const gpsRun = (extra) => ({planned_type:'run', planned_title:'14 mile long run', planned_detail:'14 mi', completed_override:true, actual_run_distance:14.5,
  performance:{distance:14.5, time:173.7, source:'gps', route:['_p~iF~ps|U_ulLnnqC'], startedAt:T0, finishedAt:T0+173.7*60000,
    elevGain: 157*FT, elevLoss: 417*FT, elevProfile:{d:[0, 23600], a:[531, 452]}, ...extra}});
const addRow = (backend, id, extra) => {
  backend.addStrava(id, '2026-09-18', 'Long Run', 23625, 10424);
  Object.assign(backend.db.strava_activities[id], {start_date: new Date(T0+30000).toISOString(), elapsed_time_s: 10425, elev_gain_m: 223*FT}, extra);
};
(async () => {
  // ---- Tracked with GPS here; the watch's copy comes in from Strava ----
  {
    const backend = makeBackend({connected:true});
    backend.addLog('2026-09-18', gpsRun());
    addRow(backend, 501);
    const dom = open(backend);
    await wait(300);
    const p = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-18').performance;
    check('The run takes the watch\'s climb: 223 ft', near(p.elevGain/FT, 223), p.elevGain/FT);
    check('...and its loss from the route\'s own drop (260 ft): 483 ft', near(p.elevLoss/FT, 483), p.elevLoss/FT);
    check('...marked as the watch\'s', p.elevSource==='watch', p.elevSource);
    check('...keeping the route\'s height profile', p.elevProfile && p.elevProfile.a.length===2);
    check('...and the watch\'s distance', p.distance===14.68, p.distance);
    dom.window.close();
  }
  // ---- Filed before the climb was kept: the next sign-in fills it in, once ----
  {
    const backend = makeBackend({connected:true});
    backend.addLog('2026-09-18', gpsRun({distance:14.68, stravaId:601, healthId:'h1', fromWatch:true, calories:2280}));
    addRow(backend, 601, {applied_at:'2026-09-18T12:00:00Z'});
    let dom = open(backend);
    await wait(300);
    let p = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-18').performance;
    check('A run already filed takes the watch\'s climb on the next sign-in: 223 / 483 ft', near(p.elevGain/FT, 223) && near(p.elevLoss/FT, 483), `${p.elevGain/FT} / ${p.elevLoss/FT}`);
    check('...keeping everything else (calories, its links)', p.calories===2280 && p.stravaId===601 && p.healthId==='h1', JSON.stringify(p));
    dom.window.close();
    dom = open(backend);
    await wait(300);
    p = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-18').performance;
    check('...and opening the app again leaves it as it is', near(p.elevGain/FT, 223) && near(p.elevLoss/FT, 483), `${p.elevGain/FT} / ${p.elevLoss/FT}`);
    dom.window.close();
  }
  // ---- A run from the watch only (no GPS run here) ----
  {
    const backend = makeBackend({connected:true});
    backend.addLog('2026-09-18', {planned_type:'run', planned_title:'14 mile long run', planned_detail:'14 mi'});
    addRow(backend, 701);
    const dom = open(backend);
    await wait(300);
    const p = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-18').performance;
    check('A run from the watch only has the watch\'s climb', p && near(p.elevGain/FT, 223), p && p.elevGain);
    check('...and no made-up loss', p && p.elevLoss==null, p && p.elevLoss);
    dom.window.close();
  }
  // ---- The database doesn't have the climb column yet ----
  {
    const backend = makeBackend({connected:true, noClimbColumn:true});
    backend.addLog('2026-09-18', gpsRun());
    addRow(backend, 801);
    delete backend.db.strava_activities[801].elev_gain_m;
    const dom = open(backend);
    await wait(300);
    const p = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-18').performance;
    check('Before the database has the column, the watch\'s copy still matches up (its distance comes in)', p.distance===14.68, p.distance);
    check('...and the run keeps its own climb', near(p.elevGain/FT, 157), p.elevGain/FT);
    check('...and the row is filed', !!backend.db.strava_activities[801].applied_at);
    dom.window.close();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
