const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// A long run tracked with GPS here (9.56 mi) that a watch recorded too. Health Connect was read while the
// watch's app was still writing the run, so its copy said 8.02 mi -- and the run took that, its splits
// stretched to fit (11-minute miles became 13s). The watch's own Strava upload said 9.53. Now: a Health
// Connect copy more than 10% off the phone's GPS doesn't replace it, a Health Connect run is read again
// for 12 hours in case it grows, Strava's copy (the watch's whole file) replaces a Health Connect one,
// and a run that already took a short copy is put right.
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


// A run that finished 40 minutes ago, along a straight line 9.56 mi long (a point every 10 m).
const T0 = Date.now() - 150*60000, t0 = new Date(T0);
const DAY = `${t0.getFullYear()}-${String(t0.getMonth()+1).padStart(2,'0')}-${String(t0.getDate()).padStart(2,'0')}`;
const DUR = 106*60 + 45; // 1:46:45
function encodePolyline(pts){
  let out = '', pLat = 0, pLng = 0;
  const enc = v=>{ v = v<0 ? ~(v<<1) : (v<<1); let s = ''; while(v>=0x20){ s += String.fromCharCode((0x20|(v&0x1f))+63); v >>= 5; } return s + String.fromCharCode(v+63); };
  pts.forEach(([lat, lng])=>{ const a = Math.round(lat*1e5), b = Math.round(lng*1e5); out += enc(a-pLat) + enc(b-pLng); pLat = a; pLng = b; });
  return out;
}
const M_LAT = 1/111195, PHONE_MI = 9.56;
const ROUTE = [encodePolyline(Array.from({length: Math.round(PHONE_MI*1609.344/10)+1}, (_, i)=> [33.66 + i*10*M_LAT, -117.33]))];
const PHONE_SPLITS = [679, 666, 695, 665, 660, 669, 671, 661, 668], PHONE_LAST = {dist: 0.56, sec: 391};
const phoneRun = extra=> ({distance: PHONE_MI, time: DUR/60, source:'gps', route: ROUTE, splits: PHONE_SPLITS, lastSplit: PHONE_LAST, splitUnit:'mi', startedAt: T0, finishedAt: T0 + DUR*1000, ...extra});
const watchCopy = mi=> ({platformId:'watch-1', workoutType:'running', startDate: new Date(T0+5000).toISOString(), endDate: new Date(T0+5000+DUR*1000+2000).toISOString(),
  duration: DUR+2, totalDistance: mi*1609.344, totalEnergyBurned: 1485, sourceName:'com.sec.android.app.shealth'});
function open(backend, workouts){
  const H = {queries: 0};
  const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
    beforeParse(w){
      w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = DAY;
      w.localStorage.setItem('altiro_health_on_u1', '1');
      w.Capacitor = {isNativePlatform: ()=> true, getPlatform: ()=> 'android', Plugins: {Health: {
        isAvailable: async()=> ({available: true}), requestAuthorization: async(o)=> ({readAuthorized: o.read}),
        queryWorkouts: async()=>{ H.queries++; return {workouts}; }, queryAggregated: async()=> ({samples: []})}}};
    }});
  return {dom, H};
}
const dayRow = backend => Object.values(backend.db.workout_logs).find(r=> r.log_date===DAY);
const splitsOk = (perf, n, last)=> (perf.splits||[]).length===n && perf.lastSplit && perf.lastSplit.dist===last && perf.splits.every(x=> x>620 && x<720);

