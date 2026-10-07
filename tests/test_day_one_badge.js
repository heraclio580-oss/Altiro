const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Day One: a brand-new account gets a welcome badge straight away, before any workout -- its own moment,
// not the "you've already earned" summary -- and it's in the trophy case dated the day they joined.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const flat = el => el ? el.textContent.replace(/\s+/g,' ').trim() : '';

const profileSaves = [];
function makeBackend(){
  function from(table){
    let op = 'select', payload = null;
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ return api; }, update(p){ op = 'update'; payload = p; return api; }, upsert(){ op = 'upsert'; return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u2', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, level:'beginner', equipment:'gym', plan_start:'2026-09-14', created_at:'2026-09-18T14:00:00Z'} : null, error:null}); },
      then(res, rej){
        if(op==='update' && table==='profiles') profileSaves.push(payload);
        return Promise.resolve({data: op==='select' ? [] : null, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u2', email:'new@example.com'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}

(async () => {
  const backend = makeBackend();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(900);
  const doc = dom.window.document;
  const ov = doc.getElementById('badgeOverlay'), body = () => flat(doc.getElementById('badgeBody'));
  check('A new account is welcomed with its Day One badge', !ov.hidden && /Welcome to Altiro/.test(body()) && /Day One/.test(body()) && /first day on Altiro/.test(body()), body());
  check('...as its own moment, not the summary of earned badges', !/already earned/.test(body()) && doc.querySelectorAll('#badgeBody .badge-svg').length===1);
  const saved = profileSaves.filter(p=>p.badges).pop();
  check('...saved as earned the day they joined', saved && saved.badges.day_one==='2026-09-18' && Object.keys(saved.badges).filter(k=>!k.startsWith('best_')).length===1, saved && JSON.stringify(saved.badges));
  doc.getElementById('badgeDoneBtn').click();
  await wait(1800);
  check('...and nothing else pops up', ov.hidden);
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'progress').click();
  await wait(30);
  const tc = doc.getElementById('trophyCase');
  const tile = tc.querySelector('[data-badge="day_one"]');
  check('The trophy case has it, in colour, with the date', /1 badge earned/.test(flat(tc)) && tile && !tile.querySelector('.badge-svg.locked') && /Sep 18/.test(flat(tile)), flat(tc).slice(0,60));
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
