const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A rest day saved with a leftover "done" mark (from a workout taken off it before that was cleared)
// is not a done day: it isn't green, and a workout can still be moved onto it in Plan.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const logRows = [
  // Thursday: a rest day (training days Mon/Wed/Fri) with nothing on it but an old done mark.
  {id:'a', user_id:'u1', log_date:'2026-09-17', completed_override:true, manual_entries:[]},
];
function makeBackend(){
  function from(table){
    let op = 'select';
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ return api; }, update(){ op = 'update'; return api; }, upsert(){ op = 'upsert'; return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:4, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-09-07'} : null, error:null}); },
      then(res, rej){ return Promise.resolve({data: op==='select' ? (table==='workout_logs' ? logRows : []) : null, error:null}).then(res, rej); },
    };
    return api;
  }
  return { createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'a@b.c'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}

(async () => {
  const backend = makeBackend();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(300);
  const doc = dom.window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'week').click();
  await wait(30);
  const thu = doc.querySelector('#weekList .plan-row[data-week-idx="0"][data-day="3"]');
  check('Thursday is a rest day in Plan', thu && /Rest/.test(thu.textContent), thu && thu.textContent.replace(/\s+/g,' ').trim().slice(0,60));
  check('...not shown as done', thu && !thu.querySelector('.prow-status-dot'));
  check('...and a workout can be moved onto it', thu && thu.getAttribute('data-draggable')==='1');
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
