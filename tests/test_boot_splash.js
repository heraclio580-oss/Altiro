const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Starting up signed in: just the logo (no Welcome) until Today is ready -- with a
// spinner if that takes a while. Not signed in, or the sign-in ran out: Welcome, as before.
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
        async getSession(){ if(opts.sessionDelay) await new Promise(r=>setTimeout(r, opts.sessionDelay)); return {data:{session: opts.noSession ? null : {user}}}; },
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

const TOKEN = 'sb-abcdefgh-auth-token';
const open = (backend, signedIn) => new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
  beforeParse(w){
    if(backend) w.supabase = {createClient: ()=> backend.createClient()};
    w.__ALTIRO_TEST_TODAY__ = '2026-09-16';
    if(signedIn) w.localStorage.setItem(TOKEN, JSON.stringify({access_token:'x'}));
  }});
const state = doc => ({
  splash: doc.documentElement.classList.contains('boot-signed-in'),
  welcome: !doc.getElementById('screen-welcome').hidden,
  home: !doc.getElementById('screen-home').hidden,
  slow: doc.getElementById('bootSplash').classList.contains('slow'),
});
(async () => {
  // ---- Not signed in on this device ----
  {
    const dom = open(makeBackend({noSession:true}), false);
    const doc = dom.window.document;
    check('Not signed in: no logo screen', !state(doc).splash);
    await wait(400);
    check('...Welcome, as before', state(doc).welcome && /Free to use/i.test(doc.getElementById('screen-welcome').textContent));
    dom.window.close();
  }
  // ---- Signed in ----
  {
    const dom = open(makeBackend({}), true);
    const doc = dom.window.document;
    const s0 = state(doc);
    check('Signed in: it starts on the logo, Welcome kept out of sight', s0.splash);
    const css = [...doc.querySelectorAll('style')].map(x=> x.textContent).join('\n');
    check('...(Welcome hidden and the logo screen shown while it\'s on)', /html\.boot-signed-in #screen-welcome\{visibility:hidden;\}/.test(css) && /html\.boot-signed-in \.boot-splash\{display:flex;\}/.test(css));
    const logo = doc.getElementById('bootSplashLogo');
    check('...the logo is Altiro\'s own picture', logo.getAttribute('src')===doc.getElementById('brandLogoFull').getAttribute('src') && /^data:image/.test(logo.getAttribute('src')));
    check('...no spinner yet', !s0.slow);
    await wait(500);
    const s1 = state(doc);
    check('Once the account is in: Today, and the logo screen is gone', s1.home && !s1.splash && !s1.welcome, JSON.stringify(s1));
    dom.window.close();
  }
  // ---- Signed in, slow to load ----
  {
    const dom = open(makeBackend({sessionDelay: 2600}), true);
    const doc = dom.window.document;
    await wait(2300);
    const s = state(doc);
    check('Slow: after 2 seconds, still the logo, with a spinner', s.splash && s.slow && !s.welcome && !s.home, JSON.stringify(s));
    await wait(900);
    check('...then Today', state(doc).home && !state(doc).splash);
    dom.window.close();
  }
  // ---- The sign-in on this device ran out ----
  {
    const dom = open(makeBackend({noSession:true}), true);
    const doc = dom.window.document;
    check('(set-up) a sign-in is remembered, so it starts on the logo', state(doc).splash);
    await wait(500);
    const s = state(doc);
    check('...but it ran out: Welcome, to sign in again', s.welcome && !s.splash && !s.home, JSON.stringify(s));
    dom.window.close();
  }
  // ---- Signed in, but the account can't be reached (no connection to it at all) ----
  {
    const dom = open(null, true);
    const doc = dom.window.document;
    await wait(4800);
    const s = state(doc);
    check('Can\'t reach the account: Welcome takes over (never stuck on the logo)', s.welcome && !s.splash, JSON.stringify(s));
    dom.window.close();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
