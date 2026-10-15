const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// Progress -> Body weight: log a weigh-in (one a day -- again that day replaces it), see the latest, the
// change since the first, a chart and the recent ones. The weight from setup is the first one. Kept in
// the cloud, and shown in the user's unit.
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
      if(op==='upsert'){ const hit = Object.values(rows).find(r=> r.user_id===payload.user_id && r.log_date===payload.log_date); if(hit) Object.assign(hit, payload); else { const id = newId(); rows[id] = {id, ...payload}; } return {data:null, error:null}; }
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
      upsert(p, o){ op = table==='body_weights' ? 'upsert' : 'noop'; payload = p; return api; }, delete(){ op='delete'; return api; },
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

const TODAY = '2026-10-15';
function open(backend){
  const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
    beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = TODAY; }});
  return dom;
}
const rows = backend => Object.values(backend.db.body_weights).map(r=> `${r.log_date}:${r.weight}`).sort().join(' ');

(async () => {
  const backend = makeBackend({connected:false});
  backend.db.profiles.u1 = {id:'u1', weight:180, weight_unit:'lb', created_at:'2026-09-01T15:00:00Z', training_days:[0,2,4]};
  backend.db.body_weights = {};
  let dom = open(backend);
  await wait(400);
  let doc = dom.window.document;
  const progress = async ()=>{ doc.querySelector('.nav-tab[data-tab="progress"]').click(); await wait(50); };
  const text = id=> doc.getElementById(id).textContent.replace(/\s+/g,' ').trim();
  await progress();
  check('Progress has a Body weight section, starting from the weight from setup', !doc.getElementById('bodyWeightSection').hidden && /180\s*lb/.test(text('bwSummary')) && /Log your weight/.test(text('bwSummary')), text('bwSummary'));
  check('...a box in the user\'s unit, and Log weight', doc.getElementById('bwInput').placeholder==='lb' && text('bwLogBtn')==='Log weight');

  doc.getElementById('bwInput').value = '178.4';
  doc.getElementById('bwLogBtn').click();
  await wait(50);
  check('Logged: saved, with the setup weight as the first weigh-in', rows(backend)==='2026-09-01:180 2026-10-15:178.4', rows(backend));
  check('...the latest shown, and the change since the first', /178\.4\s*lb/.test(text('bwSummary')) && /−1\.6 lb since Sep 1/.test(text('bwSummary')), text('bwSummary'));
  check('...a chart of it', !doc.getElementById('bwChart').hidden && !!doc.querySelector('#bwChart polyline'));
  check('...and the weigh-ins, newest first', doc.querySelectorAll('#bwList [data-bw-del]').length===2 && /^178\.4 lb\s?Today/.test(text('bwList')), text('bwList'));

  doc.getElementById('bwInput').value = '177.9';
  doc.getElementById('bwLogBtn').click();
  await wait(50);
  check('Again the same day: it replaces that day\'s', rows(backend)==='2026-09-01:180 2026-10-15:177.9', rows(backend));

  doc.getElementById('bwInput').value = '-3';
  doc.getElementById('bwLogBtn').click();
  await wait(20);
  check('A weight that can\'t be right isn\'t saved', rows(backend)==='2026-09-01:180 2026-10-15:177.9');

  doc.querySelector('#bwList [data-bw-del="2026-10-15"]').click();
  await wait(50);
  check('Delete takes it off', rows(backend)==='2026-09-01:180' && doc.querySelectorAll('#bwList [data-bw-del]').length===1, rows(backend));
  dom.window.close();

  // On another device (or after signing in again): from the cloud, in kg if that's the user's unit.
  backend.db.body_weights.x1 = {id:'x1', user_id:'u1', log_date:'2026-10-08', weight:176, unit:'lb'};
  backend.db.profiles.u1.weight_unit = 'kg';
  dom = open(backend);
  await wait(400);
  doc = dom.window.document;
  await progress();
  check('Signed in again: the weigh-ins come back, in kg', /79\.8\s*kg/.test(text('bwSummary')) && /−1\.8 kg since Sep 1/.test(text('bwSummary')) && doc.querySelectorAll('#bwList [data-bw-del]').length===2, text('bwSummary')+' | '+text('bwList'));
  dom.window.close();

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
