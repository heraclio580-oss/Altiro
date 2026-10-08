const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Signing out and back in: no badge pops up again. (The signed-out app used to look like a brand-new
// account to the badge check, which queued a Day One welcome that showed at the next sign-in.)
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const user = {id:'u3', email:'back@example.com'};
let saved = null, session = {user}, authCb = null;
function from(table){
  let op = 'select', payload = null;
  const api = {
    select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; }, in(){ return api; },
    insert(){ op = 'insert'; return api; }, delete(){ op = 'delete'; return api; }, update(p){ op = 'update'; payload = p; return api; }, upsert(){ op = 'upsert'; return api; },
    maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u3', goal:'both', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, level:'beginner', equipment:'gym', plan_start:'2026-09-14', created_at:'2026-09-16T14:00:00Z', badges: saved} : null, error:null}); },
    then(res, rej){
      if(op==='update' && table==='profiles' && payload && 'badges' in payload) saved = payload.badges;
      return Promise.resolve({data: op==='select' ? [] : null, error:null}).then(res, rej);
    },
  };
  return api;
}
const client = {
  auth: {
    onAuthStateChange(cb){ authCb = cb; return {data:{subscription:{unsubscribe(){}}}}; },
    async getSession(){ return {data:{session}}; },
    async signOut(){ session = null; setTimeout(()=> authCb && authCb('SIGNED_OUT', null), 0); return {error:null}; },
  },
  from,
};

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => client }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(900);
  const doc = dom.window.document, ov = doc.getElementById('badgeOverlay');
  check('First sign-in: the Day One welcome', !ov.hidden && /Day One/.test(doc.getElementById('badgeBody').textContent));
  doc.getElementById('badgeDoneBtn').click();
  await wait(50);
  check('...saved with the account', saved && saved.day_one==='2026-09-16', JSON.stringify(saved));

  for(let round=1; round<=3; round++){
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click();
    await wait(20);
    doc.getElementById('signOutBtn').click();
    await wait(2500); // long enough for any badge check queued while signed out
    check(`Sign-out ${round}: nothing pops up on the welcome screen`, ov.hidden);
    session = {user};
    authCb('SIGNED_IN', session);
    await wait(2500);
    check(`Sign-in ${round}: no Day One again`, ov.hidden, doc.getElementById('badgeBody').textContent.replace(/\s+/g,' ').slice(0,60));
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
