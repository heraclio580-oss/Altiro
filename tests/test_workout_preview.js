const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Tapping a future workout previews it (a run's distance, how to run it and target pace; a lifting
// workout's exercises with targets), and any exercise can be swapped for another that fits the user's
// equipment -- or skipped -- for just that workout or every workout; the whole workout can be skipped
// too. Both kinds of change survive a fresh sign-in.
function makeBackend(){
  const db = { profiles: {u1: {id:'u1', training_days:[0,2,4], focus_ratio:4, intensity_idx:1, level:'intermediate', equipment:'bodyweight', plan_start:'2026-09-14'}}, workout_logs: {} };
  let nextId = 1;
  function from(table){
    let op = 'select', payload = null; const filters = [];
    const match = r => filters.every(([c,v]) => r[c]===v);
    async function run(single){
      if(table==='profiles'){
        if(op==='update'){ Object.assign(db.profiles.u1, payload); return {data:null, error:null}; }
        return {data: db.profiles.u1, error:null};
      }
      if(table==='workout_logs'){
        if(op==='insert'){ const id = 'w'+(nextId++); db.workout_logs[id] = {id, ...payload}; return {data:{id}, error:null}; }
        if(op==='update'){ Object.values(db.workout_logs).filter(match).forEach(r=>Object.assign(r, payload)); return {data:null, error:null}; }
        const rows = Object.values(db.workout_logs).filter(match).map(r=>({completed_override:null, ...r, manual_entries:[]}));
        return {data: single ? (rows[0]||null) : rows, error:null};
      }
      return {data: single ? null : [], error:null};
    }
    const api = {
      select(){ return api; }, eq(c,v){ filters.push([c,v]); return api; }, is(){ return api; }, order(){ return api; },
      insert(p){ op='insert'; payload=p; return api; }, update(p){ op='update'; payload=p; return api; },
      upsert(){ op='noop'; return api; }, delete(){ op='noop'; return api; },
      maybeSingle(){ return run(true); }, then(res, rej){ return run(false).then(res, rej); },
    };
    return api;
  }
  return { db, createClient: () => ({
    auth: {
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; },
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
function helpers(dom){
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const tapPlanRow = async (weekIdx, day) => {
    const row = doc.querySelector(`.plan-row[data-week-idx="${weekIdx}"][data-day="${day}"]`);
    for(const type of ['pointerdown','pointerup']) row.dispatchEvent(new dom.window.PointerEvent(type, {bubbles:true, clientX:50, clientY:50}));
    await wait(20);
  };
  const names = () => [...doc.querySelectorAll('#wpExerciseList .wp-ex-name')].map(el=>el.textContent);
  const previewOpen = () => !doc.getElementById('workoutPreviewOverlay').hidden;
  const close = async () => { doc.getElementById('closeWorkoutPreview').click(); await wait(10); };
  const click = async sel => { doc.querySelector(sel).click(); await wait(20); };
  return {doc, go, tapPlanRow, names, previewOpen, close, click};
}

(async () => {
  const backend = makeBackend();
  const dom = openSession(backend);
  await wait(200);
  const {doc, go, tapPlanRow, names, previewOpen, close, click} = helpers(dom);
  go('week');
  await wait(20);

  // ---- preview ----
  await tapPlanRow(1, 0); // next Monday
  console.log('Tapping a future workout on Plan opens its preview:', previewOpen() ? 'OK' : 'FAIL');
  console.log('...with the day and workout:', /Monday, Sep 21/.test(doc.getElementById('wpDayLabel').textContent) && /Strength/.test(doc.getElementById('wpTitle').textContent) ? 'OK' : `FAIL (${doc.getElementById('wpDayLabel').textContent} / ${doc.getElementById('wpTitle').textContent})`);
  const before = names();
  console.log('...listing its exercises with sets x reps:', before.length>=4 && [...doc.querySelectorAll('#wpExerciseList .wp-ex-rx')].every(el=>/^\d+ x /.test(el.textContent)) ? `OK (${before.join(', ')})` : 'FAIL');
  console.log('A bodyweight plan only lists bodyweight moves:', !before.some(n=>/Barbell|Dumbbell|Kettlebell|Cable|Bench Press|Squat$/.test(n) && !/Bodyweight|Jump|Split/.test(n)) ? 'OK' : `FAIL (${before})`);

  // ---- swap one exercise, just this workout ----
  // (The second exercise: the main lift changes every session, the second one stays for the 4-week block.)
  await click('#wpExerciseList [data-change="1"]');
  const altChips = [...doc.querySelectorAll('.wp-chooser [data-alt]')].map(c=>c.getAttribute('data-alt'));
  console.log('Change offers alternatives plus Skip:', altChips.length>=2 && altChips.includes('skip') ? `OK (${altChips.join(', ')})` : `FAIL (${altChips})`);
  console.log('...and no scope choice until one is picked:', !doc.querySelector('.wp-chooser [data-scope]') ? 'OK' : 'FAIL');
  const alt = altChips.find(k=>k!=='skip');
  await click(`.wp-chooser [data-alt="${alt}"]`);
  console.log('Picking one asks: just this workout, or every workout:', doc.querySelectorAll('.wp-chooser [data-scope]').length===2 ? 'OK' : 'FAIL');
  await click('.wp-chooser [data-scope="one"]');
  console.log('Just this workout: the exercise is swapped here:', names()[1]===alt && names()[0]===before[0] && names().slice(2).join()===before.slice(2).join() ? 'OK' : `FAIL (${names()})`);
  await close();
  const monLog = Object.values(backend.db.workout_logs).find(r=>r.log_date==='2026-09-21');
  console.log('...and that workout\'s own exercise list is saved:', monLog && Array.isArray(monLog.planned_exercises) && monLog.planned_exercises[1].key===alt ? 'OK' : `FAIL (${JSON.stringify(monLog)})`);
  await tapPlanRow(2, 0); // the Monday after -- same workout, same second lift this cycle
  console.log("...but the next week's same workout is unchanged:", names()[1]===before[1] ? 'OK' : `FAIL (${names()[1]} vs ${before[1]})`);

  // ---- swap, every workout ----
  await click('#wpExerciseList [data-change="1"]');
  await click(`.wp-chooser [data-alt="${alt}"]`);
  await click('.wp-chooser [data-scope="all"]');
  console.log('Every workout: swapped here, with a note and Undo:', names()[1]===alt && /Replaces .+ in every workout/.test(doc.querySelector('#wpExerciseList .wp-ex-note').textContent) ? 'OK' : `FAIL (${names()[1]})`);
  console.log('...saved to the profile:', backend.db.profiles.u1.exercise_swaps && backend.db.profiles.u1.exercise_swaps[before[1]]===alt ? 'OK' : `FAIL (${JSON.stringify(backend.db.profiles.u1.exercise_swaps)})`);
  await close();
  await tapPlanRow(3, 0);
  console.log('...and applied to later workouts too:', names()[1]===alt ? 'OK' : `FAIL (${names()[1]})`);

  // ---- skip an exercise, every workout, then undo ----
  const countBefore = names().length;
  const skipped = names()[2];
  await click('#wpExerciseList [data-change="2"]');
  await click('.wp-chooser [data-alt="skip"]');
  await click('.wp-chooser [data-scope="all"]');
  console.log('Skipping an exercise for every workout removes it, and says so:',
    names().length===countBefore-1 && !names().includes(skipped) && doc.getElementById('wpSkippedList').textContent.includes(`${skipped} is skipped in every workout`) ? 'OK' : `FAIL (${names()} / ${doc.getElementById('wpSkippedList').textContent})`);
  await click('#wpSkippedList [data-undo-swap]');
  console.log('Undo brings it back:', names().length===countBefore && names().includes(skipped) ? 'OK' : `FAIL (${names()})`);

  // ---- fresh session: both kinds of change are still there ----
  const dom2 = openSession(backend);
  await wait(200);
  const h2 = helpers(dom2);
  h2.go('week');
  await wait(20);
  await h2.tapPlanRow(1, 0);
  console.log('Next sign-in: the just-this-workout swap is still on that Monday:', h2.names()[1]===alt ? 'OK' : `FAIL (${h2.names()[1]})`);
  await h2.close();
  await h2.tapPlanRow(2, 0);
  console.log('Next sign-in: the every-workout swap still applies:', h2.names()[1]===alt ? 'OK' : `FAIL (${h2.names()[1]})`);
  await h2.click('#wpExerciseList [data-undo-swap]');
  console.log('Undoing it restores the plan\'s own pick:', h2.names()[1]===before[1] ? 'OK' : `FAIL (${h2.names()[1]})`);

  // ---- skip the whole workout ----
  h2.doc.getElementById('wpSkipWorkoutBtn').click();
  await wait(20);
  const skippedRow = h2.doc.querySelector('.plan-row[data-week-idx="2"][data-day="0"]');
  console.log('Skip this workout turns the day into a rest day:', !h2.previewOpen() && /Rest Day/.test(skippedRow.textContent) ? 'OK' : `FAIL (${skippedRow.textContent.trim().slice(0,60)})`);
  const skippedLog = Object.values(backend.db.workout_logs).find(r=>r.log_date==='2026-09-28');
  console.log('...and it\'s saved:', skippedLog && skippedLog.planned_type==='rest' ? 'OK' : `FAIL (${JSON.stringify(skippedLog)})`);

  // ---- a run preview ----
  h2.go('adjust');
  await wait(10);
  for(let i=0;i<4;i++) h2.doc.getElementById('adjSliderThumb').dispatchEvent(new dom2.window.KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
  await wait(5);
  h2.doc.querySelector('#adjMilesChips .chip[data-key="15"]').click();
  h2.doc.getElementById('applyAdjust').click();
  await wait(20);
  h2.go('week');
  await wait(20);
  await h2.tapPlanRow(1, 4); // next Friday -- the long run on a Mon/Wed/Fri plan
  console.log('A run preview shows its distance, how to run it and a target pace:',
    /Long Run/.test(h2.doc.getElementById('wpTitle').textContent) && /mi/.test(h2.doc.getElementById('wpDetail').textContent)
    && h2.doc.getElementById('wpRunHow').textContent.length>20 && /Target pace: \d+:\d\d\/mi/.test(h2.doc.getElementById('wpPace').textContent)
      ? 'OK' : `FAIL (${h2.doc.getElementById('wpTitle').textContent} / ${h2.doc.getElementById('wpPace').textContent})`);
  console.log('...and no exercise list:', h2.doc.getElementById('wpExerciseSection').hidden ? 'OK' : 'FAIL');
  await h2.close();

  // ---- kettlebells ----
  h2.go('adjust');
  await wait(10);
  for(let i=0;i<4;i++) h2.doc.getElementById('adjSliderThumb').dispatchEvent(new dom2.window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  await wait(5);
  h2.doc.querySelector('#adjEquipChips .chip[data-key="kettlebells"]').click();
  h2.doc.getElementById('applyAdjust').click();
  await wait(20);
  h2.go('week');
  await wait(20);
  await h2.tapPlanRow(1, 2); // next Wednesday
  const kb = h2.names();
  console.log('Kettlebells equipment: workouts are built from kettlebell moves:', kb.some(n=>/Kettlebell|Goblet|Turkish/.test(n)) && !kb.some(n=>/Barbell|Dumbbell|Cable|Lat Pulldown|Bench Press/.test(n)) ? `OK (${kb.join(', ')})` : `FAIL (${kb})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
