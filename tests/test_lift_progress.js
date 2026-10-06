const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Progress -> Your lifts: every weighted lift logged, from the planned workouts and Additional Workouts
// alike, with its estimated max and change; tapping one opens its chart, bests and history.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

const squat = sets => ({key:'Back Squat', name:'Back Squat', weight:sets[sets.length-1][0], reps:sets[sets.length-1][1], sets:sets.map(([weight,reps])=>({weight,reps}))});
const logRows = [
  {id:'a', user_id:'u1', log_date:'2026-06-01', completed_override:true, manual_entries:[], performance:{exercises:[squat([[135,10],[155,8],[175,5]])]}},
  {id:'b', user_id:'u1', log_date:'2026-07-15', completed_override:true, manual_entries:[], performance:{exercises:[squat([[145,10],[165,8],[185,5]]),
    {key:'Push-Up', name:'Push-Up', bodyweight:true, setCount:3, reps:12}]}},
  {id:'c', user_id:'u1', log_date:'2026-09-14', completed_override:true, manual_entries:[], performance:{exercises:[squat([[155,10],[185,5],[205,3]])]}},
];
const extraRows = [
  {id:'x1', user_id:'u1', log_date:'2026-09-16', session_type:'strength', title:'Chest Day', detail:'', completed:true,
   performance:{exercises:[{key:'Bench Press', name:'Bench Press', weight:155, reps:5, sets:[{weight:135,reps:8},{weight:155,reps:5}]}]}},
];
function makeBackend(){
  function from(table){
    let op = 'select';
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ return api; }, update(){ op = 'update'; return api; }, upsert(){ op = 'upsert'; return api; },
      maybeSingle(){
        return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:4, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-05-25'} : null, error:null});
      },
      then(res, rej){
        const data = op==='select' ? (table==='workout_logs' ? logRows : table==='planned_workouts' ? extraRows : []) : null;
        return Promise.resolve({data, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { createClient: () => ({
    auth: {
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; },
      async signOut(){ return {error:null}; },
    },
    from,
  })};
}

let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

(async () => {
  const backend = makeBackend();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(300);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('progress');
  await wait(30);

  const rows = [...doc.querySelectorAll('#liftProgress .lift-row')];
  const names = rows.map(r=>r.querySelector('.lr-name').textContent);
  check('Your lifts lists each weighted lift, newest first', names.join('|')==='Bench Press|Back Squat', names.join('|'));
  check('...bodyweight moves are left out', !names.includes('Push-Up'));
  const sq = rows.find(r=>/Back Squat/.test(r.textContent));
  // Best est. max on Sep 14: 205x3 -> 205*(1+3/30) = 225.5; first (Jun 1): 175x5 -> 204.2 (vs 155x8 = 196.3)
  check('The squat shows its latest est. max and when it was last done', /Est\. max 226 lb · Sep 14/.test(sq.querySelector('.lr-sub').textContent), sq.querySelector('.lr-sub').textContent);
  check('...and how much it went up since the first time', sq.querySelector('.lift-change').textContent==='+21' && sq.querySelector('.lift-change').classList.contains('up'), sq.querySelector('.lift-change').textContent);
  check('A lift done once is marked New', /New/.test(rows[0].querySelector('.lift-change').textContent));
  check('Each row has a small trend line', !!sq.querySelector('.lr-spark polyline'));

  sq.click();
  await wait(20);
  const ov = doc.getElementById('liftDetailOverlay');
  check('Tapping a lift opens its sheet', !ov.hidden && doc.getElementById('liftDetailName').textContent==='Back Squat');
  const body = doc.getElementById('liftDetailBody');
  check('The hero shows the est. max now, and the change since the first workout', /226/.test(body.querySelector('.lift-hero .v').textContent) && /\+21 lb since Jun 1/.test(body.querySelector('.lift-hero .d').textContent), body.querySelector('.lift-hero').textContent.replace(/\s+/g,' '));
  check('The chart has a point per workout', body.querySelectorAll('.lift-chart .dot').length===3);
  check('...the latest is selected, with its sets shown', /Sep 14, 2026/.test(doc.getElementById('liftReadout').textContent) && /155×10 · 185×5 · 205×3/.test(doc.getElementById('liftReadout').textContent), doc.getElementById('liftReadout').textContent.replace(/\s+/g,' '));
  body.querySelector('[data-lift-pt="0"]').dispatchEvent(new dom.window.Event('click', {bubbles:true}));
  await wait(10);
  check('Tapping a point shows that workout', /Jun 1, 2026/.test(doc.getElementById('liftReadout').textContent), doc.getElementById('liftReadout').textContent.replace(/\s+/g,' '));
  doc.querySelector('[data-lift-metric="top"]').click();
  await wait(10);
  check('Heaviest set: the hero shows 205 lb × 3', /205\s*lb × 3/.test(doc.querySelector('#liftDetailBody .lift-hero .v').textContent), doc.querySelector('#liftDetailBody .lift-hero .v').textContent);
  check('...up 30 lb since Jun 1', /\+30 lb since Jun 1/.test(doc.querySelector('#liftDetailBody .lift-hero .d').textContent));
  doc.querySelector('[data-lift-range="3"]').click();
  await wait(10);
  check('Last 3 months: only the workouts since Jun 18', doc.querySelectorAll('#liftDetailBody .lift-chart .dot').length===2, doc.querySelectorAll('#liftDetailBody .lift-chart .dot').length);
  const bests = [...doc.querySelectorAll('#liftDetailBody .lift-bests .act-tile')].map(t=>t.textContent.replace(/\s+/g,' ').trim());
  check('Bests: heaviest 205 lb × 3, est. max 226, most volume on Jul 15 (3,695)', /205 lb\s*× 3 · Sep 14/.test(bests[0]) && /226 lb\s*Sep 14/.test(bests[1]) && /3,695\s*Jul 15/.test(bests[2]), bests.join(' | '));
  const hist = [...doc.querySelectorAll('#liftDetailBody .lift-hist .dt')].map(e=>e.textContent);
  check('History lists every workout, newest first', hist.join('|')==='Sep 14|Jul 15|Jun 1', hist.join('|'));
  doc.getElementById('closeLiftDetail').click();
  check('Closing the sheet', ov.hidden);

  rows[0].click();
  await wait(10);
  check('A lift from an Additional Workout opens too, and asks for another log to show a trend', doc.getElementById('liftDetailName').textContent==='Bench Press' && /Log this lift again/.test(doc.getElementById('liftDetailBody').textContent));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})();
