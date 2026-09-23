const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function firePointer(win, el, type, opts){
  el.dispatchEvent(new win.PointerEvent(type, Object.assign({bubbles:true, cancelable:true, pointerId:1}, opts)));
}

// Regression test for a reported bug: rearranging workouts on the Plan page (drag or tap-to-move)
// was purely local -- reorderAcrossPlan() never called any cloudXxx function, so nothing about a
// rearrange was ever saved. Signing out and back in re-ran loadWorkoutDataFromCloud(), which only
// restores a date's content from an explicit workout_logs.planned_type row; with none saved, every
// date just fell back to its own auto-generated (originally-scheduled) content and the rearrangement
// was gone. Fix: reorderAcrossPlan() now stamps every date it touches as an explicit custom plan and
// persists it via cloudSavePlannedSession()/cloudSetCompletedOverride(), the same as any other
// explicitly-planned workout.
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

  // ---- Session A: sign up, then drag today's workout onto Sunday (a rest day) ----
  const domA = openSession(backend, '2026-09-18'); // Friday
  await wait(80);
  const docA = domA.window.document;
  const goPillA = id => [...docA.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillA('onb-account');
  await wait(20);
  docA.getElementById('emailInput').value = 'reordersync@example.com';
  docA.getElementById('emailInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('passwordInput').value = 'hunter22';
  docA.getElementById('passwordInput').dispatchEvent(new domA.window.Event('input', {bubbles:true}));
  docA.getElementById('emailSignupBtn').click();
  await wait(80);

  goPillA('week');
  await wait(20);

  const ROW_H = 50;
  const rowCenterY = flatIdx => flatIdx*ROW_H + ROW_H/2;
  domA.window.Element.prototype.getBoundingClientRect = function(){
    const flatAttr = this.getAttribute && this.getAttribute('data-flat-idx');
    if(this.classList && this.classList.contains('plan-row') && flatAttr!==null){
      const top = parseInt(flatAttr,10)*ROW_H;
      return { top, bottom: top+ROW_H, left:0, right:300, width:300, height:ROW_H, x:0, y:top };
    }
    return { top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0 };
  };

  const rowFor = i => docA.getElementById('weekList').querySelector(`.plan-row[data-day="${i}"][data-week-idx="0"]`);
  const titleBefore4 = rowFor(4).querySelector('.prow-title').textContent; // Friday = today
  console.log('Today (Friday) starts with a real workout:', titleBefore4!=='Rest Day' ? `OK (${titleBefore4})` : 'FAIL');
  console.log('Sunday starts as Rest Day:', rowFor(6).querySelector('.prow-title').textContent==='Rest Day' ? 'OK' : 'FAIL');

  const todayRow = rowFor(4);
  firePointer(domA.window, todayRow, 'pointerdown', {clientX:100, clientY:rowCenterY(4)});
  await wait(380);
  firePointer(domA.window, todayRow, 'pointermove', {clientX:100, clientY:rowCenterY(6)});
  await wait(10);
  firePointer(domA.window, todayRow, 'pointerup', {clientX:100, clientY:rowCenterY(6)});
  await wait(80); // let the fire-and-forget cloud writes land

  console.log('After the drag -> Friday:', rowFor(4).querySelector('.prow-title').textContent, '| Sunday:', rowFor(6).querySelector('.prow-title').textContent);
  console.log('Local: Friday now shows Rest Day:', rowFor(4).querySelector('.prow-title').textContent==='Rest Day' ? 'OK' : 'FAIL');
  console.log('Local: Sunday now shows the moved workout:', rowFor(6).querySelector('.prow-title').textContent===titleBefore4 ? 'OK' : `FAIL (${rowFor(6).querySelector('.prow-title').textContent})`);

  console.log('Cloud: Friday (2026-09-18) synced as an explicit Rest Day plan:',
    Object.values(backend.db.workout_logs).some(r=>r.log_date==='2026-09-18' && r.planned_type==='rest') ? 'OK' : `FAIL (${JSON.stringify(Object.values(backend.db.workout_logs).map(r=>({d:r.log_date,t:r.planned_type,ti:r.planned_title})))})`);
  console.log('Cloud: Sunday (2026-09-20) synced with the moved-in workout title:',
    Object.values(backend.db.workout_logs).some(r=>r.log_date==='2026-09-20' && r.planned_title===titleBefore4) ? 'OK' : 'FAIL');

  // ---- Session B: sign back in, same day, fresh page load -- the rearrangement must survive ----
  const domB = openSession(backend, '2026-09-18');
  await wait(80);
  const docB = domB.window.document;
  const goPillB = id => [...docB.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPillB('onb-account');
  await wait(20);
  docB.getElementById('toggleAuthMode').click();
  docB.getElementById('emailInput').value = 'reordersync@example.com';
  docB.getElementById('emailInput').dispatchEvent(new domB.window.Event('input', {bubbles:true}));
  docB.getElementById('passwordInput').value = 'hunter22';
  docB.getElementById('passwordInput').dispatchEvent(new domB.window.Event('input', {bubbles:true}));
  docB.getElementById('emailSignupBtn').click();
  await wait(100);

  goPillB('week');
  await wait(20);
  const rowForB = i => docB.getElementById('weekList').querySelector(`.plan-row[data-day="${i}"][data-week-idx="0"]`);
  console.log('Session B: Friday still shows Rest Day after signing back in:', rowForB(4).querySelector('.prow-title').textContent==='Rest Day' ? 'OK' : `FAIL (${rowForB(4).querySelector('.prow-title').textContent})`);
  console.log('Session B: Sunday still shows the moved workout after signing back in:', rowForB(6).querySelector('.prow-title').textContent===titleBefore4 ? 'OK' : `FAIL (${rowForB(6).querySelector('.prow-title').textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
