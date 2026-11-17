const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Indoor activities from a watch: a treadmill run or a spin bike, through Strava (Garmin's "Treadmill
// Running" and "Indoor Cycling", a Zwift ride) or Health Connect (treadmill, stationary bike), come in
// marked indoor -- and named so when they come in on their own ("Treadmill run", "Indoor ride"). A planned
// run done on a treadmill says "· Treadmill" on its Summary; a run already logged by hand is marked indoor
// when the watch's copy says it was. An outdoor ride isn't.
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

function open(backend, today, before){
  return new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
    beforeParse(w){ if(backend) w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = today; if(before) before(w); }});
}
const at = (day, h, m)=> new Date(`${day}T${String(h).padStart(2,'0')}:${String(m||0).padStart(2,'0')}:00`).toISOString();
function hcWorkout(id, day, hour, miles, mins, type){
  return {platformId: id, workoutType: type, startDate: at(day, hour), endDate: new Date(Date.parse(at(day, hour)) + mins*60000).toISOString(),
    duration: mins*60, totalDistance: miles*1609.344, totalEnergyBurned: mins*6, sourceName: 'com.garmin.android.apps.connectmobile'};
}


(async () => {
  // ---- Strava ----
  {
    const backend = makeBackend({connected:true});
    backend.addLog('2026-11-12', {planned_type:'run', planned_title:'Easy Run', planned_detail:'3 mi'});
    backend.addLog('2026-11-09', {planned_type:'run', planned_title:'Tempo Run', planned_detail:'3 mi', completed_override:true, actual_run_distance:3, performance:{distance:3, time:27}});
    backend.addStrava(401, '2026-11-12', 'Treadmill Running', 5150, 1800, {sport_type:'Run'});
    backend.addStrava(402, '2026-11-11', 'Zwift - Watopia', 20000, 2700, {sport_type:'VirtualRide'});
    backend.addStrava(403, '2026-11-10', 'Indoor Cycling', 15000, 2400, {sport_type:'Ride'});
    backend.addStrava(404, '2026-11-08', 'Morning Ride', 30000, 3600, {sport_type:'Ride'});
    backend.addStrava(405, '2026-11-09', 'Treadmill Running', 4870, 1620, {sport_type:'Run'});
    const dom = open(backend, '2026-11-14');
    await wait(2500);
    const w = dom.window, doc = w.document;
    const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    const log = day => Object.values(backend.db.workout_logs).find(r=> r.log_date===day);
    const entry = name => Object.values(backend.db.manual_entries).find(e=> e.name===name);
    const run = log('2026-11-12');
    check('Strava "Treadmill Running" on a run day: fills the planned run, marked indoor', run && run.actual_run_distance===3.2 && run.performance && run.performance.indoor===true, JSON.stringify(run && run.performance));
    check('A Zwift ride: a bike ride, marked indoor', entry('Zwift - Watopia') && entry('Zwift - Watopia').type==='ride' && entry('Zwift - Watopia').performance.indoor===true, JSON.stringify(entry('Zwift - Watopia')));
    check('Garmin\'s "Indoor Cycling": a bike ride, marked indoor', entry('Indoor Cycling') && entry('Indoor Cycling').type==='ride' && entry('Indoor Cycling').performance.indoor===true);
    check('An outdoor "Morning Ride" isn\'t', entry('Morning Ride') && !entry('Morning Ride').performance.indoor);
    const tempo = log('2026-11-09');
    check('A run logged by hand, then Strava\'s copy is a treadmill run: marked indoor, linked', tempo && tempo.performance && tempo.performance.indoor===true && tempo.performance.stravaId===405, JSON.stringify(tempo && tempo.performance));
    // The planned run's Summary.
    go('calendar'); await wait(20);
    doc.querySelector('.mo-cell[data-date="2026-11-12"]').click(); await wait(20);
    doc.getElementById('dayDetailPlanRow').click(); await wait(40);
    const title = doc.getElementById('summarySessTitle').textContent;
    check('Its Summary: "Easy Run · Treadmill · <day>"', /^Easy Run · Treadmill · /.test(title), title);
    // "Indoor Cycling" already says so: no extra tag.
    go('calendar'); await wait(20);
    doc.querySelector('.mo-cell[data-date="2026-11-10"]').click(); await wait(20);
    (doc.querySelector('#dayDetailEntries [data-entry-id]') || doc.getElementById('dayDetailPlanRow')).click(); await wait(40);
    const t2 = doc.getElementById('summarySessTitle').textContent;
    check('"Indoor Cycling": its name already says so (no extra tag)', /^Indoor Cycling · /.test(t2) && !/Indoor ·.*Indoor ·/.test(t2), t2);
    w.close();
  }

  // ---- Health Connect: a treadmill run and a stationary bike ----
  {
    const h = {workouts: [
      hcWorkout('hc-tread', '2026-11-13', 7, 3.0, 28, 'runningTreadmill'),
      hcWorkout('hc-bike', '2026-11-13', 18, 9.5, 40, 'bikingStationary'),
      hcWorkout('hc-out', '2026-11-12', 7, 12, 45, 'cycling'),
    ]};
    const plugin = {
      isAvailable: async()=> ({available: true, platform: 'android'}),
      requestAuthorization: async(o)=> ({readAuthorized: o.read, readDenied: [], writeAuthorized: [], writeDenied: []}),
      queryWorkouts: async()=> ({workouts: h.workouts.slice()}),
      queryAggregated: async()=> ({samples: []}),
    };
    const dom = open(null, '2026-11-14', w=>{ w.Capacitor = {isNativePlatform: ()=> true, getPlatform: ()=> 'android', Plugins: {Health: plugin}}; });
    await wait(80);
    const w = dom.window, doc = w.document;
    const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    go('settings'); await wait(20);
    doc.getElementById('healthConnectBtn').click(); await wait(150);
    const day = async key=>{ go('calendar'); await wait(10); doc.querySelector(`.mo-cell[data-date="${key}"]`).click(); await wait(20);
      const t = doc.getElementById('dayDetailOverlay').textContent.replace(/\s+/g,' '); doc.getElementById('closeDayDetail').click(); await wait(10); return t; };
    const fri = await day('2026-11-13'), thu = await day('2026-11-12');
    check('Health Connect treadmill run: "Treadmill run", 3 mi', /Treadmill run/.test(fri) && /3(\.0)? mi/.test(fri), fri);
    check('...stationary bike: "Indoor ride", 9.5 mi', /Indoor ride/.test(fri) && /9\.5 mi/.test(fri), fri);
    check('...an outdoor ride stays "Bike ride"', /Bike ride/.test(thu) && !/Indoor ride/.test(thu), thu);
    w.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
