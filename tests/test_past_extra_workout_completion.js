const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for a reported bug: an "Additional Workout" (extraWorkouts -- the multi-workout-
// per-day feature) built with real exercises/sets for a day already in the past never showed up as
// done anywhere -- not Calendar, not Progress, not the day's own Plan row. Root cause: an extra
// workout can ONLY ever be created through the "just planning" path (the "Mark as Completed" toggle
// simply doesn't apply to it -- see planCustomWorkout()/the save handler), and it has NO completion
// UI at all outside of today (the live Start Workout/Log Performance flow is today-only). So a past
// day's extra was permanently stuck incomplete with no path to ever counting, no matter how it got
// there. The day's own PRIMARY slot is unaffected by this fix and still faithfully respects
// whatever the "Mark as Completed" toggle said, even for a past date -- deliberately leaving a past
// primary NOT done is how a real missed workout gets recorded at all (see test_missed_day_draggable),
// so past-day auto-completion only makes sense for extras, which have no such toggle to respect.
//
// Covers: (1) a NEW extra workout created for a past day now auto-completes, while a brand-new
// PRIMARY for the same day still respects the toggle (stays not-done); (2) the new "Mark Done"/
// "Completed" control on a past day's extra toggles both ways, not just a one-way completion; and
// (3) an ALREADY-stuck incomplete extra from before this fix (simulated stale cloud data, same
// convention as test_stale_rest_day_fallback.js) can be fixed the same way.
(async () => {
  await wait(50);
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-27'; } }); // Sunday
  const { window } = dom;
  const doc = window.document;
  await wait(50);
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  // Friday Sep 25 is 2 days before today (a Sunday) -- within Home's rolling week-strip window.
  doc.querySelector('#weekStrip .day-cell[data-date="2026-09-25"]').click();
  await wait(20);
  console.log('Day Detail opened for the past Friday:', doc.getElementById('dayDetailTitle').textContent.includes('Sep 25') ? 'OK' : `FAIL (${doc.getElementById('dayDetailTitle').textContent})`);

  // A brand-new custom primary, toggle left OFF (planning-mode, as the create flow always defaults)
  // -- even for a day that's already over, this must stay NOT done, exactly like any other planned
  // workout that was never marked complete (a real "missed" record, not a bug).
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Morning Jog';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  if(doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  console.log('A new past-day PRIMARY still respects the toggle and stays NOT done:', doc.querySelector('#dayDetailPlanRow .stpill')?.textContent.trim()!=='Done' ? 'OK' : `FAIL (${doc.querySelector('#dayDetailPlanRow .stpill')?.textContent})`);

  // A SECOND workout for that same (now-custom) day goes into "Additional Workouts" -- THIS is the
  // one that should auto-complete, since it has no toggle of its own to respect in the first place.
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Chest';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='strength').click();
  if(doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  const extraText = doc.getElementById('dayDetailExtraWorkouts').textContent;
  console.log('New past-day "Additional Workout" auto-completes:', extraText.includes('Chest') && extraText.includes('Completed') ? 'OK' : `FAIL (${extraText})`);

  goPill('calendar');
  await wait(20);
  const cell = doc.querySelector('#calGrid .mo-cell[data-date="2026-09-25"]');
  // The completed extra doesn't finish the day's own (not done) jog.
  console.log('Calendar cell for that Friday still shows its jog missed (the completed extra doesn\'t finish it):', cell && cell.classList.contains('missed') && !cell.classList.contains('done') ? 'OK' : `FAIL (${cell ? cell.className : 'not found'})`);

  // The "Completed" control on a past extra is still a toggle, not a one-way door -- undo a mistake.
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-date="2026-09-25"]').click();
  await wait(20);
  doc.querySelector('[data-mark-extra-done]').click();
  await wait(20);
  console.log('Clicking the completed extra\'s toggle again flips it back to "Mark Done":', doc.getElementById('dayDetailExtraWorkouts').textContent.includes('Mark Done') ? 'OK' : `FAIL (${doc.getElementById('dayDetailExtraWorkouts').textContent})`);

  console.log('ALL DONE (part 1)');

  // ---- Part 2: an already-stuck incomplete extra workout from before this fix (stale cloud data) ----
  const db = {
    profiles:{ u1:{id:'u1'} },
    workout_logs:{},
    planned_workouts:{ pw1: {
      id:'pw1', log_date:'2026-09-24', session_type:'strength', title:'Back Day', detail:'Pyramid sets',
      exercises: null, interval_rounds:null, interval_work_sec:null, interval_rest_sec:null, completed:false, actual_distance:null,
    } },
  };
  // Sign IN (not sign up) as a RETURNING user -- loadWorkoutDataFromCloud() (which reads
  // planned_workouts) only runs on the sign-in path; a fresh signup has nothing to load yet.
  const authUsers = { 'stuckextra@example.com': {id:'u1', password:'hunter22'} };
  let nextId = 2;
  const newId = () => 'id' + (nextId++);
  function createClient(){
    let currentUser = null;
    function from(table){
      let filters = [], pendingUpdate=null;
      const matchRow = row => filters.every(([c,v]) => row[c]===v);
      async function run(single){
        if(table==='profiles'){
          const f = filters.find(x=>x[0]==='id');
          return {data: (f && db.profiles[f[1]]) || null, error:null};
        }
        if(table==='workout_logs'){
          if(single) return {data:null, error:null};
          return {data: [], error:null};
        }
        if(table==='planned_workouts'){
          if(pendingUpdate){
            const f = filters.find(x=>x[0]==='id');
            if(f && db.planned_workouts[f[1]]) Object.assign(db.planned_workouts[f[1]], pendingUpdate);
            return {data:null, error:null};
          }
          // Single fake user in this test -- no need to actually match user_id.
          return {data: Object.values(db.planned_workouts), error:null};
        }
        if(table==='manual_entries' || table==='progression_targets' || table==='personal_records'){
          return {data: [], error:null};
        }
        return {data:null, error:{message:'mock: unhandled '+table}};
      }
      const api = {
        select(){ return api; }, eq(c,v){ filters.push([c,v]); return api; },
        insert(p){ return api; }, update(p){ pendingUpdate=p; return api; },
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

  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){
      window.supabase = { createClient };
      window.__ALTIRO_TEST_TODAY__ = '2026-09-27';
    },
  });
  await wait(80);
  const doc2 = dom2.window.document;
  const goPill2 = id => [...doc2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill2('onb-account');
  await wait(20);
  doc2.getElementById('toggleAuthMode').click(); // switch to "sign in" -- a returning user
  doc2.getElementById('emailInput').value = 'stuckextra@example.com';
  doc2.getElementById('emailInput').dispatchEvent(new dom2.window.Event('input', {bubbles:true}));
  doc2.getElementById('passwordInput').value = 'hunter22';
  doc2.getElementById('passwordInput').dispatchEvent(new dom2.window.Event('input', {bubbles:true}));
  doc2.getElementById('emailSignupBtn').click();
  await wait(150);

  goPill2('home');
  await wait(20);
  doc2.querySelector('#weekStrip .day-cell[data-date="2026-09-24"]').click();
  await wait(20);
  console.log('Stale incomplete extra loaded from the cloud shows a "Mark Done" button:', !!doc2.querySelector('[data-mark-extra-done]') ? 'OK' : 'FAIL');
  console.log('Calendar has NOT yet counted it as done:', (() => {
    goPill2('calendar');
    const c = doc2.querySelector('#calGrid .mo-cell[data-date="2026-09-24"]');
    goPill2('home');
    doc2.querySelector('#weekStrip .day-cell[data-date="2026-09-24"]').click();
    return c && !c.classList.contains('done');
  })() ? 'OK' : 'FAIL');

  doc2.querySelector('[data-mark-extra-done]').click();
  await wait(20);
  console.log('Clicking "Mark Done" flips it to a Completed badge:', doc2.getElementById('dayDetailExtraWorkouts').textContent.includes('Completed') ? 'OK' : `FAIL (${doc2.getElementById('dayDetailExtraWorkouts').textContent})`);
  console.log('The fix persisted to the cloud (completed:true written to the row):', db.planned_workouts.pw1.completed===true ? 'OK' : 'FAIL');

  goPill2('calendar');
  await wait(20);
  const cell2 = doc2.querySelector('#calGrid .mo-cell[data-date="2026-09-24"]');
  console.log('Calendar now shows that day as done:', cell2 && cell2.classList.contains('done') ? 'OK' : `FAIL (${cell2 ? cell2.className : 'not found'})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
