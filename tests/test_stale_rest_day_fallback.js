const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for a reported bug: a day showed as "Rest Day" (with the red has-log dot right
// next to it) even though it had a real, completed logged workout. Root cause: promotePrimaryFromLog
// only runs at the moment a NEW manual entry is created -- it can't retroactively fix a workout_logs
// row that already has manual_entries but no planned_type, which happens for (a) any entry logged
// before that fix shipped, and (b) entries filed onto a date via the cardio-log "move to a different
// day" path, which never calls promotePrimaryFromLog either. This simulates exactly that shape of
// stale data and confirms getDayData()'s fallback (fall back to the first logged entry as the day's
// content whenever the primary is still "rest" but something was actually logged) fixes it.
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

  // ---- Session A: sign up, log a completed workout on a rest day (Saturday, future) ----
  const domA = openSession(backend, '2026-09-18'); // Friday
  await wait(80);
  const docA = domA.window.document;
  const goPillA = id => [...docA.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillA('onb-account');
  await wait(20);
  docA.getElementById('emailInput').value = 'staledata@example.com';
  docA.getElementById('emailInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('passwordInput').value = 'hunter22';
  docA.getElementById('passwordInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('emailSignupBtn').click();
  await wait(80);

  goPillA('home');
  await wait(20);
  docA.querySelector('#weekStrip .day-cell[data-day="5"]').click(); // Saturday, future rest day
  await wait(20);
  docA.getElementById('addWorkoutBtn').click();
  await wait(20);
  if(!docA.getElementById('createCompletedToggle').classList.contains('on')) docA.getElementById('createCompletedToggle').click();
  docA.getElementById('manualNameInput').value = 'Long Trail Run';
  docA.getElementById('manualNameInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  [...docA.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  docA.getElementById('saveManualEntry').click();
  await wait(60);

  const savedRow = Object.values(backend.db.workout_logs).find(r=>r.log_date==='2026-09-19');
  console.log('Sanity: the entry synced with a promoted planned_type (current behavior):', !!(savedRow && savedRow.planned_type) ? 'OK' : 'FAIL');

  // ---- Simulate STALE data: strip the promoted planned_type/title, as if this row had been
  // created before promotePrimaryFromLog existed (or via a path that never sets it) -- the
  // manual_entries row itself (the real record of what happened) is untouched. ----
  savedRow.planned_type = null;
  savedRow.planned_title = null;
  savedRow.planned_detail = null;
  console.log('Simulated stale row: no planned_type, but manual_entries still present:',
    !savedRow.planned_type && Object.values(backend.db.manual_entries).some(e=>e.workout_log_id===savedRow.id) ? 'OK' : 'FAIL');

  // ---- Session B: fresh sign-in loads this stale row -- getDayData()'s fallback should still show
  // the real logged workout instead of "Rest Day". ----
  const domB = openSession(backend, '2026-09-18');
  await wait(80);
  const docB = domB.window.document;
  const goPillB = id => [...docB.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillB('onb-account');
  await wait(20);
  docB.getElementById('toggleAuthMode').click();
  docB.getElementById('emailInput').value = 'staledata@example.com';
  docB.getElementById('emailInput').dispatchEvent(new domB.window.Event('input', {bubbles:true}));
  docB.getElementById('passwordInput').value = 'hunter22';
  docB.getElementById('passwordInput').dispatchEvent(new domB.window.Event('input', {bubbles:true}));
  docB.getElementById('emailSignupBtn').click();
  await wait(100);

  goPillB('week');
  await wait(20);
  const satRow = docB.getElementById('weekList').querySelector('.plan-row[data-day="5"][data-week-idx="0"]');
  console.log('Plan row shows the real logged workout, not "Rest Day":', satRow.querySelector('.prow-title').textContent==='Long Trail Run' ? 'OK' : `FAIL (${satRow.querySelector('.prow-title').textContent})`);
  console.log('Plan row shows the done checkmark badge:', !!satRow.querySelector('.prow-status.done') ? 'OK' : 'FAIL');

  docB.querySelector('#weekStrip .day-cell[data-day="5"]')?.click();
  goPillB('home');
  await wait(20);
  docB.querySelector('#weekStrip .day-cell[data-day="5"]').click();
  await wait(20);
  const planRowText = docB.getElementById('dayDetailPlanRow').textContent;
  console.log('Day Detail shows the real logged workout, not "Rest Day":', planRowText.includes('Long Trail Run') ? 'OK' : `FAIL (${planRowText})`);
  console.log('Day Detail plan row is the full editable bubble (not the plain-text empty-day style):',
    docB.getElementById('dayDetailPlanRow').className!=='day-row-empty' ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
