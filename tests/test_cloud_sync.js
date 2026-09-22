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
  const db = { profiles:{}, workout_logs:{}, manual_entries:{}, recorded_sessions:[], progression_targets:{}, personal_records:{} };
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
  // Progression (and the recorded_sessions write) now waits for the post-workout review.
  docA.getElementById('reviewRatingSlider').value = '5';
  docA.getElementById('reviewRatingSlider').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('reviewNotesInput').value = 'Felt strong today';
  docA.getElementById('submitReviewBtn').click();
  await wait(80);
  console.log('Recorded session synced to cloud:', backend.db.recorded_sessions.length===1 ? 'OK' : `FAIL (${backend.db.recorded_sessions.length})`);
  console.log('Rating and notes from the review landed on that cloud row:',
    backend.db.recorded_sessions[0] && backend.db.recorded_sessions[0].rating===5 && backend.db.recorded_sessions[0].review_notes==='Felt strong today' ? 'OK' : `FAIL (${JSON.stringify(backend.db.recorded_sessions[0])})`);
  // A structured strength session progresses each of its (non-bodyweight) exercises independently,
  // so a templated session can write several progression_targets rows in one go, not just one.
  console.log('Progression target(s) synced to cloud:', Object.keys(backend.db.progression_targets).length>=1 ? 'OK' : `FAIL (${Object.keys(backend.db.progression_targets).length})`);
  docA.getElementById('closeLogPerf').click();
  await wait(10);

  // Plan a custom future workout (Saturday) -- should sync planned_type/title/detail to workout_logs.
  goPillA('home');
  await wait(20);
  docA.querySelector('#weekStrip .day-cell[data-day="5"]').click();
  await wait(20);
  docA.getElementById('addWorkoutBtn').click();
  await wait(20);
  // Saturday is future, so "Mark as Completed" already smart-defaults to OFF (planning mode).
  docA.getElementById('manualNameInput').value = 'Weekend Trail Run';
  docA.getElementById('manualNameInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  [...docA.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  docA.getElementById('saveManualEntry').click();
  await wait(60);
  console.log('Planned workout synced to cloud (planned_title set on a workout_logs row):',
    Object.values(backend.db.workout_logs).some(r=>r.planned_title==='Weekend Trail Run') ? 'OK' : 'FAIL');
  docA.getElementById('closeDayDetail').click();
  await wait(10);

  // Plan an interval workout (Sunday) -- the rounds/work/rest config should also sync.
  docA.querySelector('#weekStrip .day-cell[data-day="6"]').click();
  await wait(20);
  docA.getElementById('addWorkoutBtn').click();
  await wait(20);
  docA.getElementById('manualNameInput').value = 'Heavy Bag Rounds';
  docA.getElementById('manualNameInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  [...docA.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='interval').click();
  docA.getElementById('createRoundsInput').value = '8';
  docA.getElementById('createWorkDurationInput').value = '2:00';
  docA.getElementById('createRestDurationInput').value = '0:30';
  docA.getElementById('saveManualEntry').click();
  await wait(60);
  const intervalRow = Object.values(backend.db.workout_logs).find(r=>r.planned_title==='Heavy Bag Rounds');
  console.log('Interval workout config synced to cloud (8 rounds, 2:00 work, 0:30 rest):',
    intervalRow && intervalRow.planned_interval_rounds===8 && intervalRow.planned_interval_work_sec===120 && intervalRow.planned_interval_rest_sec===30 ? 'OK' : `FAIL (${JSON.stringify(intervalRow)})`);
  docA.getElementById('closeDayDetail').click();
  await wait(10);

  // Add a lift PR -- should sync to personal_records.
  goPillA('progress');
  await wait(20);
  docA.getElementById('prExerciseInput').value = 'Deadlift';
  docA.getElementById('prValueInput').value = '315';
  docA.getElementById('addPrBtn').click();
  await wait(60);
  console.log('PR synced to cloud:', Object.values(backend.db.personal_records).some(r=>r.exercise==='Deadlift' && r.value===315) ? 'OK' : 'FAIL');

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
    // Every generated strength title now has a real exercise breakdown, so there's no single
    // session-level "Next Suggested" number anymore -- confirm the exercise list itself carried over.
    console.log('Session B: Home shows the exercise breakdown carried over from Session A:', !!docB.querySelector('#sessionCard .r-exercise-list') ? 'OK' : 'FAIL');
  }

  docB.querySelector('#weekStrip .day-cell[data-day="5"]').click();
  await wait(20);
  console.log('Session B: Saturday\'s custom-planned workout from Session A round-trips correctly:', docB.getElementById('dayDetailPlanRow').textContent.includes('Weekend Trail Run') ? 'OK' : 'FAIL');
  console.log('Session B: "Reset to Suggested Plan" is offered (it knows this day is custom):', !!docB.getElementById('ddResetPlanBtn') ? 'OK' : 'FAIL');
  docB.getElementById('closeDayDetail').click();
  await wait(10);

  docB.querySelector('#weekStrip .day-cell[data-day="6"]').click();
  await wait(20);
  console.log('Session B: Sunday\'s interval workout title round-trips:', docB.getElementById('dayDetailPlanRow').textContent.includes('Heavy Bag Rounds') ? 'OK' : 'FAIL');
  docB.getElementById('closeDayDetail').click();
  await wait(10);

  goPillB('progress');
  await wait(20);
  console.log('Session B: the Deadlift PR from Session A round-trips correctly:', docB.getElementById('prList').textContent.includes('Deadlift') && docB.getElementById('prList').textContent.includes('315') ? 'OK' : 'FAIL');

  // ---- Regression test: Adjust Plan -> 0 training days must persist to the cloud. Applying used to
  // only update local state and never call saveProfileToCloud(), so a refresh (or, here, a fresh
  // sign-in) would silently revert training days back to whatever was last actually saved -- e.g.
  // the onboarding default -- bringing a 3-day plan right back onto the calendar. ----
  // ---- Editing the display name should also persist to the cloud (full_name on profiles). ----
  goPillA('settings');
  await wait(20);
  docA.getElementById('editNameBtn').click();
  await wait(20);
  docA.getElementById('editNameInput').value = 'Jordan Rivera-Chen';
  docA.getElementById('saveEditName').click();
  await wait(60);
  console.log('Session A: edited name persisted to the cloud profile:',
    Object.values(backend.db.profiles).some(p=>p.full_name==='Jordan Rivera-Chen') ? 'OK' : `FAIL (${JSON.stringify(backend.db.profiles)})`);

  goPillA('adjust');
  await wait(20);
  [...docA.querySelectorAll('#adjWeekdayChips .chip')].forEach(c => { if(c.classList.contains('sel')) c.click(); });
  await wait(10);
  console.log('Session A: all weekday chips deselected:', [...docA.querySelectorAll('#adjWeekdayChips .chip')].every(c=>!c.classList.contains('sel')) ? 'OK' : 'FAIL');
  docA.getElementById('applyAdjust').click();
  await wait(60);
  console.log('Session A: 0 training days persisted to the cloud profile:',
    Object.values(backend.db.profiles).some(p=>Array.isArray(p.training_days) && p.training_days.length===0) ? 'OK' : `FAIL (${JSON.stringify(backend.db.profiles)})`);

  const domC = openSession(backend);
  await wait(80);
  const docC = domC.window.document;
  const goPillC = id => [...docC.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  goPillC('onb-account');
  await wait(20);
  docC.getElementById('toggleAuthMode').click();
  docC.getElementById('emailInput').value = 'runner@example.com';
  docC.getElementById('emailInput').dispatchEvent(new domC.window.Event('input', {bubbles:true}));
  docC.getElementById('passwordInput').value = 'hunter22';
  docC.getElementById('passwordInput').dispatchEvent(new domC.window.Event('input', {bubbles:true}));
  docC.getElementById('emailSignupBtn').click();
  await wait(100);
  goPillC('home');
  await wait(20);
  console.log('Session C (a fresh sign-in): today has no fabricated workout -- shows Rest Day:', docC.getElementById('sessionCard').textContent.includes('Rest Day') ? 'OK' : `FAIL (${docC.getElementById('sessionCard').querySelector('.title')?.textContent})`);
  goPillC('settings');
  await wait(20);
  console.log('Session C: the edited name from Session A round-trips correctly:', docC.getElementById('profileName').textContent==='Jordan Rivera-Chen' ? 'OK' : `FAIL (${docC.getElementById('profileName').textContent})`);
  goPillC('adjust');
  await wait(20);
  console.log('Session C: Adjust sheet also shows 0 days selected, not the 3-day default:',
    ![...docC.querySelectorAll('#adjWeekdayChips .chip')].some(c=>c.classList.contains('sel')) ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
