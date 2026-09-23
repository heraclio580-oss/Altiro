const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for a real production incident: shipping code that SELECTs a new workout_logs
// column (actual_run_distance) before that column's migration had actually been applied to the
// live Supabase database. Supabase-js doesn't throw on a bad column name -- it resolves with
// {data:null, error:...} -- and the old loadWorkoutDataFromCloud() just did `if(logs){...}`, so a
// single missing column silently wiped every planned workout, completed toggle, and manual entry
// off the calendar for every signed-in user, even though nothing was actually lost server-side.
// This mock simulates exactly that: a workout_logs table that errors on any select naming a
// column it doesn't have, mirroring a Postgres "column does not exist" error.
function makeBackend(){
  const db = { profiles:{}, workout_logs:{}, manual_entries:{}, recorded_sessions:[], progression_targets:{}, personal_records:{}, planned_workouts:{} };
  const authUsers = {};
  let nextId = 1;
  const newId = () => 'id' + (nextId++);
  // The columns this mock "database" actually has on workout_logs -- deliberately missing
  // actual_run_distance, simulating a project whose schema migration hasn't been run yet.
  const REAL_COLUMNS = ['log_date','completed_override','planned_type','planned_title','planned_detail','planned_interval_rounds','planned_interval_work_sec','planned_interval_rest_sec'];

  function createClient(){
    let currentUser = null;
    function from(table){
      let filters = [], pendingInsert=null, pendingUpdate=null, selectCols='';
      const matchRow = row => filters.every(([c,v]) => row[c]===v);
      async function run(single){
        if(table==='profiles'){
          if(pendingUpdate){
            const f = filters.find(x=>x[0]==='id');
            if(f) Object.assign(db.profiles[f[1]] || (db.profiles[f[1]]={}), pendingUpdate);
            return {data:null, error:null};
          }
          const f = filters.find(x=>x[0]==='id');
          return {data: (f && db.profiles[f[1]]) || null, error:null};
        }
        if(table==='workout_logs'){
          if(pendingInsert){
            const id = newId();
            db.workout_logs[id] = {id, completed_override:null, ...pendingInsert};
            return {data: db.workout_logs[id], error:null};
          }
          if(pendingUpdate){
            const f = filters.find(x=>x[0]==='id');
            if(f && db.workout_logs[f[1]]) Object.assign(db.workout_logs[f[1]], pendingUpdate);
            return {data:null, error:null};
          }
          if(single){
            const row = Object.values(db.workout_logs).find(matchRow);
            return {data: row || null, error:null};
          }
          // The list-select path used by loadWorkoutDataFromCloud(): fail like a real Postgres
          // "column does not exist" error if the requested columns include one we don't have.
          // Split only on top-level commas so nested embedded-resource columns like
          // "manual_entries(id, name, ...)" aren't mistaken for top-level column names.
          const topLevel = [];
          let depth=0, cur='';
          for(const ch of selectCols){
            if(ch==='(') depth++;
            if(ch===')') depth--;
            if(ch===',' && depth===0){ topLevel.push(cur); cur=''; } else cur+=ch;
          }
          if(cur) topLevel.push(cur);
          const requested = topLevel.map(s=>s.trim().split('(')[0]);
          const badCol = requested.find(c => c && c!=='manual_entries' && !REAL_COLUMNS.includes(c));
          if(badCol){
            return {data:null, error:{message:`column workout_logs.${badCol} does not exist`}};
          }
          const rows = Object.values(db.workout_logs).filter(matchRow).map(r => ({
            log_date: r.log_date, completed_override: r.completed_override,
            planned_type: r.planned_type||null, planned_title: r.planned_title||null, planned_detail: r.planned_detail||null,
            planned_interval_rounds: r.planned_interval_rounds ?? null,
            planned_interval_work_sec: r.planned_interval_work_sec ?? null,
            planned_interval_rest_sec: r.planned_interval_rest_sec ?? null,
            manual_entries: Object.values(db.manual_entries).filter(e=>e.workout_log_id===r.id)
              .map(e=>({id:e.id, name:e.name, type:e.type, volume:e.volume, notes:e.notes})),
          }));
          return {data: rows, error:null};
        }
        if(table==='manual_entries'){
          if(pendingInsert){ const id=newId(); db.manual_entries[id]={id,...pendingInsert}; return {data:{id}, error:null}; }
        }
        if(table==='recorded_sessions' && pendingInsert){ db.recorded_sessions.push(pendingInsert); return {data:null, error:null}; }
        if(table==='personal_records'){
          const f = filters.find(x=>x[0]==='user_id');
          return {data: Object.values(db.personal_records).filter(r=>!f || r.user_id===f[1]), error:null};
        }
        if(table==='planned_workouts'){
          if(pendingInsert){ const id=newId(); db.planned_workouts[id]={id,...pendingInsert}; return {data:{id}, error:null}; }
          const f = filters.find(x=>x[0]==='user_id');
          return {data: Object.values(db.planned_workouts).filter(r=>!f || r.user_id===f[1]), error:null};
        }
        if(table==='progression_targets'){
          const f = filters.find(x=>x[0]==='user_id');
          return {data: Object.values(db.progression_targets).filter(r=>!f || r.user_id===f[1]), error:null};
        }
        return {data:null, error:{message:'mock: unhandled '+table}};
      }
      const api = {
        select(cols){ selectCols = cols||''; return api; }, eq(c,v){ filters.push([c,v]); return api; },
        insert(p){ pendingInsert=p; return api; }, update(p){ pendingUpdate=p; return api; },
        upsert(p){ return api; }, delete(){ return api; },
        maybeSingle(){ return run(true); }, then(res,rej){ return run(false).then(res,rej); },
      };
      return api;
    }
    return {
      auth: {
        async signUp({email,password}){
          const id = newId(); authUsers[email] = {id,password};
          currentUser = {id,email}; db.profiles[id] = {id};
          return {data:{user:currentUser, session:{user:currentUser}}, error:null};
        },
        async signInWithPassword({email,password}){
          const u = authUsers[email];
          if(!u || u.password!==password) return {data:null, error:{message:'Invalid credentials'}};
          currentUser = {id:u.id, email};
          return {data:{user:currentUser, session:{user:currentUser}}, error:null};
        },
        async getSession(){ return {data:{session: currentUser ? {user:currentUser} : null}}; },
        async signOut(){ currentUser=null; return {error:null}; },
        async signInWithOAuth(){ return {error:{message:'not configured in mock'}}; },
        onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      },
      from,
    };
  }
  return { db, createClient: () => createClient() };
}

