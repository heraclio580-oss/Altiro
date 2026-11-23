const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A hike tracked here only part of the way -- GPS lost signal after 4.6 mi going up Cucamonga Peak -- with
// the whole 13 miles from the watch (Health Connect, then Strava): its distance, time and climb are the
// watch's, but the splits (miles 1-4) and the height line were the phone's 4.6 miles. Now:
// - the Summary keeps the route, leaves out those splits and that height line, and says why ("GPS lost
//   signal after 4.6 mi, so the route stops there. The distance and time are from your watch.");
// - its share card has no splits or height line either;
// - a hike tracked all the way keeps its splits -- and a split slower than an hour a mile shows its pace
//   ("62:10/mi"), not "--:--".
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

// A stand-in for the canvas jsdom doesn't have: draws nothing, measures text, and makes a picture.
function fakeCanvas(w){
  const ctx = new Proxy({}, { get(t, k){
    if(k in t) return t[k];
    if(k==='measureText') return s=> ({width: String(s).length*8});
    if(k==='getImageData') return (x, y, ww, hh)=> ({data: new Uint8ClampedArray(4*ww*hh), width: ww, height: hh});
    if(k==='createImageData') return (ww, hh)=> ({data: new Uint8ClampedArray(4*ww*hh), width: ww, height: hh});
    return function(){ return ctx; };
  }, set(t, k, v){ t[k] = v; return true; } });
  w.HTMLCanvasElement.prototype.getContext = function(){ return ctx; };
  w.HTMLCanvasElement.prototype.toBlob = function(cb){ cb(new w.Blob(['x'], {type:'image/jpeg'})); };
  w.URL.createObjectURL = ()=> 'blob:fake'; w.URL.revokeObjectURL = ()=>{};
}
// A route north-east up a mountain: n points, about `mi` miles in all.
function route(mi, n){
  const pts = [];
  for(let i=0;i<=n;i++){ const f = i/n; pts.push([34.20 + f*mi*0.0145*0.7, -117.60 + f*mi*0.0145*0.7]); }
  return [pts];
}
async function openSummary(perf, name){
  const backend = makeBackend({});
  const logId = backend.addLog('2026-11-22', {});
  backend.db.manual_entries.e1 = {id:'e1', workout_log_id: logId, name, type:'hike', volume: `${perf.distance} mi`, notes:'', distance: perf.distance, duration_min: perf.time, performance: perf};
  const dom = open(backend, '2026-11-23', w=> fakeCanvas(w));
  await wait(1500);
  const w = dom.window, doc = w.document;
  for(const id of ['badgeOverlay', 'locPromptOverlay']){ const e = doc.getElementById(id); if(e) e.hidden = true; }
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('calendar'); await wait(20);
  doc.querySelector('.mo-cell[data-date="2026-11-22"]').click(); await wait(20);
  (doc.querySelector('#dayDetailEntries [data-entry-id]') || doc.getElementById('dayDetailPlanRow')).click(); await wait(60);
  return {dom, w, doc};
}

(async () => {
  // ---- Tracked 4.6 mi here, 13.01 mi from the watch ----
  {
    const perf = {distance: 13.01, time: 655, source: 'health', healthId: 'hc-1', stravaId: 501, fromWatch: true, elevGain: 1278,
      route: route(4.64, 60), splits: [1880, 2735, 3353, 3277], splitUnit: 'mi', lastSplit: {dist: 0.64, sec: 26000},
      elevProfile: {d: [0, 2000, 4000, 7400], a: [1494, 1700, 2000, 2559]}, activity: 'hike'};
    const {dom, doc} = await openSummary(perf, 'Cucamonga peak hike');
    check('The Summary: the watch\'s 13.01 mi', !doc.getElementById('screen-summary').hidden && /13\.01 mi/.test(txt(doc.getElementById('summaryStats'))), txt(doc.getElementById('summaryStats')));
    check('...the route stays', !doc.getElementById('summaryRouteCard').hidden);
    check('...but not the phone\'s splits (miles 1-4 only)', !/Mile 1/.test(txt(doc.getElementById('summarySplits'))), txt(doc.getElementById('summarySplits')));
    check('...or its height line', doc.getElementById('summaryElevProfile').hidden);
    const note = txt(doc.getElementById('summaryGpsNote'));
    check('...and it says why: "GPS lost signal after 4.6 mi … from your watch."', !doc.getElementById('summaryGpsNote').hidden && /GPS lost signal after 4\.6 mi, so the route stops there\. The distance and time are from your watch\./.test(note), note);
    doc.getElementById('shareWorkoutBtn').click(); await wait(200);
    const alt = doc.getElementById('shareCardPreview').alt || '';
    check('Its share card: 13.01 mi, no splits', /13\.01 mi/.test(alt) && !/Mile 1|Splits/i.test(alt), alt.slice(0, 200));
    dom.window.close();
  }

  // ---- Tracked all the way: splits stay, a slow one shows its pace ----
  {
    const perf = {distance: 2.5, time: 140, source: 'gps', activity: 'hike',
      route: route(2.5, 40), splits: [3730, 2900], splitUnit: 'mi', lastSplit: {dist: 0.5, sec: 1800}};
    const {dom, doc} = await openSummary(perf, 'Steep hike');
    const sp = txt(doc.getElementById('summarySplits'));
    check('Tracked all the way: its splits stay', /Mile 1/.test(sp) && /Mile 2/.test(sp), sp);
    check('...and a split slower than an hour a mile shows its pace: 62:10/mi (not --:--)', /Mile 1\s*62:10\/mi/.test(sp) && !/--:--/.test(sp), sp);
    check('...no "lost signal" note', !/lost signal/.test(txt(doc.getElementById('summaryGpsNote'))) || doc.getElementById('summaryGpsNote').hidden);
    dom.window.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
