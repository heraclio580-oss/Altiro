const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A workout's preview (today's, or one coming up) before it's started: its exercises can be dragged into
// another order and more added, for that day only. Starting it opens in that order, with what was added.
// Not on a workout that's done, nor when the preview is opened from inside the workout.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const BLOCK = 60;
function fakeRect(){
  const block = this.classList && (this.classList.contains('ex-block') ? this : this.classList.contains('ex-drag') ? this.closest('.ex-block') : null);
  if(block){
    const i = [...block.parentElement.children].indexOf(block);
    const top = i*BLOCK + (block===this ? 0 : 10), h = block===this ? 50 : 20;
    return { top, bottom: top+h, left:0, right:300, width:300, height:h, x:0, y:top };
  }
  return { top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0 };
}
const blockY = i => i*BLOCK + 15;

// A signed-in user whose workout today is their own "Upper", with a superset.
function makeBackend(){
  const own = [{key:'Bench Press', name:'Bench Press', sets:3, reps:8, superset:'s1'}, {key:'Seated Row', name:'Seated Row', sets:3, reps:10, superset:'s1'}, {key:'Lateral Raise', name:'Lateral Raise', sets:3, reps:15}];
  const logRows = [{id:'w2', user_id:'u1', log_date:'2026-09-18', completed_override:null, planned_type:'strength', planned_title:'Upper', planned_detail:'45 min', planned_exercises:own, manual_entries:[]}];
  function from(table){
    let op = 'select';
    const filters = {};
    const api = {
      select(){ return api; }, eq(c, v){ filters[c] = v; return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ return api; }, update(){ op = 'update'; return api; }, upsert(){ op = 'upsert'; return api; },
      maybeSingle(){
        if(table==='workout_logs') return Promise.resolve({data: logRows.find(r=>r.log_date===filters.log_date) || null, error:null});
        return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:4, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-09-07'} : null, error:null});
      },
      then(res, rej){ return Promise.resolve({data: op==='select' && table==='workout_logs' ? logRows : op==='select' ? [] : null, error:null}).then(res, rej); },
    };
    return api;
  }
  return { createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; w.Element.prototype.getBoundingClientRect = fakeRect; } });
  await wait(50);
  const w = dom.window, doc = w.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const pointer = (el, type, y) => el.dispatchEvent(new w.PointerEvent(type, {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:y}));
  const wpKeys = () => [...doc.querySelectorAll('#wpExerciseList .wp-ex')].map(el=> el.getAttribute('data-key'));
  const wpRow = key => [...doc.querySelectorAll('#wpExerciseList .wp-ex')].find(el=> el.getAttribute('data-key')===key);
  const logKeys = () => [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].map(r=> r.getAttribute('data-exercise-key'));
  const homeOrder = () => [...doc.querySelectorAll('#sessionCard .r-exercise-list li')].map(li=> li.textContent.replace(/\s+/g,' ').trim());

  // A weights-only plan, so today is one of the plan's lifting workouts.
  goPill('adjust');
  for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  doc.getElementById('applyAdjust').click();
  await wait(10);
  goPill('home');
  await wait(20);
  doc.getElementById('changeExercisesBtn').click();
  await wait(20);
  check('Today\'s preview opened', !doc.getElementById('workoutPreviewOverlay').hidden);
  const start = wpKeys();
  check('Each exercise has a drag handle', start.length>=3 && doc.querySelectorAll('#wpExerciseList .ex-drag').length===start.length, start.length);
  check('...and there\'s a box to add one', !doc.getElementById('wpAddExercise').hidden);

  // Drag the third to the top.
  const h = wpRow(start[2]).querySelector('.ex-drag');
  pointer(h, 'pointerdown', blockY(2));
  check('Holding a handle folds the list', doc.getElementById('wpExerciseList').classList.contains('ex-reordering'));
  pointer(h, 'pointermove', blockY(1));
  pointer(h, 'pointermove', blockY(0) - 5);
  pointer(h, 'pointerup', blockY(0) - 5);
  await wait(20);
  const moved = [start[2], start[0], start[1], ...start.slice(3)];
  check('Dropped at the top: the new order', wpKeys().join()===moved.join(), wpKeys().join());
  check('...unfolded again', !doc.getElementById('wpExerciseList').classList.contains('ex-reordering'));

  // Add one.
  doc.getElementById('wpAddExerciseInput').value = 'Hammer Curl';
  doc.getElementById('wpAddExerciseBtn').click();
  await wait(20);
  check('Added: last on the list', wpKeys().join()===[...moved, 'Hammer Curl'].join(), wpKeys().join());
  check('...with a way to take it off (the plan\'s own have Change instead)', !!wpRow('Hammer Curl').querySelector('[data-wp-remove]') && !wpRow(start[0]).querySelector('[data-wp-remove]'));
  check('...3 sets to start', /^3 x/.test(wpRow('Hammer Curl').querySelector('.wp-ex-rx').textContent.trim()), wpRow('Hammer Curl').querySelector('.wp-ex-rx').textContent);
  doc.getElementById('wpAddExerciseInput').value = 'Cable Crunch';
  doc.getElementById('wpAddExerciseBtn').click();
  await wait(20);
  wpRow('Cable Crunch').querySelector('[data-wp-remove]').click();
  await wait(20);
  check('Taking one off again', wpKeys().join()===[...moved, 'Hammer Curl'].join(), wpKeys().join());
  doc.getElementById('closeWorkoutPreview').click();
  await wait(20);

  check('Home\'s card shows the new order', homeOrder().length===moved.length+1 && homeOrder()[homeOrder().length-1].startsWith('Hammer Curl'), homeOrder().join(' | '));
  doc.getElementById('recordBtn').click();
  await wait(950);
  check('Starting it: the same order, with the one added', logKeys().join()===[...moved, 'Hammer Curl'].join(), logKeys().join());
  check('...the first one is up next', doc.querySelector('#logPerfExercisesList .exercise-log-row.current-exercise').getAttribute('data-exercise-key')===moved[0]);

  // From inside the workout ("Change exercises"): the workout has its own handles and box, so none here.
  doc.getElementById('logPerfChangeExercisesBtn').click();
  await wait(20);
  check('Opened from inside the workout: no handles or add box in the preview', !doc.querySelector('#wpExerciseList .ex-drag') && doc.getElementById('wpAddExercise').hidden);
  doc.getElementById('closeWorkoutPreview').click();
  await wait(20);

  doc.getElementById('saveLogPerf').click();
  await wait(60);
  goPill('home');
  await wait(20);

  // Next week's same workout comes in the plan's order, without it (and can be changed in its own preview).
  goPill('week');
  await wait(20);
  const fri = doc.querySelector('#weekList .plan-row[data-day="4"][data-week-idx="1"]');
  pointer(fri, 'pointerdown', 10); pointer(fri, 'pointerup', 10);
  await wait(20);
  check('Next Friday: the plan\'s own order, without the added one', !wpKeys().includes('Hammer Curl') && wpKeys().length>0, wpKeys().join());
  check('...and its preview can be changed too (a day coming up)', !!doc.querySelector('#wpExerciseList .ex-drag') && !doc.getElementById('wpAddExercise').hidden);
  doc.getElementById('closeWorkoutPreview').click();


  {
    // The user's own workout: a superset moves as one block, and the workout keeps the new order.
    const backend = makeBackend();
    const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; w.Element.prototype.getBoundingClientRect = fakeRect; } });
    await wait(250);
    const w2 = dom2.window, d2 = w2.document;
    const p2 = (el, type, y) => el.dispatchEvent(new w2.PointerEvent(type, {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:y}));
    const keys2 = () => [...d2.querySelectorAll('#wpExerciseList .wp-ex')].map(el=> el.getAttribute('data-key'));
    [...d2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(20);
    d2.getElementById('changeExercisesBtn').click();
    await wait(20);
    check('Own workout: the superset is one block', d2.querySelectorAll('#wpExerciseList .ex-block').length===2, d2.querySelectorAll('#wpExerciseList .ex-block').length);
    const lat = [...d2.querySelectorAll('#wpExerciseList .wp-ex')].find(el=> el.getAttribute('data-key')==='Lateral Raise').querySelector('.ex-drag');
    p2(lat, 'pointerdown', blockY(1)); p2(lat, 'pointermove', blockY(0) - 5); p2(lat, 'pointerup', blockY(0) - 5);
    await wait(20);
    check('...moving the lone one above it', keys2().join()==='Lateral Raise,Bench Press,Seated Row', keys2().join());
    check('...the superset still together', /A1/.test(d2.querySelectorAll('#wpExerciseList .wp-ex')[1].textContent) && /A2/.test(d2.querySelectorAll('#wpExerciseList .wp-ex')[2].textContent));
    d2.getElementById('closeWorkoutPreview').click();
    await wait(20);
    d2.getElementById('recordBtn').click();
    await wait(950);
    const logged = [...d2.querySelectorAll('#logPerfExercisesList .exercise-log-row')].map(r=> r.getAttribute('data-exercise-key'));
    check('...and the workout starts in that order', logged.join()==='Lateral Raise,Bench Press,Seated Row', logged.join());
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
