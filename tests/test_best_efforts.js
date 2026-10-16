const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// Best efforts (Progress -> Trophies) are each run's fastest stretch of 1 mile, 5K, 10K..., not its
// average pace: a 5-mile run of 800s with an easy warm-up and cool-down (10:27/mi on average) had a 5K
// PR inside it (Garmin: 29:56) that the average (32:27) never showed. A run tracked here: from its GPS
// points; one tracked before that was kept: from its mile splits; others: their average pace.
const fn = name=>{ const i = html.indexOf(`function ${name}(`); let d = 0, j = html.indexOf('{', i); for(; j<html.length; j++){ if(html[j]==='{') d++; else if(html[j]==='}' && !--d) break; } return html.slice(i, j+1); };
const E = new Function(`${fn('haversineM')}
  const EFFORT_M = {'1mi': 1609.344, '5k': 5000, '10k': 10000, half: 21097.5, full: 42195};
  ${fn('bestEffortsFromSegs')} ${fn('bestEffortFromSplits')}
  return {bestEffortsFromSegs, bestEffortFromSplits};`)();

// ---- From the GPS points: a point every 10 m going north; pace per km as given ----
{
  const M_LAT = 1/111195, segs = [[]];
  let t = 0, d = 0;
  const run = (km, secPerKm)=>{ for(let k=0; k<km*100; k++){ d += 10; t += secPerKm/100; segs[segs.length-1].push([37 + d*M_LAT, -122, t*1000]); } };
  segs[0].push([37, -122, 0]);
  run(1, 420);                 // warm-up 1 km at 7:00/km
  run(2, 300);                 // 2 km at 5:00/km
  // a 5-minute pause (a new stretch): not running time
  t += 300; segs.push([[37 + d*M_LAT, -122, t*1000]]);
  run(3, 300);                 // 3 more km at 5:00/km
  run(1, 420);                 // cool-down
  const b = E.bestEffortsFromSegs(segs, 1);
  check('GPS points: the fastest 5K is the 5 km at 5:00/km (25:00), the pause left out', Math.abs(b['5k'] - 1500) <= 2, JSON.stringify(b));
  check('...the fastest mile 8:03 (5:00/km)', Math.abs(b['1mi'] - 483) <= 2, b['1mi']);
  check('...and no 10K in a 7 km run', b['10k']==null);
}

// ---- From mile splits: the real run (11:20, 9:44, 9:49, 9:28, 11:50) ----
{
  const perf = {splits: [680, 584, 589, 568, 710], lastSplit: {dist: 0.01, sec: 7}, splitUnit: 'mi'};
  const fiveK = E.bestEffortFromSplits(perf, 3.10686), mile = E.bestEffortFromSplits(perf, 1);
  check('Mile splits: the fastest 5K is the three quick miles and a bit (about 30:14, not the average\'s 32:27)', fiveK>=1810 && fiveK<=1818, fiveK);
  check('...and the fastest mile is the quickest split (9:28)', mile===568, mile);
  check('No splits: nothing (the average pace is used)', E.bestEffortFromSplits({}, 1)===null);
}
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

(async () => {
  // ---- In the app: yesterday's 800s run takes the 5K; older runs don't all pop up as "new" ----
  const backend = makeBackend({connected:false});
  const run = (date, mi, min, perf)=> backend.addLog(date, {planned_type:'run', planned_title:'Run', planned_detail:`${mi} mi`, completed_override:true, actual_run_distance: mi,
    performance: {distance: mi, time: min, source:'gps', route:['_p~iF~ps|U_ulLnnqC'], ...perf}});
  run('2026-09-27', 3.2, 31.5, {splits:[590, 591, 592], lastSplit:{dist:0.2, sec:118}, splitUnit:'mi'});      // an even 3.2 mi at ~9:50
  run('2026-10-15', 5.01, 52.37, {splits:[680, 584, 589, 568, 710], lastSplit:{dist:0.01, sec:7}, splitUnit:'mi'});
  // What the trophy case showed before (each run's average pace): the September run's 5K was the best.
  backend.db.profiles.u1.badges = {day_one:'2026-09-01', first_run:'2026-09-27', best_5k:['2026-09-27|1835', '2026-10-15|1947'], best_1mi:['2026-09-27|591', '2026-10-15|627']};
  const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
    beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = '2026-10-16'; }});
  await wait(2500);
  const doc = dom.window.document;
  const moment = doc.getElementById('badgeOverlay') && !doc.getElementById('badgeOverlay').hidden ? doc.getElementById('badgeBody').textContent.replace(/\s+/g,' ') : '';
  check('Yesterday\'s run: "Your fastest 5K", about 30:14', /fastest 5K/.test(moment) && /30:1\d/.test(moment), moment);
  const saved = backend.db.profiles.u1.badges || {};
  check('...saved as the best 5K, ahead of September\'s', (saved.best_5k||[])[0] && /^2026-10-15\|181\d$/.test(saved.best_5k[0]) && /^2026-09-27\|/.test(saved.best_5k[1]||''), JSON.stringify(saved.best_5k));
  check('...and the fastest mile is its 9:28 split', (saved.best_1mi||[])[0]==='2026-10-15|568', JSON.stringify(saved.best_1mi));
  check('The older run isn\'t announced again (only a run from the last few days)', !/September|Sep 27/.test(moment), moment);
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
