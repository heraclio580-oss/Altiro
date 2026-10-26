const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Big step days: 15,000+ steps on a day with no workout makes it an active day. A rest day's dot turns
// done, the day says "Big step day · N steps", and it counts toward the week streak -- at most one a
// week, so walking alone never keeps a streak going. A missed workout day stays missed. Steps stay on
// the phone (localStorage), as before.
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

const STEPS = {'2026-09-19':20412, '2026-09-17':16000, '2026-09-16':3000, '2026-09-08':18000, '2026-09-12':17000, '2026-09-20':25000};
const open = (backend, steps) => new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
  beforeParse(w){
    w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = '2026-09-19';
    if(steps) w.localStorage.setItem('altiro_health_steps_u1', JSON.stringify(steps));
  }});
const text = el => (el ? el.textContent : '').replace(/\s+/g,' ').trim();
const seed = backend => {
  // Two workouts the week of Aug 31 (an active week), one on Mon Sep 14 (this week).
  backend.addLog('2026-08-31', {completed_override:true});
  backend.addLog('2026-09-02', {completed_override:true});
  backend.addLog('2026-09-14', {completed_override:true});
};
(async () => {
  // ---- No steps on the phone: nothing changes ----
  {
    const backend = makeBackend({}); seed(backend);
    const dom = open(backend, null); await wait(400);
    const doc = dom.window.document;
    const cell = k => doc.querySelector(`#weekStrip .day-cell[data-date="${k}"]`);
    check('(no steps) a rest day stays plain', !cell('2026-09-17').classList.contains('done'));
    check('(no steps) one workout this week is not an active week yet: streak 0', /^0 /.test(text(doc.getElementById('streakChip'))), text(doc.getElementById('streakChip')));
    dom.window.close();
  }
  const backend = makeBackend({}); seed(backend);
  const dom = open(backend, STEPS); await wait(400);
  const doc = dom.window.document;
  const cell = k => doc.querySelector(`#weekStrip .day-cell[data-date="${k}"]`);
  check('(set-up) Thu 17 and Sat 19 are rest days in the strip', !!cell('2026-09-17') && !!cell('2026-09-19'));
  check('A rest day with 16,000 steps (Thu) shows done', cell('2026-09-17').classList.contains('done'), cell('2026-09-17').className);
  check('Today, a rest day with 20,412 steps, shows done', cell('2026-09-19').classList.contains('done'), cell('2026-09-19').className);
  check('A missed workout day stays missed (3,000 steps)', cell('2026-09-16').classList.contains('missed'), cell('2026-09-16').className);
  check('A day still to come is untouched by steps (Sun 20)', !cell('2026-09-20').classList.contains('done'), cell('2026-09-20').className);
  // One workout + a big step day = 2, an active week. The week of Sep 7 has two step days and no
  // workout: that's 1, not 2, so it breaks the streak -- the streak is 1, not 3.
  check('The streak counts this week (1 workout + a big step day), and two step days in a week count once', /^1 /.test(text(doc.getElementById('streakChip'))), text(doc.getElementById('streakChip')));
  cell('2026-09-19').click(); await wait(30);
  const note = doc.getElementById('dayDetailStepDay');
  check('The day says "Big step day · 20,412 steps"', !note.hidden && text(note)==='Big step day · 20,412 steps', text(note));
  dom.window.close();
  {
    const dom2 = open(makeBackend({}), STEPS); await wait(400);
    const doc2 = dom2.window.document;
    doc2.querySelector('#weekStrip .day-cell[data-date="2026-09-18"]').click(); await wait(30);
    check('A day under 15,000 steps has no note', doc2.getElementById('dayDetailStepDay').hidden);
    dom2.window.close();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
