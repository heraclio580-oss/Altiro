const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Free vs Pro, previewed: a tester account (profiles.tester) has "Preview free version" in Settings.
// On, the app is what a free account would see -- no generated plan from today on ("Unlock your plan"),
// no Adjust, no suggested targets, 4 weeks of Progress, no personal records, no voice cues -- and off,
// it's all back. It only changes what's shown: nothing saved is touched. Other accounts don't see it.
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



const open = backend => new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
  beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = '2026-09-16'; }});
const text = el => (el ? el.textContent : '').replace(/\s+/g,' ').trim();
(async () => {
  // ---- Not a tester: nothing to see ----
  {
    const backend = makeBackend({});
    const dom = open(backend); await wait(400);
    const doc = dom.window.document;
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click(); await wait(20);
    check('An account that isn\'t a tester has no "Preview free version"', doc.getElementById('freePreviewSection').hidden);
    dom.window.close();
  }
  // ---- A tester ----
  const backend = makeBackend({});
  backend.db.profiles.u1 = {id:'u1', tester:true};
  const dom = open(backend); await wait(400);
  const doc = dom.window.document, go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('home'); await wait(20);
  const planned = text(doc.querySelector('#sessionCard .title'));
  check('(set-up) today has a plan workout', !/rest/i.test(planned), planned);
  go('settings'); await wait(20);
  const sec = doc.getElementById('freePreviewSection'), toggle = doc.getElementById('freePreviewToggle');
  check('A tester has "Preview free version" in Settings, off', !sec.hidden && !toggle.classList.contains('on') && /Preview free version/.test(text(sec)));
  const logsBefore = JSON.stringify(backend.db.workout_logs);
  toggle.click(); await wait(30);
  check('...turning it on', toggle.classList.contains('on'));
  go('home'); await wait(20);
  const card = doc.getElementById('sessionCard');
  check("Free: today's plan workout isn't there -- an open day, with \"Unlock your plan\"", /rest/i.test(text(card.querySelector('.title'))) && !!card.querySelector('[data-pro="plan"]'), text(card).slice(0,120));
  card.querySelector('[data-pro="plan"]').click(); await wait(20);
  check('...which opens the Altiro Pro plans, saying the plan is part of Pro', !doc.getElementById('paywallOverlay').hidden && /Altiro Pro/.test(text(doc.querySelector('#paywallOverlay .sheet-head'))) && /personalized plan/.test(text(doc.getElementById('paywallWhy'))) && !doc.getElementById('paywallPreviewNote').hidden);
  doc.getElementById('closePaywall').click();
  doc.querySelector('[data-open-adjust]').click(); await wait(20);
  check('Free: Adjust your plan says it\'s part of Pro instead of opening', doc.getElementById('adjustOverlay').hidden && !doc.getElementById('paywallOverlay').hidden && /Adjusting your plan/.test(text(doc.getElementById('paywallWhy'))));
  doc.getElementById('closePaywall').click();
  go('progress'); await wait(20);
  const prev = doc.getElementById('progWeeksPrev');
  check('Free: Progress shows 4 weeks; going back further says it\'s part of Pro', !prev.disabled && (prev.click(), !doc.getElementById('paywallOverlay').hidden && /beyond the last 4 weeks/.test(text(doc.getElementById('paywallWhy')))));
  doc.getElementById('closePaywall').click();
  check('Free: personal records are part of Pro (nothing to add them with)', doc.getElementById('addPrBtn').hidden && /Personal records are part of Pro/.test(text(doc.getElementById('prList'))));
  go('week'); await wait(20);
  const rowTitle = i => text(doc.getElementById('weekList').querySelector(`.plan-row[data-day="${i}"][data-week-idx="0"] .prow-title`));
  check('Free, on the Plan: days gone by keep their workout; Friday (still to come) is open', !/Rest/.test(rowTitle(0)) && /Rest/.test(rowTitle(4)), `Mon ${rowTitle(0)} / Fri ${rowTitle(4)}`);
  check('Nothing saved changed while previewing', JSON.stringify(backend.db.workout_logs)===logsBefore);
  go('settings'); await wait(20);
  toggle.click(); await wait(30);
  go('home'); await wait(20);
  check("Off again: today's plan workout is back", text(doc.querySelector('#sessionCard .title'))===planned, text(doc.querySelector('#sessionCard .title')));
  go('progress'); await wait(20);
  check('...and personal records too', !doc.getElementById('addPrBtn').hidden);
  doc.querySelector('[data-open-adjust]').click(); await wait(20);
  check('...and Adjust opens', !doc.getElementById('adjustOverlay').hidden);
  dom.window.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
