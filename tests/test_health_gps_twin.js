const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// One run, recorded twice -- tracked with GPS in Altiro while a Garmin recorded it too, the Garmin's copy
// coming in through Health Connect. As it happened on a real phone: the Garmin's copy arrived while the
// GPS run was still waiting to be saved, took the day's planned run, and the GPS run became a second run
// ("Also today: Run 3.3 mi"). Now the copy waits for the GPS run, and a day already counted twice is
// put back to one run.
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
    let filters = [], op = 'select', payload = null, wantRows = false;
    const matches = row => filters.every(([c,v,kind]) => kind==='is' ? row[c]==null : kind==='notnull' ? row[c]!=null : kind==='gte' ? row[c]>=v : row[c]===v);
    async function run(single){
      const rows = db[table];
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
      select(){ wantRows = true; return api; },
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

// (A run that finished minutes ago: one waiting to be saved holds the watch's copy for a few hours.)
const T0 = Date.now() - 40*60000, t0 = new Date(T0);
const DAY = `${t0.getFullYear()}-${String(t0.getMonth()+1).padStart(2,'0')}-${String(t0.getDate()).padStart(2,'0')}`;
const ROUTE = ['_p~iF~ps|U_ulLnnqC'];
const garmin = {platformId:'garmin-1', workoutType:'running', startDate: new Date(T0+15000).toISOString(), endDate: new Date(T0+15000+2166500).toISOString(),
  duration: 2166.5, totalDistance: 3.27*1609.344, totalEnergyBurned: 502, sourceName:'com.garmin.android.apps.connectmobile'};
function open(backend, gpsDone){
  const H = {queries: 0};
  const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
    beforeParse(w){
      w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = DAY;
      w.localStorage.setItem('altiro_health_on_u1', '1');
      if(gpsDone) w.localStorage.setItem('altiro_gps_done', JSON.stringify(gpsDone));
      w.Capacitor = {isNativePlatform: ()=> true, getPlatform: ()=> 'android', Plugins: {Health: {
        isAvailable: async()=> ({available: true}), requestAuthorization: async(o)=> ({readAuthorized: o.read}),
        queryWorkouts: async()=>{ H.queries++; return {workouts: [garmin]}; }, queryAggregated: async()=> ({samples: []})}}};
    }});
  return {dom, H};
}
const dayRow = backend => Object.values(backend.db.workout_logs).find(r=> r.log_date===DAY);

(async () => {
  // ---- Already counted twice: the Garmin's copy on the planned run, the GPS run added beside it ----
  {
    const backend = makeBackend({connected:false});
    backend.addLog(DAY, {planned_type:'run', planned_title:'3mile run', planned_detail:'3 mi', completed_override:true, actual_run_distance:3.27,
      performance:{distance:3.27, time:36.11, source:'health', healthId:'garmin-1', calories:502, startedAt:T0+15000, finishedAt:T0+15000+2166500}});
    backend.db.planned_workouts = {pw1: {id:'pw1', user_id:'u1', log_date:DAY, session_type:'run', title:'Run', detail:'3.3 mi', completed:true, actual_distance:3.30,
      performance:{distance:3.30, time:36.13, source:'gps', route:ROUTE, splits:[675, 647, 646], splitUnit:'mi', elevGain:47.9, elevLoss:48.8, startedAt:T0, finishedAt:T0+2168000}}};
    const {dom} = open(backend);
    await wait(500);
    const doc = dom.window.document, row = dayRow(backend);
    check('Counted twice: the GPS run beside it goes', !backend.db.planned_workouts.pw1 && doc.getElementById('homeAlsoToday').hidden,
      JSON.stringify(Object.keys(backend.db.planned_workouts))+' | '+doc.getElementById('homeAlsoToday').textContent.replace(/\s+/g,' '));
    check('...the planned run keeps the Garmin\'s 3.27 mi, 36:06 and calories', row.actual_run_distance===3.27 && row.performance.time===36.11 && row.performance.calories===502, JSON.stringify(row.performance));
    check('...and takes the GPS run\'s route and elevation', JSON.stringify(row.performance.route)===JSON.stringify(ROUTE) && row.performance.elevGain===47.9, JSON.stringify(row.performance));
    check('...one run on Today', /3mile run, 3\.27 mi · 36:0\d/.test(doc.querySelector('#sessionCard .title').textContent), doc.querySelector('#sessionCard .title').textContent);
    dom.window.close();
  }

  // ---- The Garmin's copy arrives while the GPS run is waiting to be saved ----
  {
    const backend = makeBackend({connected:false});
    backend.addLog(DAY, {planned_type:'run', planned_title:'3mile run', planned_detail:'3 mi'});
    const {dom, H} = open(backend, {target:{dayKey:DAY, kind:'primary', id:null},
      result:{distance:3.30, time:36.13, route:ROUTE, splits:[675, 647, 646], splitUnit:'mi', elevGain:47.9, elevLoss:48.8, startedAt:T0, finishedAt:T0+2168000}});
    await wait(500);
    const doc = dom.window.document;
    check('(set-up) Health Connect was looked at', H.queries>=1);
    check('While the GPS run waits to be saved, the Garmin\'s copy isn\'t filed on the planned run', !(dayRow(backend).actual_run_distance>0) && !Object.keys(backend.db.manual_entries).length,
      JSON.stringify(dayRow(backend)));
    doc.getElementById('recordBtn').click();
    await wait(1000);
    check('(set-up) Log Performance has the GPS run', !doc.getElementById('logPerfOverlay').hidden && doc.getElementById('logPerfDistanceInput').value==='3.3', doc.getElementById('logPerfDistanceInput').value);
    doc.getElementById('saveLogPerf').click();
    await wait(500);
    const row = dayRow(backend);
    check('Saved: then the Garmin\'s copy comes in, as the same run -- 3.27 mi, with its calories', row.actual_run_distance===3.27 && row.performance.healthId==='garmin-1' && row.performance.calories===502, JSON.stringify(row.performance));
    check('...keeping the GPS route', JSON.stringify(row.performance.route)===JSON.stringify(ROUTE));
    check('...and no second run', !Object.keys(backend.db.manual_entries).length && !Object.keys(backend.db.planned_workouts || {}).length,
      JSON.stringify([backend.db.manual_entries, backend.db.planned_workouts]));
    dom.window.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
