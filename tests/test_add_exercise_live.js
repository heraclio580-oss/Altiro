const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Adding an exercise while doing any lifting workout -- the plan's too, not just one being built as it's
// done: waiting for a machine, or feeling good that day. It's for today only (the plan's next one comes
// as usual), what's already typed stays, and one done before starts from the last time it was done.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// A signed-in user whose last Friday had an "Arms" workout of their own, with Hammer Curl in it.
function makeBackend(){
  const arms = [{key:'Hammer Curl', name:'Hammer Curl', sets:3, reps:12}];
  const upper = [{key:'Bench Press', name:'Bench Press', sets:3, reps:8}];
  const logRows = [
    {id:'w1', user_id:'u1', log_date:'2026-09-11', completed_override:true, planned_type:'strength', planned_title:'Arms', planned_detail:'30 min', planned_exercises:arms, manual_entries:[],
     performance:{exercises:[{key:'Hammer Curl', name:'Hammer Curl', weight:40, reps:10, sets:[{weight:30,reps:12},{weight:35,reps:12},{weight:40,reps:10}]}]}},
    {id:'w2', user_id:'u1', log_date:'2026-09-18', completed_override:null, planned_type:'strength', planned_title:'Upper', planned_detail:'45 min', planned_exercises:upper, manual_entries:[]},
  ];
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
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
    await wait(50);
    const w = dom.window, doc = w.document;
    const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    const keys = () => [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].map(r=> r.getAttribute('data-exercise-key'));
    const row = key => [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].find(r=> r.getAttribute('data-exercise-key')===key);
    const current = () => { const r = doc.querySelector('#logPerfExercisesList .exercise-log-row.current-exercise'); return r && r.getAttribute('data-exercise-key'); };
    // A weights-only plan, so today is one of the plan's lifting workouts.
    goPill('adjust');
    for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
    doc.getElementById('applyAdjust').click();
    await wait(10);
    goPill('home');
    await wait(20);
    doc.getElementById('recordBtn').click();
    await wait(950);
    const plan = keys();
    check('The plan\'s workout can take another exercise', !doc.getElementById('logPerfAddExercise').hidden);
    check('...its own exercises have no remove button (Change exercises is for those)', !doc.querySelector('#logPerfExercisesList [data-remove-ex]') && !doc.getElementById('logPerfChangeExercisesBtn').hidden);

    // Some of the workout done already, and a note.
    row(plan[0]).querySelector('[data-field="weight"]').value = '155';
    row(plan[0]).querySelector('[data-field="weight"]').dispatchEvent(new w.Event('input', {bubbles:true}));
    row(plan[0]).querySelector('.set-check-dot').click();
    doc.getElementById('logPerfNotesInput').value = 'Squat rack busy';
    await wait(10);

    doc.getElementById('logPerfAddExerciseInput').value = 'Hammer Curl';
    doc.getElementById('logPerfAddExerciseBtn').click();
    await wait(20);
    check('Added: it comes last', keys().join()===[...plan, 'Hammer Curl'].join(), keys().join());
    check('...as the one up next', current()==='Hammer Curl', current());
    check('...with its demo (one of the app\'s exercises)', !!row('Hammer Curl').querySelector('.ex-demo-btn'));
    check('...and a way to take it off again', !!row('Hammer Curl').querySelector('[data-remove-ex]'));
    check('...and a handle to move it', !!row('Hammer Curl').querySelector('.ex-drag'));
    check('What was typed stays', row(plan[0]).querySelector('[data-field="weight"]').value==='155' && row(plan[0]).querySelector('.set-check-dot').classList.contains('checked'));
    check('...and so do the notes', doc.getElementById('logPerfNotesInput').value==='Squat rack busy', doc.getElementById('logPerfNotesInput').value);

    // Closing and coming back keeps it.
    doc.getElementById('closeLogPerf').click();
    await wait(20);
    // Just today: the plan's next Friday (opened from Plan) comes without it.
    goPill('week');
    await wait(20);
    const fri = doc.querySelector('#weekList .plan-row[data-day="4"][data-week-idx="1"]');
    const tap = type => fri.dispatchEvent(new w.PointerEvent(type, {bubbles:true, cancelable:true, pointerId:1, clientX:10, clientY:10}));
    tap('pointerdown'); tap('pointerup');
    await wait(20);
    const nextList = doc.getElementById('wpExerciseList').textContent;
    check('Next Friday\'s workout doesn\'t have it', !doc.getElementById('workoutPreviewOverlay').hidden && nextList.length>0 && !/Hammer Curl/.test(nextList), nextList.slice(0, 120));
    doc.getElementById('closeWorkoutPreview').click();
    goPill('home');
    await wait(20);
    doc.getElementById('recordBtn').click();
    await wait(950);
    check('Reopened: still there', keys().includes('Hammer Curl'), keys().join());

    doc.getElementById('logPerfNotesInput').value = 'Squat rack busy';
    row('Hammer Curl').querySelector('[data-remove-ex]').click();
    await wait(20);
    check('Taken off again: the plan\'s list as it was', keys().join()===plan.join(), keys().join());
    check('...notes still there', doc.getElementById('logPerfNotesInput').value==='Squat rack busy');

    doc.getElementById('logPerfAddExerciseInput').value = 'Cable Crunch';
    doc.getElementById('logPerfAddExerciseBtn').click();
    await wait(20);
    doc.getElementById('saveLogPerf').click();
    await wait(60);
    const summary = [...doc.querySelectorAll('#summaryExercisesList .se-name')].map(e=> e.textContent);
    check('Saved with the workout', summary.length===plan.length+1 && /Cable Crunch/.test(summary[summary.length-1]), summary.join(' | '));
  }
  {
    // Done before, in another workout: it starts from that last time, every set.
    const backend = makeBackend();
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
    await wait(250);
    const doc = dom.window.document;
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(20);
    doc.getElementById('recordBtn').click();
    await wait(950);
    doc.getElementById('logPerfAddExerciseInput').value = 'hammer curl';
    doc.getElementById('logPerfAddExerciseBtn').click();
    await wait(20);
    const r = doc.querySelector('#logPerfExercisesList .exercise-log-row[data-exercise-key="Hammer Curl"]');
    const sets = r ? [...r.querySelectorAll('.set-log-row')].map(s=> s.querySelector('[data-field="weight"]').value+'x'+s.querySelector('[data-field="reps"]').value) : [];
    check('Added Hammer Curl starts from last Friday\'s Arms workout, set by set', sets.join(' ')==='30x12 35x12 40x10', sets.join(' '));
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
