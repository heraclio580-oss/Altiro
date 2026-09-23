const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Same minimal in-memory Supabase stand-in used by test_cloud_sync.js.
function makeSharedBackend(){
  const db = { profiles:{}, workout_logs:{}, manual_entries:{}, recorded_sessions:[], progression_targets:{}, personal_records:{}, planned_workouts:{} };
  const authUsers = {};
  let nextId = 1;
  const newId = () => 'id' + (nextId++);

  function createClient(){
    let currentUser = null;
    const listeners = [];
    function from(table){
      let filters = [], pendingInsert=null, pendingUpdate=null, pendingUpsert=null, pendingDelete=false;
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
          if(pendingDelete){ const f=filters.find(x=>x[0]==='id'); if(f) delete db.manual_entries[f[1]]; return {data:null, error:null}; }
        }
        if(table==='planned_workouts'){
          if(pendingInsert){ const id=newId(); db.planned_workouts[id]={id,...pendingInsert}; return {data:{id}, error:null}; }
          if(pendingUpdate){ const f=filters.find(x=>x[0]==='id'); if(f && db.planned_workouts[f[1]]) Object.assign(db.planned_workouts[f[1]], pendingUpdate); return {data:null, error:null}; }
          if(pendingDelete){ const f=filters.find(x=>x[0]==='id'); if(f) delete db.planned_workouts[f[1]]; return {data:null, error:null}; }
          const f = filters.find(x=>x[0]==='user_id');
          return {data: Object.values(db.planned_workouts).filter(r=>!f || r.user_id===f[1]), error:null};
        }
        if(table==='recorded_sessions' && pendingInsert){ db.recorded_sessions.push(pendingInsert); return {data:null, error:null}; }
        if(table==='personal_records'){
          if(pendingInsert){ const id=newId(); db.personal_records[id]={id,...pendingInsert}; return {data:{id}, error:null}; }
          if(pendingDelete){ const f=filters.find(x=>x[0]==='id'); if(f) delete db.personal_records[f[1]]; return {data:null, error:null}; }
          const f = filters.find(x=>x[0]==='user_id');
          return {data: Object.values(db.personal_records).filter(r=>!f || r.user_id===f[1]).map(r=>({
            id:r.id, exercise:r.exercise, value:r.value, unit:r.unit, created_at: r.created_at || new Date().toISOString(),
          })), error:null};
        }
        if(table==='progression_targets'){
          if(pendingUpsert){
            const key = pendingUpsert.payload.user_id+'|'+pendingUpsert.payload.session_key;
            db.progression_targets[key] = pendingUpsert.payload;
            return {data:null, error:null};
          }
          const f = filters.find(x=>x[0]==='user_id');
          return {data: Object.values(db.progression_targets).filter(r=>!f || r.user_id===f[1]), error:null};
        }
        return {data:null, error:{message:'mock: unhandled '+table}};
      }
      const api = {
        select(){ return api; }, eq(c,v){ filters.push([c,v]); return api; },
        insert(p){ pendingInsert=p; return api; }, update(p){ pendingUpdate=p; return api; },
        upsert(p,opts){ pendingUpsert={payload:p,opts}; return api; }, delete(){ pendingDelete=true; return api; },
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
        onAuthStateChange(cb){ listeners.push(cb); return {data:{subscription:{unsubscribe(){}}}}; },
      },
      from,
    };
  }
  return { db, createClient: () => createClient() };
}

(async () => {
  const backend = makeSharedBackend();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){
      window.supabase = { createClient: () => backend.createClient() };
      window.__ALTIRO_TEST_TODAY__ = '2026-09-18';
    },
  });
  await wait(80);
  const doc = dom.window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('onb-account');
  await wait(20);
  doc.getElementById('emailInput').value = 'runner@example.com';
  doc.getElementById('emailInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('passwordInput').value = 'hunter22';
  doc.getElementById('passwordInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('emailSignupBtn').click();
  await wait(100);

  goPill('home');
  await wait(20);

  // Plan a custom workout for TODAY. "Mark as Completed" already defaults off, so this goes through
  // planCustomWorkout, the exact path that writes into state.week[TODAY_IDX] and syncs to the
  // workout_logs table.
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Garage Gym Session';
  doc.getElementById('manualNameInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(60);
  console.log('Planned workout shows on Home right after creating it:', doc.getElementById('sessionCard').textContent.includes('Garage Gym Session') ? 'OK' : 'FAIL');
  console.log('Planned workout synced to the cloud:', Object.values(backend.db.workout_logs).some(r=>r.planned_title==='Garage Gym Session') ? 'OK' : 'FAIL');

  // Sign out, then sign back in -- all within the SAME window/session (no page reload), which is
  // exactly the reported bug: the workout used to vanish from Home until a browser refresh.
  goPill('settings');
  await wait(20);
  doc.getElementById('signOutBtn').click();
  await wait(60);
  console.log('Signed out -- back on the Welcome/onboarding flow:', doc.getElementById('screen-welcome').hidden===false ? 'OK' : 'FAIL');

  goPill('onb-account');
  await wait(20);
  doc.getElementById('toggleAuthMode').click(); // switch to Sign In mode
  doc.getElementById('emailInput').value = 'runner@example.com';
  doc.getElementById('emailInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('passwordInput').value = 'hunter22';
  doc.getElementById('passwordInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('emailSignupBtn').click();
  await wait(120);

  console.log('Signing back in lands directly on Home (no loading-screen detour):', doc.getElementById('screen-home').hidden===false ? 'OK' : `FAIL (${SCREEN_currently_visible(doc)})`);
  console.log('The planned workout is visible immediately after signing back in -- no refresh needed:',
    doc.getElementById('sessionCard').textContent.includes('Garage Gym Session') ? 'OK' : `FAIL (${doc.getElementById('sessionCard').textContent})`);

  function SCREEN_currently_visible(doc){
    const el = [...doc.querySelectorAll('.screen')].find(s=>!s.hidden);
    return el ? el.id : 'none';
  }

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
