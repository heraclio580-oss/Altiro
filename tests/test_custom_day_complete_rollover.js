const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for the actual root cause behind a reported bug: a CUSTOM-planned day (created
// via "+ Create Workout" in planning mode, then separately marked done via the Completed toggle
// while it was still "today") showed correctly as done on Calendar/Progress the next day, but red/
// "missed" on Home's own week strip. Root cause, found while investigating: loadWorkoutDataFromCloud()
// mirrored completed_override onto state.week[idx].completed, but then the customSession block ran
// AFTER it and unconditionally reset state.week[idx].completed back to false -- clobbering the
// mirror for any custom day that really was completed. getDayData() (Calendar/Progress/Day Detail)
// separately re-checks completedOverride off dayLog and got it right regardless; the week strip's
// dayStatus() only trusted state.week[idx].completed, so it alone showed the clobbered value.
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
            planned_type: r.planned_type||null, planned_title: r.planned_title||null, planned_detail: r.planned_detail||null,
            planned_interval_rounds: r.planned_interval_rounds ?? null,
            planned_interval_work_sec: r.planned_interval_work_sec ?? null,
            planned_interval_rest_sec: r.planned_interval_rest_sec ?? null,
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

  // ---- Session A: Monday is "today" -- plan a CUSTOM workout for it, then separately mark it done. ----
  const domA = openSession(backend, '2026-09-21'); // Monday
  await wait(80);
  const docA = domA.window.document;
  const goPillA = id => [...docA.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillA('onb-account');
  await wait(20);
  docA.getElementById('emailInput').value = 'customrollover@example.com';
  docA.getElementById('emailInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('passwordInput').value = 'hunter22';
  docA.getElementById('passwordInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('emailSignupBtn').click();
  await wait(80);

  goPillA('home');
  await wait(20);
  // "+ Create Workout" defaults to Mark as Completed OFF -> planning mode -> becomes today's
  // CUSTOM primary session (not an instant manual-entry log).
  docA.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  if(docA.getElementById('createCompletedToggle').classList.contains('on')) docA.getElementById('createCompletedToggle').click();
  docA.getElementById('manualNameInput').value = 'Custom Push Day';
  docA.getElementById('manualNameInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  [...docA.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='strength').click();
  docA.getElementById('saveManualEntry').click();
  await wait(60);
  console.log('Session A: custom plan for today synced (planned_type set):',
    Object.values(backend.db.workout_logs).some(r=>r.planned_type==='strength' && r.planned_title==='Custom Push Day') ? 'OK' : 'FAIL');

  // Now separately mark today done via the Completed toggle (a realistic two-step flow: plan it,
  // then check it off once actually done).
  docA.getElementById('screen-home').scrollTop = docA.getElementById('sessionCard').offsetTop;
  docA.getElementById('homeCompleteToggle').click();
  await wait(60);
  console.log('Session A: Completed toggle synced to the cloud:',
    Object.values(backend.db.workout_logs).some(r=>r.completed_override===true) ? 'OK' : 'FAIL');

  // ---- Session B: a new day has arrived (Tuesday is "today"); Monday is now in the past but
  // still within the same current week. Sign in fresh and check the week strip. ----
  const domB = openSession(backend, '2026-09-22'); // Tuesday
  await wait(80);
  const docB = domB.window.document;
  const goPillB = id => [...docB.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillB('onb-account');
  await wait(20);
  docB.getElementById('toggleAuthMode').click();
  docB.getElementById('emailInput').value = 'customrollover@example.com';
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

  goPillB('calendar');
  await wait(20);
  const monDateCell = docB.querySelector('#calGrid .mo-cell[data-date="2026-09-21"]');
  console.log('Calendar agrees Monday is done:', monDateCell && monDateCell.classList.contains('done') ? 'OK' : `FAIL (${monDateCell ? monDateCell.className : 'not found'})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
