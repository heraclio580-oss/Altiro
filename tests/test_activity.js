const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Progress -> Activity: the time spent training (a lifting workout timed from when it's started to when
// it's saved; a run's logged time), and the sets and reps lifted -- each day, and added up for the week.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

// Today is Friday Sep 18 (the week of Mon Sep 14).
//   Mon 14  Shoulder Day, logged: 35 min; overhead press 10/10/8 + push-ups 3 x 12 -> 6 sets, 64 reps
//   Tue 15  Easy Run, 3 mi in 35 min
//   Wed 16  a walk logged by hand: 1.5 mi, 20 min
//   Thu 17  Leg Day (45 min) marked done, nothing logged -> its planned 45 min
//   Fri 18  Garage Lift (the user's own, one set to log), to do
//   Fri 11 (last week)  Back Day, 50 min, 3 sets of 10
function makeBackend(){
  const logs = {};
  let n = 1;
  const addLog = (log_date, f) => { const id = 'l'+(n++); logs[id] = {id, user_id:'u1', log_date, completed_override:null, manual_entries:[], ...f}; return id; };
  addLog('2026-09-11', {planned_type:'strength', planned_title:'Back Day', planned_detail:'45 min',
    performance:{time:50, exercises:[{key:'Barbell Row', sets:[{weight:135,reps:10},{weight:135,reps:10},{weight:135,reps:10}]}]}});
  addLog('2026-09-14', {planned_type:'strength', planned_title:'Shoulder Day', planned_detail:'40 min',
    performance:{time:35, exercises:[
      {key:'Overhead Press', sets:[{weight:95,reps:10},{weight:95,reps:10},{weight:95,reps:8}]},
      {key:'Push-Up', bodyweight:true, setCount:3, prescription:'3 x 12'},
    ]}});
  addLog('2026-09-15', {planned_type:'run', planned_title:'Easy Run', planned_detail:'3 mi', actual_run_distance:3, performance:{distance:3, time:35}});
  addLog('2026-09-16', {planned_type:'rest', planned_title:'Rest Day', planned_detail:'',
    manual_entries:[{id:'e1', name:'Evening Walk', type:'run', volume:'1.5 mi · 20:00', notes:'', distance:1.5, duration_min:20}]});
  addLog('2026-09-17', {planned_type:'strength', planned_title:'Leg Day', planned_detail:'45 min', completed_override:true});
  addLog('2026-09-18', {planned_type:'strength', planned_title:'Garage Lift', planned_detail:'40 min'});
  const db = { profiles: {u1: {id:'u1', full_name:'Sam', goal:'mix', level:'intermediate', training_days:[0,1,3,4], focus_ratio:2, intensity_idx:1, plan_start:'2026-09-07'}}, workout_logs: logs };
  function from(table){
    let filters = [], op = 'select', payload = null;
    const api = {
      select(){ return api; }, order(){ return api; }, in(){ return api; }, is(){ return api; }, gte(){ return api; }, lte(){ return api; },
      eq(c,v){ filters.push([c,v]); return api; },
      upsert(p){ op='upsert'; payload=p; return api; }, update(p){ op='update'; payload=p; return api; }, insert(p){ op='insert'; payload=p; return api; }, delete(){ op='noop'; return api; },
      maybeSingle(){ return run(true); }, single(){ return run(true); },
      then(res, rej){ return run(false).then(res, rej); },
    };
    async function run(single){
      const rows = db[table];
      const hit = rows ? Object.values(rows).filter(r=>filters.every(([c,v])=>r[c]===v)) : [];
      if(op==='update'){ hit.forEach(r=>Object.assign(r, payload)); return {data:null, error:null}; }
      if(op!=='select') return {data: single ? {id:'x'+(n++)} : [], error:null};
      if(single) return {data: hit[0]||null, error:null};
      return {data: hit, error:null};
    }
    return api;
  }
  const user = {id:'u1', email:'sam@example.com'};
  return { db, createClient: () => ({
    auth: { async getSession(){ return {data:{session:{user}}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async signOut(){ return {}; } },
    from, functions: { async invoke(){ return {data:{connected:false}, error:null}; } },
  }) };
}

(async () => {
  const backend = makeBackend();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/Altiro/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; },
  });
  const w = dom.window, doc = w.document;
  await wait(300);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const tiles = () => [...doc.querySelectorAll('#progActivity .act-tile .v')].map(x=>x.textContent).join(' | ');
  const bars = () => [...doc.querySelectorAll('#progActivity .act-day .min')].map(x=>x.textContent||'-').join(',');
  const detail = () => doc.querySelector('#progActivity .act-detail').textContent.replace(/\s+/g,' ').trim();

  go('progress'); await wait(30);
  check('Progress has an Activity section: time, sets and reps for the week', tiles()==='2h 15m | 6 | 64', tiles());
  check('...with each day\'s minutes (Mon-Sun)', bars()==='35,35,20,45,-,-,-', bars());
  check('...today picked, nothing logged yet', /^Friday, Sep 18 Nothing logged$/.test(detail()), detail());
  doc.querySelector('[data-act-day="2026-09-14"]').click(); await wait(5);
  check('Tapping a day: its time, sets, reps and workout', detail()==='Monday, Sep 14 35 min · 6 sets · 64 reps Shoulder Day', detail());
  doc.querySelector('[data-act-day="2026-09-16"]').click(); await wait(5);
  check('...a walk logged by hand counts its time', detail()==='Wednesday, Sep 16 20 min Evening Walk', detail());
  doc.querySelector('[data-act-day="2026-09-17"]').click(); await wait(5);
  check('...a workout marked done without a time counts its planned time', detail()==='Thursday, Sep 17 45 min Leg Day', detail());

  // ---- a lifting workout is timed from start to save ----
  go('home'); await wait(30);
  doc.getElementById('recordBtn').click(); await wait(450);
  check('Starting a lifting workout: the log shows its time, counting', !doc.getElementById('logPerfTimeSection').hidden && doc.getElementById('logPerfTimeLabelEl').textContent==='Workout time (h:m:s)' && !doc.getElementById('logPerfTimeNote').hidden);
  const realNow = w.Date.now.bind(w.Date);
  w.Date.now = () => realNow() + 30*60*1000; // 30 minutes of lifting
  await wait(1100);
  check('...the clock runs', doc.getElementById('logPerfTimeMInput').value==='30', doc.getElementById('logPerfTimeMInput').value);
  const reps = doc.getElementById('logPerfRepsInput'); reps.value = '12';
  doc.getElementById('saveLogPerf').click(); await wait(60);
  w.Date.now = realNow;
  go('progress'); await wait(30);
  check('Saved: today counts its 30 minutes', bars()==='35,35,20,45,30,-,-', bars());
  check('...and the week adds it up', tiles()==='2h 45m | 7 | 76', tiles());
  doc.querySelector('[data-act-day="2026-09-18"]').click(); await wait(5);
  check('...today\'s line', detail()==='Friday, Sep 18 30 min · 1 set · 12 reps Garage Lift', detail());

  // Reopening it shows the time, and it can be corrected.
  go('calendar'); await wait(20);
  doc.querySelector('.mo-cell[data-date="2026-09-18"]').click(); await wait(20);
  doc.getElementById('dayDetailPlanRow').click(); await wait(30);
  // (A done workout opens its Summary; Edit there shows what was logged.)
  if(!doc.getElementById('screen-summary').hidden){ doc.getElementById('summaryEditBtn').click(); await wait(30); }
  check('Reopened: the workout time is there', doc.getElementById('logPerfTimeMInput').value==='30' && doc.getElementById('logPerfTimeNote').hidden, doc.getElementById('logPerfTimeMInput').value);
  const m = doc.getElementById('logPerfTimeMInput'); m.value = '45'; m.dispatchEvent(new w.Event('input', {bubbles:true}));
  doc.getElementById('saveLogPerf').click(); await wait(40);
  if(!doc.getElementById('dayDetailOverlay').hidden) doc.getElementById('closeDayDetail').click();
  go('progress'); await wait(30);
  check('...and corrected', bars()==='35,35,20,45,45,-,-' && tiles()==='3h | 7 | 76', `${bars()} / ${tiles()}`);

  // Another week
  const lastWeekBar = doc.querySelector('#progBarChart .bar-col[data-offset="-1"]');
  lastWeekBar.click(); await wait(20);
  check('Picking last week shows its activity', tiles()==='50 min | 3 | 30' && bars()==='-,-,-,-,50,-,-', `${tiles()} / ${bars()}`);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
