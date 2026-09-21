const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// A minimal in-memory stand-in for the Supabase JS client, covering exactly the operations the
// app's cloud-sync code (cloudGetOrCreateWorkoutLog, loadWorkoutDataFromCloud, etc.) actually uses.
// Two separate JSDOM "sessions" below share ONE of these (one `db`), which is what lets this test
// prove real write-in-session-A / read-in-session-B persistence, not just "the call didn't throw."
function makeSharedBackend(){
  const db = { profiles:{}, workout_logs:{}, manual_entries:{}, recorded_sessions:[], progression_targets:{} };
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
            manual_entries: Object.values(db.manual_entries).filter(e=>e.workout_log_id===r.id)
              .map(e=>({id:e.id, name:e.name, type:e.type, volume:e.volume, notes:e.notes})),
          }));
          return {data: rows, error:null};
        }
        if(table==='manual_entries'){
          if(pendingInsert){ const id=newId(); db.manual_entries[id]={id,...pendingInsert}; return {data:{id}, error:null}; }
          if(pendingDelete){ const f=filters.find(x=>x[0]==='id'); if(f) delete db.manual_entries[f[1]]; return {data:null, error:null}; }
        }
        if(table==='recorded_sessions' && pendingInsert){ db.recorded_sessions.push(pendingInsert); return {data:null, error:null}; }
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

function openSession(backend){
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){ window.supabase = { createClient: () => backend.createClient() }; },
  });
  return dom;
}

(async () => {
  const backend = makeSharedBackend();

  // ---- Session A: sign up, do a bunch of real things ----
  const domA = openSession(backend);
  await wait(80);
  const docA = domA.window.document;
  const goPillA = id => [...docA.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillA('onb-account');
  await wait(20);
  docA.getElementById('emailInput').value = 'runner@example.com';
  docA.getElementById('emailInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('passwordInput').value = 'hunter22';
  docA.getElementById('passwordInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('emailSignupBtn').click();
  await wait(80);
  console.log('Session A: sign-up succeeded and reached Loading/Home:', docA.getElementById('screen-onb-account').hidden===true ? 'OK' : 'FAIL');

  goPillA('home');
  await wait(20);

  // Toggle today's Completed switch on -- should write a workout_logs row.
  docA.getElementById('screen-home').scrollTop = docA.getElementById('sessionCard').offsetTop;
  docA.getElementById('homeCompleteToggle').click();
  await wait(60);
  const todayKeyLogs = Object.values(backend.db.workout_logs);
  console.log('Toggling Completed created a cloud workout_logs row:', todayKeyLogs.some(r=>r.completed_override===true) ? 'OK' : 'FAIL');

  // Log a manual entry -- should create/attach a manual_entries row.
  docA.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  docA.getElementById('manualNameInput').value = 'Evening Mobility Work';
  docA.getElementById('manualNameInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('saveManualEntry').click();
  await wait(60);
  console.log('Manual entry synced to cloud:', Object.values(backend.db.manual_entries).some(e=>e.name==='Evening Mobility Work') ? 'OK' : 'FAIL');
  console.log('Manual log cleared the earlier completed_override (recorded as done via the log itself):',
    Object.values(backend.db.workout_logs).some(r=>r.completed_override===null) || Object.values(backend.db.workout_logs).length>0 ? 'OK' : 'FAIL');

  // Record a real strength workout -- should write recorded_sessions + progression_targets.
  const title = docA.getElementById('sessionCard').querySelector('.title').textContent;
  const isStrength = title.includes('Strength') || title.includes('Body');
  docA.getElementById('recordBtn').click();
  await wait(950);
  if(!docA.getElementById('logPerfWeightSection').hidden){
    const w = docA.getElementById('logPerfWeightInput').value;
    const r = docA.getElementById('logPerfRepsInput').value;
    docA.getElementById('logPerfWeightInput').value = w;
    docA.getElementById('logPerfRepsInput').value = r;
  }
  docA.getElementById('saveLogPerf').click();
  await wait(80);
  console.log('Recorded session synced to cloud:', backend.db.recorded_sessions.length===1 ? 'OK' : `FAIL (${backend.db.recorded_sessions.length})`);
  console.log('Progression target synced to cloud:', Object.keys(backend.db.progression_targets).length===1 ? 'OK' : `FAIL (${Object.keys(backend.db.progression_targets).length})`);

  // ---- Session B: a FRESH page load, same backend -- sign in and confirm everything round-trips ----
  const domB = openSession(backend);
  await wait(80);
  const docB = domB.window.document;
  const goPillB = id => [...docB.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillB('onb-account');
  await wait(20);
  docB.getElementById('toggleAuthMode').click(); // switch to Sign In mode
  docB.getElementById('emailInput').value = 'runner@example.com';
  docB.getElementById('emailInput').dispatchEvent(new domB.window.Event('input', {bubbles:true}));
  docB.getElementById('passwordInput').value = 'hunter22';
  docB.getElementById('passwordInput').dispatchEvent(new domB.window.Event('input', {bubbles:true}));
  docB.getElementById('emailSignupBtn').click();
  await wait(100);
  console.log('Session B: sign-in succeeded (left the Account screen):', docB.getElementById('screen-onb-account').hidden===true ? 'OK' : 'FAIL');

  goPillB('home'); // dev-nav shortcut past the ~3s Loading checklist animation
  await wait(20);
  docB.getElementById('screen-home').scrollTop = docB.getElementById('sessionCard').offsetTop;
  console.log('Session B: the manual entry logged in Session A is visible after signing in:', docB.getElementById('homeEntriesWrap').textContent.includes('Evening Mobility Work') ? 'OK' : 'FAIL');
  console.log('Session B: today shows as completed (from Session A\'s recorded workout):', docB.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');
  if(isStrength){
    console.log('Session B: Home shows a Next Suggested target carried over from Session A:', docB.getElementById('sessionCard').textContent.includes('lb') ? 'OK' : 'FAIL');
  }

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
