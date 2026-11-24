const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Strava's route, for a workout tracked here only part of the way: GPS lost signal 4.6 mi up Cucamonga
// Peak, and the watch recorded all 13 miles. Strava's copy now brings its route (the strava function keeps
// it), and:
// - the hike already filed from it takes Strava's whole route on the next sync -- and the phone's partial
//   splits, height line and descent go (only of the first 4.6 mi); its distance, time and climb stay;
// - a hike from Strava filed fresh has its route on the map;
// - a run tracked here all the way keeps its own route and splits (Strava's isn't needed).
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const txt = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
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

// Google's encoded polyline (as Strava sends): points [lat, lng].
function encode(pts){
  let out = '', pl = 0, pg = 0;
  const enc = v=>{ v = v<0 ? ~(v<<1) : v<<1; let s = ''; while(v>=0x20){ s += String.fromCharCode((0x20|(v&0x1f))+63); v >>= 5; } return s + String.fromCharCode(v+63); };
  pts.forEach(([la, lg])=>{ const a = Math.round(la*1e5), b = Math.round(lg*1e5); out += enc(a-pl) + enc(b-pg); pl = a; pg = b; });
  return out;
}
// A line north-east from the trailhead, about `mi` miles long.
const line = (mi, n)=> Array.from({length: n+1}, (_, i)=> [34.20 + i/n*mi*0.0145*0.7, -117.60 + i/n*mi*0.0145*0.7*1.2]);

(async () => {
  // ---- Cucamonga: filed already (phone's 4.6 mi + the watch's numbers); Strava's route arrives ----
  {
    const backend = makeBackend({connected:true});
    const logId = backend.addLog('2026-11-22', {});
    const phone = {distance: 13.01, time: 655, source: 'gps', stravaId: 501, healthId: 'hc-1', elevGain: 1278, elevLoss: 213.7,
      route: [line(4.64, 40)], splits: [1880, 2735, 3353, 3277], splitUnit: 'mi', lastSplit: {dist: 0.64, sec: 6040}, activity: 'hike',
      elevProfile: {d: [0, 2000, 4000, 7400], a: [1494, 1700, 2000, 2559]}};
    backend.db.manual_entries.e1 = {id:'e1', workout_log_id: logId, name:'Cucamonga peak hike', type:'hike', volume:'13.01 mi', notes:'', distance: 13.01, duration_min: 655, performance: phone};
    const full = encode(line(13.0, 120));
    backend.addStrava(501, '2026-11-22', 'Morning Hike', 20937, 29840, {sport_type:'Hike', elev_gain_m: 1278, applied_at:'2026-11-22T20:00:00Z', route_polyline: full});
    const dom = open(backend, '2026-11-23');
    await wait(2500);
    const w = dom.window, doc = w.document;
    for(const id of ['badgeOverlay', 'locPromptOverlay']){ const e = doc.getElementById(id); if(e) e.hidden = true; }
    const p = backend.db.manual_entries.e1.performance;
    check('The hike filed already takes Strava\'s whole route', Array.isArray(p.route) && p.route.length===1 && p.route[0]===full && p.routeFrom==='strava', JSON.stringify(p.route).slice(0, 60));
    check('...and the phone\'s partial splits, height line and descent go', !p.splits && !p.lastSplit && !p.elevProfile && p.elevLoss==null, JSON.stringify({s: p.splits, e: !!p.elevProfile, l: p.elevLoss}));
    check('...its distance, time and climb stay', p.distance===13.01 && p.time===655 && p.elevGain===1278);
    const go = id => [...doc.querySelectorAll('.proto-pill')].find(x => x.dataset.navId === id).click();
    go('calendar'); await wait(20);
    doc.querySelector('.mo-cell[data-date="2026-11-22"]').click(); await wait(20);
    (doc.querySelector('#dayDetailEntries [data-entry-id]') || doc.getElementById('dayDetailPlanRow')).click(); await wait(60);
    const stats = txt(doc.getElementById('summaryStats'));
    check('Its Summary: the route, no splits, no partial note', !doc.getElementById('summaryRouteCard').hidden && !/Mile 1/.test(txt(doc.getElementById('summarySplits'))) && doc.getElementById('summaryGpsNote').hidden, txt(doc.getElementById('summarySplits')) + ' / ' + txt(doc.getElementById('summaryGpsNote')));
    check('...13.01 mi, the climb, and no partial descent', /13\.01 mi/.test(stats) && /Elevation Gain/i.test(stats) && !/Elevation Loss/i.test(stats), stats);
    dom.window.close();
  }

  // ---- A hike from Strava, filed fresh: its route ----
  {
    const backend = makeBackend({connected:true});
    const r = encode(line(6, 50));
    backend.addStrava(601, '2026-11-21', 'Saturday Hike', 9656, 9000, {sport_type:'Hike', route_polyline: r});
    const dom = open(backend, '2026-11-23');
    await wait(2500);
    const e = Object.values(backend.db.manual_entries).find(x=> x.name==='Saturday Hike');
    check('A hike from Strava: filed with its route', !!e && e.performance && e.performance.route && e.performance.route[0]===r && e.performance.routeFrom==='strava', JSON.stringify(e && e.performance).slice(0, 120));
    dom.window.close();
  }

  // ---- A run tracked here all the way: keeps its own ----
  {
    const backend = makeBackend({connected:true});
    const logId = backend.addLog('2026-11-20', {});
    const own = [line(3.1, 30)];
    backend.db.manual_entries.e2 = {id:'e2', workout_log_id: logId, name:'Run', type:'run', volume:'3.1 mi', notes:'', distance: 3.1, duration_min: 28,
      performance: {distance: 3.1, time: 28, source: 'gps', stravaId: 701, route: own, splits: [540, 545, 548], lastSplit: {dist: 0.1, sec: 50}, splitUnit: 'mi'}};
    backend.addStrava(701, '2026-11-20', 'Morning Run', 4989, 1680, {sport_type:'Run', applied_at:'2026-11-20T20:00:00Z', route_polyline: encode(line(3.1, 30))});
    const dom = open(backend, '2026-11-23');
    await wait(2500);
    const p = backend.db.manual_entries.e2.performance;
    check('A run tracked here all the way keeps its own route and splits', Array.isArray(p.route) && typeof p.route[0]!=='string' && p.splits && p.splits.length===3 && p.routeFrom!=='strava', JSON.stringify({rf: p.routeFrom, s: p.splits}));
    dom.window.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
