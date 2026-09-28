const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Users set their own weight and reps for a lift -- by tapping its numbers (Today card, workout sheet) or
// all at once in Settings -> My Lifts. The numbers apply to that lift in every workout, pre-fill Log
// Performance, and are saved to the account.
function makeBackend(){
  const targets = {}; // session_key -> row
  function from(table){
    let op = 'select', payload = null;
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; },
      insert(){ op = 'insert'; return api; }, update(){ op = 'update'; return api; }, delete(){ return api; },
      upsert(p){ op = 'upsert'; payload = p; return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:4, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-09-14'} : null, error:null}); },
      then(res, rej){
        if(op==='upsert' && table==='progression_targets') targets[payload.session_key] = payload;
        const data = op==='select' ? (table==='progression_targets' ? Object.values(targets) : []) : null;
        return Promise.resolve({data, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { targets, createClient: () => ({
    auth: {
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; },
      async signOut(){ return {error:null}; },
    },
    from,
  })};
}
function open(backend){
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){ window.supabase = { createClient: () => backend.createClient() }; window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
}

(async () => {
  const backend = makeBackend();
  const dom = open(backend);
  await wait(200);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const click = async sel => { doc.querySelector(sel).click(); await wait(20); };
  const setVal = (el, v) => { el.value = String(v); el.dispatchEvent(new dom.window.Event('input', {bubbles:true})); };
  const cardLifts = () => [...doc.querySelectorAll('#sessionCard .r-exercise-list li')].map(li=>({key: li.getAttribute('data-lift-key'), text: li.textContent.replace(/\s+/g,' ').trim()}));

  go('home');
  await wait(20);
  const lifts = cardLifts();
  const first = lifts.find(l=>l.key && /· \d+ lb/.test(l.text));
  console.log("Today's lifts show their weight:", first ? `OK (${first.text})` : `FAIL (${JSON.stringify(lifts)})`);

  // ---- tap a lift on the Today card ----
  doc.querySelector(`#sessionCard li[data-lift-key="${first.key}"]`).click();
  await wait(20);
  const tuner = doc.querySelector('.wp-tuner');
  console.log('Tapping it opens that lift\'s numbers to edit:', !doc.getElementById('workoutPreviewOverlay').hidden && tuner && tuner.querySelector('[data-lift-field="weight"]') && tuner.querySelector('[data-lift-field="reps"]') ? 'OK' : 'FAIL');
  setVal(tuner.querySelector('[data-lift-field="weight"]'), 155);
  setVal(tuner.querySelector('[data-lift-field="reps"]'), 6);
  await click('.wp-tuner [data-tune-save]');
  const row = [...doc.querySelectorAll('#wpExerciseList .wp-ex')].find(el=>el.querySelector('[data-tune]'));
  console.log('Saved: the sheet shows the new numbers:', /x 6 · 155 lb/.test(doc.getElementById('wpExerciseList').textContent) ? 'OK' : `FAIL (${doc.getElementById('wpExerciseList').textContent.slice(0,120)})`);
  const saved = backend.targets['strength:'+first.key];
  console.log('...saved to the account for that lift:', saved && saved.weight===155 && saved.reps===6 ? 'OK' : `FAIL (${JSON.stringify(saved)})`);
  doc.getElementById('closeWorkoutPreview').click();
  await wait(20);
  const updated = cardLifts().find(l=>l.key===first.key);
  console.log('The Today card shows them too:', /x 6 · 155 lb/.test(updated.text) ? `OK (${updated.text})` : `FAIL (${updated.text})`);

  // ---- they apply everywhere the lift appears ----
  go('week');
  await wait(20);
  let elsewhere = null;
  for(let w=1; w<4 && !elsewhere; w++) for(let d=0; d<7 && !elsewhere; d++){
    const r = doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`);
    if(!r || !/Strength/.test(r.textContent)) continue;
    for(const type of ['pointerdown','pointerup']) r.dispatchEvent(new dom.window.PointerEvent(type, {bubbles:true}));
    await wait(20);
    const exRow = [...doc.querySelectorAll('#wpExerciseList .wp-ex')].find(el=>el.querySelector('.wp-ex-name').textContent===first.text.split(' ')[0] || el.textContent.includes('155 lb'));
    if(exRow && /155 lb/.test(exRow.textContent)) elsewhere = exRow.textContent;
    doc.getElementById('closeWorkoutPreview').click();
    await wait(10);
  }
  console.log('The same lift in a later workout uses the new numbers:', elsewhere ? 'OK' : 'FAIL');

  // ---- Log Performance pre-fills them ----
  go('home');
  await wait(10);
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  const logRow = doc.querySelector(`#logPerfExercisesList .exercise-log-row[data-exercise-key="${first.key}"]`);
  const w0 = logRow && logRow.querySelector('[data-field="weight"]').value, r0 = logRow && logRow.querySelector('[data-field="reps"]').value;
  console.log('Log Performance starts from them:', w0==='155' && r0==='6' ? 'OK' : `FAIL (${w0} x ${r0})`);
  doc.getElementById('closeLogPerf').click();
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // ---- My Lifts: everything at once ----
  go('settings');
  await wait(10);
  await click('#openLiftsBtn');
  const rows = [...doc.querySelectorAll('#liftsList .lift-row')];
  console.log('My Lifts lists the plan\'s lifts:', rows.length>=5 ? `OK (${rows.length} lifts)` : `FAIL (${rows.length})`);
  const firstRow = rows.find(r=>r.getAttribute('data-lift-key')===first.key);
  console.log('...with the numbers already set:', firstRow && firstRow.querySelector('[data-lift-field="weight"]').value==='155' && firstRow.querySelector('[data-lift-field="reps"]').value==='6' ? 'OK' : 'FAIL');
  const other = rows.find(r=>r.getAttribute('data-bodyweight')==='0' && r.getAttribute('data-lift-key')!==first.key);
  const bw = rows.find(r=>r.getAttribute('data-bodyweight')==='1');
  console.log('Bodyweight moves only ask for reps:', !bw || (!bw.querySelector('[data-lift-field="weight"]') && bw.querySelector('[data-lift-field="reps"]')) ? 'OK' : 'FAIL');
  setVal(other.querySelector('[data-lift-field="weight"]'), 80);
  if(bw) setVal(bw.querySelector('[data-lift-field="reps"]'), 20);
  await click('#saveLiftsBtn');
  const otherKey = other.getAttribute('data-lift-key');
  console.log('Saving updates each changed lift:', backend.targets['strength:'+otherKey] && backend.targets['strength:'+otherKey].weight===80 ? 'OK' : `FAIL (${JSON.stringify(backend.targets['strength:'+otherKey])})`);
  if(bw) console.log('...including a bodyweight move\'s reps:', backend.targets['strength:'+bw.getAttribute('data-lift-key')].reps===20 ? 'OK' : 'FAIL');
  console.log('...without touching the ones left alone:', backend.targets['strength:'+first.key].weight===155 ? 'OK' : 'FAIL');

  // ---- next sign-in ----
  const dom2 = open(backend);
  await wait(200);
  const doc2 = dom2.window.document;
  [...doc2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  const again = [...doc2.querySelectorAll('#sessionCard .r-exercise-list li')].find(li=>li.getAttribute('data-lift-key')===first.key);
  console.log('Next sign-in: the numbers are still there:', again && /x 6 · 155 lb/.test(again.textContent) ? 'OK' : `FAIL (${again && again.textContent})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