function openSession(backend){
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){
      window.supabase = { createClient: () => backend.createClient() };
      window.__ALTIRO_TEST_TODAY__ = '2026-09-18';
    },
  });
  return dom;
}

(async () => {
  const backend = makeBackend();

  // ---- Session A: sign up, toggle today done, plan a future workout ----
  const domA = openSession(backend);
  await wait(80);
  const docA = domA.window.document;
  const goPillA = id => [...docA.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillA('onb-account');
  await wait(20);
  docA.getElementById('emailInput').value = 'runner2@example.com';
  docA.getElementById('emailInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('passwordInput').value = 'hunter22';
  docA.getElementById('passwordInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('emailSignupBtn').click();
  await wait(80);

  goPillA('home');
  await wait(20);
  docA.getElementById('screen-home').scrollTop = docA.getElementById('sessionCard').offsetTop;
  docA.getElementById('homeCompleteToggle').click();
  await wait(60);
  console.log('Session A: toggling Completed created a cloud workout_logs row:',
    Object.values(backend.db.workout_logs).some(r=>r.completed_override===true) ? 'OK' : 'FAIL');

  docA.querySelector('#weekStrip .day-cell[data-day="5"]').click();
  await wait(20);
  docA.getElementById('addWorkoutBtn').click();
  await wait(20);
  docA.getElementById('manualNameInput').value = 'Weekend Trail Run';
  docA.getElementById('manualNameInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  [...docA.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  docA.getElementById('saveManualEntry').click();
  await wait(60);
  console.log('Session A: planned Saturday workout synced to the cloud:',
    Object.values(backend.db.workout_logs).some(r=>r.planned_title==='Weekend Trail Run') ? 'OK' : 'FAIL');
  docA.getElementById('closeDayDetail').click();
  await wait(10);

  docA.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  docA.getElementById('manualNameInput').value = 'Evening Mobility Work';
  docA.getElementById('manualNameInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('saveManualEntry').click();
  await wait(60);

  // ---- Session B: fresh sign-in, but this "live database" is missing actual_run_distance -- the
  // exact real-world condition (schema.sql updated in the repo, not yet applied to the project). ----
  const domB = openSession(backend);
  await wait(80);
  const docB = domB.window.document;
  const goPillB = id => [...docB.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillB('onb-account');
  await wait(20);
  docB.getElementById('toggleAuthMode').click();
  docB.getElementById('emailInput').value = 'runner2@example.com';
  docB.getElementById('emailInput').dispatchEvent(new domB.window.Event('input', {bubbles:true}));
  docB.getElementById('passwordInput').value = 'hunter22';
  docB.getElementById('passwordInput').dispatchEvent(new domB.window.Event('input', {bubbles:true}));
  docB.getElementById('emailSignupBtn').click();
  await wait(100);

  goPillB('home');
  await wait(20);
  console.log('Session B (DB missing actual_run_distance): today still shows completed, not lost:',
    docB.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');
  console.log('Session B: today\'s manual entry still round-trips despite the missing column:',
    docB.getElementById('homeEntriesWrap').textContent.includes('Evening Mobility Work') ? 'OK' : 'FAIL');

  docB.querySelector('#weekStrip .day-cell[data-day="5"]').click();
  await wait(20);
  console.log('Session B: Saturday\'s planned workout still round-trips despite the missing column (this is the reported bug):',
    docB.getElementById('dayDetailPlanRow').textContent.includes('Weekend Trail Run') ? 'OK' : `FAIL (${docB.getElementById('dayDetailPlanRow').textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
