const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for a reported bug: a day logged as done (via "+ Create Workout" with "Mark as
// Completed" on, the same flow used to log a real workout after the fact) while it was still
// "today" showed correctly as done on Calendar/Progress/Plan the next day, but still showed as a
// red "missed" cell in Home's own week strip. Root cause: dayStatus() (which only the week strip
// uses) read state.week[i].completed directly for non-today days, never consulting the day's
// manualEntries/completedOverride -- while every other screen (Calendar/Progress/Plan/Day Detail)
// goes through getDayData(), which does. Once a new day arrives, buildWeek() resets a past day's
// plan slot to a blank Rest Day by default (real behavior, not part of this bug) -- getDayData()
// correctly still reports it done via the surviving manual entry, but the week strip's separate,
// simpler status function had no such fallback at all.
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
          if(single){
            const row = Object.values(db.workout_logs).find(matchRow);
            return {data: row || null, error:null};
          }
          const rows = Object.values(db.workout_logs).filter(matchRow).map(r => ({
            log_date: r.log_date, completed_override: r.completed_override,
            planned_type: null, planned_title: null, planned_detail: null,
            planned_interval_rounds: null, planned_interval_work_sec: null, planned_interval_rest_sec: null,
            actual_run_distance: null,
            manual_entries: Object.values(db.manual_entries).filter(e=>e.workout_log_id===r.id)
              .map(e=>({id:e.id, name:e.name, type:e.type, volume:e.volume, notes:e.notes})),
          }));
          return {data: rows, error:null};
        }
        if(table==='manual_entries' && pendingInsert){
          const id = newId(); db.manual_entries[id] = {id, ...pendingInsert};
          return {data:{id}, error:null};
        }
        if(table==='planned_workouts' || table==='progression_targets' || table==='personal_records'){
          const f = filters.find(x=>x[0]==='user_id');
          return {data: [], error:null};
        }
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
function openSession(backend, todayStr){
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){
      window.supabase = { createClient: () => backend.createClient() };
      window.__ALTIRO_TEST_TODAY__ = todayStr;
    },
  });
}

(async () => {
  const backend = makeBackend();

  // ---- Session A: Monday is "today" -- log a workout for it via "+ Create Workout" (Mark as
  // Completed stays on, the default) -- the same flow used to record something after the fact. ----
  const domA = openSession(backend, '2026-09-21'); // Monday
  await wait(80);
  const docA = domA.window.document;
  const goPillA = id => [...docA.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillA('onb-account');
  await wait(20);
  docA.getElementById('emailInput').value = 'weekstrip@example.com';
  docA.getElementById('emailInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('passwordInput').value = 'hunter22';
  docA.getElementById('passwordInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('emailSignupBtn').click();
  await wait(80);

  goPillA('home');
  await wait(20);
  docA.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  docA.getElementById('manualNameInput').value = 'Morning Strength Session';
  docA.getElementById('manualNameInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  // Create Workout always defaults to "just planned" now -- mark it done so this becomes a real
  // logged entry (manual_entries), which is what this test round-trips through the cloud.
  if(!docA.getElementById('createCompletedToggle').classList.contains('on')) docA.getElementById('createCompletedToggle').click();
  docA.getElementById('saveManualEntry').click();
  await wait(60);
  console.log('Session A (Monday=today): logged workout synced to the cloud:',
    Object.values(backend.db.manual_entries).some(e=>e.name==='Morning Strength Session') ? 'OK' : 'FAIL');

  // ---- Session B: a new day has arrived (Tuesday is "today"); Monday is now in the past but
  // still within the same current week. Sign in fresh and check the week strip. ----
  const domB = openSession(backend, '2026-09-22'); // Tuesday
  await wait(80);
  const docB = domB.window.document;
  const goPillB = id => [...docB.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillB('onb-account');
  await wait(20);
  docB.getElementById('toggleAuthMode').click();
  docB.getElementById('emailInput').value = 'weekstrip@example.com';
  docB.getElementById('emailInput').dispatchEvent(new domB.window.Event('input', {bubbles:true}));
  docB.getElementById('passwordInput').value = 'hunter22';
  docB.getElementById('passwordInput').dispatchEvent(new domB.window.Event('input', {bubbles:true}));
  docB.getElementById('emailSignupBtn').click();
  await wait(100);

  goPillB('home');
  await wait(20);
  const monCell = docB.querySelector('#weekStrip .day-cell[data-day="0"]'); // Mon = index 0
  console.log('Session B (Tuesday=today): Monday\'s week-strip cell is marked DONE, not missed:',
    monCell.classList.contains('done') ? 'OK' : `FAIL (classes: ${monCell.className})`);
  console.log('Session B: Monday\'s week-strip cell is NOT marked missed:',
    !monCell.classList.contains('missed') ? 'OK' : `FAIL (classes: ${monCell.className})`);

  // Calendar already got this right before the fix (it goes through getDayData()) -- confirm it
  // still agrees, so the fix brought the week strip in line rather than breaking Calendar's math.
  goPillB('calendar');
  await wait(20);
  const monDateCell = docB.querySelector('#calGrid .mo-cell[data-date="2026-09-21"]');
  console.log('Calendar still agrees Monday is done:', monDateCell && monDateCell.classList.contains('done') ? 'OK' : `FAIL (${monDateCell ? monDateCell.className : 'not found'})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