(async () => {
  // ---- The Health Connect copy is read short: the GPS run keeps its 9.56 mi ----
  {
    const backend = makeBackend({connected:false});
    backend.addLog(DAY, {planned_type:'run', planned_title:'Long Run', planned_detail:'9.5 mi', completed_override:true, actual_run_distance:PHONE_MI, performance: phoneRun()});
    let {dom, H} = open(backend, [watchCopy(8.02)]);
    await wait(500);
    let row = dayRow(backend);
    check('(set-up) Health Connect was read', H.queries>=1);
    check('A Health Connect copy at 8.02 mi (16% short of the GPS run\'s 9.56): the run keeps 9.56', row.actual_run_distance===PHONE_MI && row.performance.distance===PHONE_MI, JSON.stringify([row.actual_run_distance, row.performance.distance]));
    check('...and its own splits, as run (11-minute miles, then 0.56 mi)', JSON.stringify(row.performance.splits)===JSON.stringify(PHONE_SPLITS) && row.performance.lastSplit.dist===0.56, JSON.stringify([row.performance.splits, row.performance.lastSplit]));
    check('...linked to the watch\'s copy all the same, with its calories', row.performance.healthId==='watch-1' && row.performance.calories===1485 && row.performance.watchDistance===8.02, JSON.stringify(row.performance));
    check('...and no second run', !Object.keys(backend.db.manual_entries).length);
    dom.window.close();

    // A while later the watch's app has written the whole run: read again (it ended under 12 hours ago).
    ({dom, H} = open(backend, [watchCopy(9.53)]));
    await wait(500);
    row = dayRow(backend);
    check('Read again later at 9.53 mi (within 10% now): the run takes the watch\'s 9.53', row.actual_run_distance===9.53 && row.performance.distance===9.53, JSON.stringify([row.actual_run_distance, row.performance.distance]));
    check('...its splits re-measured to it: 9 miles and 0.53', splitsOk(row.performance, 9, 0.53), JSON.stringify([row.performance.splits, row.performance.lastSplit]));
    dom.window.close();
  }

  // ---- Already took the short copy (before this), and Strava has the watch's whole run ----
  {
    const backend = makeBackend({connected:true});
    // As it was saved: Health Connect's 8.02 mi, the splits stretched to it, and the Strava link added later.
    const stretched = [802, 787, 822, 787, 780, 791, 793, 781, 798].slice(0, 8);
    backend.addLog(DAY, {planned_type:'run', planned_title:'Long Run', planned_detail:'9.5 mi', completed_override:true, actual_run_distance:8.02,
      performance: phoneRun({distance: 8.02, time: (DUR+2)/60, splits: stretched, lastSplit: {dist: 0.02, sec: 16}, fromWatch: true, healthId: 'watch-1', stravaId: 701, calories: 1485})});
    backend.addStrava(701, DAY, 'Morning Run', 9.53*1609.344, 6364);
    const sr = backend.db.strava_activities[701];
    sr.applied_at = new Date(T0).toISOString(); sr.start_date = new Date(T0).toISOString(); sr.elapsed_time_s = DUR + 40;
    const {dom} = open(backend, []);
    await wait(700);
    const row = dayRow(backend), doc = dom.window.document;
    check('A run that took the short copy is put right from Strava\'s: 9.53 mi', row.actual_run_distance===9.53 && row.performance.distance===9.53, JSON.stringify([row.actual_run_distance, row.performance.distance]));
    check('...in Strava\'s 1:46:04', Math.abs(row.performance.time - 6364/60) < 0.02, row.performance.time);
    check('...its splits back to 11-minute miles: 9 miles and 0.53', splitsOk(row.performance, 9, 0.53), JSON.stringify([row.performance.splits, row.performance.lastSplit]));
    check('...still one run, linked to Strava', !Object.keys(backend.db.manual_entries).length && row.performance.stravaId===701);
    dom.window.close();
  }

  // ---- Took a short Health Connect copy, and no Strava: back to the phone's numbers, from its route ----
  {
    const backend = makeBackend({connected:false});
    const stretched = [802, 787, 822, 787, 780, 791, 793, 781];
    backend.addLog(DAY, {planned_type:'run', planned_title:'Long Run', planned_detail:'9.5 mi', completed_override:true, actual_run_distance:8.02,
      performance: phoneRun({distance: 8.02, time: (DUR+2)/60, splits: stretched, lastSplit: {dist: 0.02, sec: 16}, fromWatch: true, healthId: 'watch-1', calories: 1485})});
    const {dom} = open(backend, []);
    await wait(500);
    const row = dayRow(backend);
    check('No Strava: back to the phone\'s distance, measured along its route (9.56 mi)', Math.abs(row.actual_run_distance - PHONE_MI) <= 0.02 && Math.abs(row.performance.distance - PHONE_MI) <= 0.02, JSON.stringify([row.actual_run_distance, row.performance.distance]));
    check('...and 11-minute mile splits again', (row.performance.splits||[]).length===9 && row.performance.splits.every(x=> x>620 && x<720), JSON.stringify(row.performance.splits));
    dom.window.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
