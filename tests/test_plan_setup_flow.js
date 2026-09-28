const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Changing the plan's setup in Adjust Plan (current weekly miles, equipment, focus) reshapes the
// generated plan on the Plan tab -- week headers show build/recovery weeks and their planned miles --
// and the new setup is saved to the profile, where it's read back on the next sign-in.
function makeBackend(profile){
  const db = { profiles: {u1: {id:'u1', ...profile}} };
  const updates = [];
  function from(table){
    let op = 'select', payload = null;
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; },
      insert(){ return api; }, upsert(){ return api; }, delete(){ return api; },
      update(p){ op = 'update'; payload = p; return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? db.profiles.u1 : null, error:null}); },
      then(res, rej){
        if(op==='update' && table==='profiles'){ updates.push(payload); Object.assign(db.profiles.u1, payload); }
        return Promise.resolve({data: op==='select' ? [] : null, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { db, updates, createClient: () => ({
    auth: {
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async getSession(){ return {data:{session:{user:{id:'u1', email:'runner@example.com'}}}}; },
      async signOut(){ return {error:null}; },
    },
    from,
  })};
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

(async () => {
  // An existing account from before plans were counted in weeks: Mon/Wed/Fri, balanced.
  const backend = makeBackend({training_days:[0,2,4], focus_ratio:2, intensity_idx:1, level:'intermediate'});
  const dom = openSession(backend);
  await wait(200);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  console.log('An existing account gets a plan start (this week) saved:',
    backend.db.profiles.u1.plan_start==='2026-09-14' ? 'OK' : `FAIL (${backend.db.profiles.u1.plan_start})`);

  // ---- Adjust: running only, 5 days Tue-Sun, "21-30" miles a week ----
  go('adjust');
  await wait(10);
  console.log('Balanced plan: Adjust asks both current miles and equipment:',
    !doc.getElementById('adjMilesSection').hidden && !doc.getElementById('adjEquipSection').hidden ? 'OK' : 'FAIL');
  for(let i=0;i<2;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
  await wait(10);
  console.log('Moving to Running Only hides the equipment question:', doc.getElementById('adjEquipSection').hidden ? 'OK' : 'FAIL');
  doc.querySelector('#adjDayCountChips .chip[data-count="5"]').click();
  await wait(5);
  // Preset for 5 is Mon-Fri; make it Tue, Wed, Thu, Sat, Sun.
  for(const d of [0,4]) doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`).click();
  for(const d of [5,6]) doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`).click();
  doc.querySelector('#adjMilesChips .chip[data-key="25"]').click();
  await wait(5);
  doc.getElementById('applyAdjust').click();
  await wait(50);

  const saved = backend.updates[backend.updates.length-1];
  console.log('The new setup is saved to the profile:',
    saved.weekly_miles===25 && saved.focus_ratio===0 && JSON.stringify(saved.training_days)==='[1,2,3,5,6]' ? 'OK' : `FAIL (${JSON.stringify(saved)})`);
  console.log('Changing current miles restarts the build-up from this week:', saved.plan_start==='2026-09-14' ? 'OK' : `FAIL (${saved.plan_start})`);

  go('week');
  await wait(20);
  const meta = i => { const el = doc.querySelector(`.week-block[data-week-idx="${i}"] .week-block-meta`); return el ? el.textContent : ''; };
  console.log('Next week is a build week with its planned miles:', /^Build week · \d+(\.\d)? mi$/.test(meta(1)) ? `OK (${meta(1)})` : `FAIL (${meta(1)})`);
  console.log('Every 4th week of the plan is a recovery week:', meta(3).startsWith('Recovery week') ? `OK (${meta(3)})` : `FAIL (${meta(3)})`);
  const mi = i => parseFloat(meta(i).split('· ')[1]);
  console.log('Build weeks grow, then the recovery week drops:', mi(1) < mi(2) && mi(3) < mi(2) ? 'OK' : `FAIL (${[1,2,3].map(mi)})`);
  const sunNext = [...doc.querySelectorAll('.week-block[data-week-idx="1"] .plan-row')][6];
  console.log("Next week's Sunday is the long run:", sunNext && sunNext.textContent.includes('Long Run') ? 'OK' : `FAIL (${sunNext && sunNext.textContent})`);

  // ---- a fresh session reads the saved setup back ----
  const dom2 = openSession(backend);
  await wait(200);
  const doc2 = dom2.window.document;
  [...doc2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'adjust').click();
  await wait(10);
  const sel = doc2.querySelector('#adjMilesChips .chip.sel');
  console.log('Next sign-in: Adjust shows the saved current miles:', sel && sel.dataset.key==='25' ? 'OK' : `FAIL (${sel && sel.dataset.key})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
