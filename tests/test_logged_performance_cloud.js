const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// What's logged in Log Performance is saved on the workout itself (workout_logs.performance for the
// day's own plan, manual_entries.performance for a logged entry) and comes back on a fresh sign-in --
// so tapping a done workout on another device/session still shows exactly what was logged, not just
// the plan's targets.
function makeBackend(){
  const db = { profiles:{}, workout_logs:{}, manual_entries:{} };
  const authUsers = {};
  let nextId = 1;
  const newId = () => 'id' + (nextId++);
  function createClient(){
    let currentUser = null;
    function from(table){
      let filters = [], pendingInsert=null, pendingUpdate=null;
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
          if(single) return {data: Object.values(db.workout_logs).find(matchRow) || null, error:null};
          return {data: Object.values(db.workout_logs).filter(matchRow).map(r => ({
            log_date: r.log_date, completed_override: r.completed_override,
            planned_type: r.planned_type||null, planned_title: r.planned_title||null, planned_detail: r.planned_detail||null,
            planned_interval_rounds: null, planned_interval_work_sec: null, planned_interval_rest_sec: null,
            actual_run_distance: r.actual_run_distance ?? null, performance: r.performance ?? null,
            manual_entries: Object.values(db.manual_entries).filter(e=>e.workout_log_id===r.id)
              .map(e=>({id:e.id, name:e.name, type:e.type, volume:e.volume, notes:e.notes, distance:null, duration_min:null, performance: e.performance ?? null})),
          })), error:null};
        }
        if(table==='manual_entries'){
          if(pendingInsert){ const id = newId(); db.manual_entries[id] = {id, ...pendingInsert}; return {data:{id}, error:null}; }
          if(pendingUpdate){
            const f = filters.find(x=>x[0]==='id');
            if(f && db.manual_entries[f[1]]) Object.assign(db.manual_entries[f[1]], pendingUpdate);
            return {data:null, error:null};
          }
        }
        if(['planned_workouts','progression_targets','personal_records','recorded_sessions'].includes(table)) return {data: [], error:null};
        return {data:null, error:{message:'mock: unhandled '+table}};
      }
      const api = {
        select(){ return api; }, eq(c,v){ filters.push([c,v]); return api; },
        insert(p){ pendingInsert=p; return api; }, update(p){ pendingUpdate=p; return api; },
        upsert(){ return api; }, delete(){ return api; },
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
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){
      window.supabase = { createClient: () => backend.createClient() };
      window.__ALTIRO_TEST_TODAY__ = '2026-09-18';
    },
  });
}
async function signIn(dom, mode){
  const doc = dom.window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'onb-account').click();
  await wait(20);
  if(mode==='signin') doc.getElementById('toggleAuthMode').click();
  doc.getElementById('emailInput').value = 'perf@example.com';
  doc.getElementById('emailInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('passwordInput').value = 'hunter22';
  doc.getElementById('passwordInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('emailSignupBtn').click();
  await wait(120);
}

(async () => {
  const backend = makeBackend();

  // ---- Session A: log a past day's planned workout, and a logged entry's performance ----
  const domA = openSession(backend);
  await wait(80);
  await signIn(domA, 'signup');
  const docA = domA.window.document;
  const goA = id => [...docA.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goA('calendar');
  await wait(20);
  docA.querySelector('.mo-cell[data-date="2026-09-16"]').click(); // Wednesday, past
  await wait(20);
  docA.getElementById('addWorkoutBtn').click();
  await wait(20);
  docA.getElementById('manualNameInput').value = 'Midweek Lift';
  docA.getElementById('manualNameInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  [...docA.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
  if(docA.getElementById('createCompletedToggle').classList.contains('on')) docA.getElementById('createCompletedToggle').click();
  docA.getElementById('saveManualEntry').click();
  await wait(60);
  docA.getElementById('dayDetailPlanRow').click();
  await wait(20);
  docA.getElementById('logPerfWeightInput').value = '185';
  docA.getElementById('logPerfRepsInput').value = '6';
  docA.getElementById('logPerfNotesInput').value = 'Heavy day';
  docA.getElementById('saveLogPerf').click();
  await wait(60);
  const wedRow = Object.values(backend.db.workout_logs).find(r=>r.log_date==='2026-09-16');
  console.log('Session A: the plan\'s logged performance was saved on its workout_logs row:', wedRow && wedRow.performance && wedRow.performance.weight===185 ? 'OK' : `FAIL (${JSON.stringify(wedRow && wedRow.performance)})`);
  docA.getElementById('closeDayDetail').click();
  await wait(10);

  docA.querySelector('.mo-cell[data-date="2026-09-17"]').click(); // Thursday, past
  await wait(20);
  docA.getElementById('addWorkoutBtn').click();
  await wait(20);
  docA.getElementById('manualNameInput').value = 'Push-ups';
  docA.getElementById('manualNameInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  if(!docA.getElementById('createCompletedToggle').classList.contains('on')) docA.getElementById('createCompletedToggle').click();
  docA.getElementById('saveManualEntry').click();
  await wait(60);
  docA.querySelector('#dayDetailEntries [data-entry-id]').click();
  await wait(20);
  docA.getElementById('logPerfWeightInput').value = '0';
  docA.getElementById('logPerfRepsInput').value = '50';
  docA.getElementById('saveLogPerf').click();
  await wait(60);
  const entryRow = Object.values(backend.db.manual_entries).find(e=>e.name==='Push-ups');
  console.log('Session A: the logged entry\'s performance was saved on its manual_entries row:', entryRow && entryRow.performance && entryRow.performance.reps===50 ? 'OK' : `FAIL (${JSON.stringify(entryRow && entryRow.performance)})`);

  // ---- Session B: fresh sign-in -- both come back ----
  const domB = openSession(backend);
  await wait(80);
  await signIn(domB, 'signin');
  const docB = domB.window.document;
  const goB = id => [...docB.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  goB('calendar');
  await wait(20);
  docB.querySelector('.mo-cell[data-date="2026-09-16"]').click();
  await wait(20);
  docB.getElementById('dayDetailPlanRow').click();
  await wait(20);
  console.log('Session B: reopening the past workout shows what was logged (185 x 6):',
    docB.getElementById('logPerfWeightInput').value==='185' && docB.getElementById('logPerfRepsInput').value==='6' ? 'OK' : `FAIL (${docB.getElementById('logPerfWeightInput').value} x ${docB.getElementById('logPerfRepsInput').value})`);
  console.log('Session B: ...and its notes:', docB.getElementById('logPerfNotesInput').value==='Heavy day' ? 'OK' : `FAIL (${docB.getElementById('logPerfNotesInput').value})`);
  docB.getElementById('closeLogPerf').click();
  docB.getElementById('closeDayDetail').click();
  await wait(10);
  docB.querySelector('.mo-cell[data-date="2026-09-17"]').click();
  await wait(20);
  docB.querySelector('#dayDetailEntries [data-entry-id]').click();
  await wait(20);
  console.log('Session B: reopening the logged entry shows its logged reps (50):', docB.getElementById('logPerfRepsInput').value==='50' ? 'OK' : `FAIL (${docB.getElementById('logPerfRepsInput').value})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
