const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// The real Supabase client reports a SIGNED_IN event in the middle of signInWithPassword (before it
// returns), and again on page load for a saved session -- on top of the app's own sign-in handling.
// Each of those used to start its own full data load, so every sign-in and every reload loaded
// everything twice at once, and an Additional Workout showed up twice. This mock behaves the same way.
function makeBackend(){
  const db = {
    profiles: {u1: {id:'u1'}},
    planned_workouts: {p1: {id:'p1', user_id:'u1', log_date:'2026-09-16', session_type:'strength', title:'Core Circuit', detail:'', completed:true}},
  };
  const selects = {};
  let saved = null; // the "stored session"
  function from(table){
    const api = {
      select(){ selects[table] = (selects[table]||0) + 1; return api; },
      eq(){ return api; }, is(){ return api; }, order(){ return api; },
      insert(){ return api; }, update(){ return api; }, upsert(){ return api; }, delete(){ return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? db.profiles.u1 : null, error:null}); },
      then(res, rej){ return Promise.resolve({data: Object.values(db[table]||{}), error:null}).then(res, rej); },
    };
    return api;
  }
  function createClient(){
    const listeners = [];
    const emit = async (event, session) => { for(const cb of listeners) await cb(event, session); };
    const user = {id:'u1', email:'runner@example.com'};
    // Like the real client's own initialization: a saved session is announced as SIGNED_IN.
    setTimeout(()=>{ if(saved) emit('SIGNED_IN', saved); }, 0);
    return {
      auth: {
        onAuthStateChange(cb){ listeners.push(cb); return {data:{subscription:{unsubscribe(){}}}}; },
        async getSession(){ return {data:{session: saved}}; },
        async signInWithPassword(){
          saved = {user};
          await emit('SIGNED_IN', saved); // fired before this call returns, same as the real client
          return {data:{user, session:saved}, error:null};
        },
        async signOut(){ saved = null; await emit('SIGNED_OUT', null); return {error:null}; },
      },
      from,
    };
  }
  return { selects, createClient, resetSelects(){ Object.keys(selects).forEach(k=>delete selects[k]); } };
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
async function additionalWorkoutsOnWednesday(doc){
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'calendar').click();
  await wait(20);
  doc.querySelector('.mo-cell[data-date="2026-09-16"]').click();
  await wait(20);
  const n = doc.querySelectorAll('#dayDetailExtraWorkouts .manual-entry[data-extra-id]').length;
  doc.getElementById('closeDayDetail').click();
  return n;
}

(async () => {
  const backend = makeBackend();

  // ---- Email sign-in ----
  const dom = openSession(backend);
  await wait(80);
  const doc = dom.window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'onb-account').click();
  await wait(20);
  doc.getElementById('toggleAuthMode').click();
  doc.getElementById('emailInput').value = 'runner@example.com';
  doc.getElementById('emailInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('passwordInput').value = 'hunter22';
  doc.getElementById('passwordInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  doc.getElementById('emailSignupBtn').click();
  await wait(150);
  console.log('Email sign-in loads workout data once:', backend.selects.workout_logs===1 && backend.selects.planned_workouts===1 ? 'OK' : `FAIL (${JSON.stringify(backend.selects)})`);
  console.log('...and lands on Today:', !doc.getElementById('screen-home').hidden ? 'OK' : 'FAIL');
  const extrasA = await additionalWorkoutsOnWednesday(doc);
  console.log('The Additional Workout shows once, not twice:', extrasA===1 ? 'OK' : `FAIL (${extrasA})`);

  // ---- Reload with the saved session ----
  backend.resetSelects();
  const dom2 = openSession(backend);
  await wait(200);
  const doc2 = dom2.window.document;
  console.log('Reopening the app with a saved session loads workout data once:', backend.selects.workout_logs===1 && backend.selects.planned_workouts===1 ? 'OK' : `FAIL (${JSON.stringify(backend.selects)})`);
  console.log('...and lands on Today:', !doc2.getElementById('screen-home').hidden ? 'OK' : 'FAIL');
  const extrasB = await additionalWorkoutsOnWednesday(doc2);
  console.log('...with the Additional Workout shown once:', extrasB===1 ? 'OK' : `FAIL (${extrasB})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
