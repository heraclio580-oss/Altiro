const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Small polish, from a look through every screen:
// - Calendar: a class day's workout keeps its distance or time ("3.5 mi"), with the class shown by its
//   icon only -- the "+1" it also added pushed the amount out of the cell ("3.5 …").
// - Today's class row: Start class goes under the class's time, which then fits ("6:00 PM · 1h 30m").
// - "Superset with above" between every two exercises is just a link icon until it's used (its words
//   kept for screen readers and as its tooltip), and the help text says so.
// - A lift's history keeps its unit with its last set ("175×10 lb", never "lb" alone on a line).
// - An exercise line's (i) stays with its last word.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const bench = sets => ({key:'Bench Press', name:'Bench Press', weight:sets[sets.length-1][0], reps:sets[sets.length-1][1], sets:sets.map(([weight,reps])=>({weight,reps}))});
const logRows = [
  {id:'a', user_id:'u1', log_date:'2026-09-09', completed_override:true, manual_entries:[], performance:{exercises:[bench([[165,10],[170,10],[175,10],[175,10]])]}},
  {id:'b', user_id:'u1', log_date:'2026-09-14', completed_override:true, manual_entries:[], performance:{exercises:[bench([[165,10],[170,10],[175,10],[180,10]])]}},
];
function makeBackend(){
  function from(table){
    let op = 'select';
    const filters = {};
    const api = {
      select(){ return api; }, eq(c, v){ filters[c] = v; return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; }, in(){ return api; }, limit(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ op = 'delete'; return api; }, update(){ op = 'update'; return api; }, upsert(){ op = 'upsert'; return api; }, single(){ return api.maybeSingle(); },
      maybeSingle(){
        if(table==='workout_logs') return Promise.resolve({data: logRows.find(r=>r.log_date===filters.log_date) || null, error:null});
        return Promise.resolve({data: table==='profiles' ? {id:'u1', goal:'mix', training_days:[0,2,4,5], focus_ratio:2, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-09-07',
          classes:[{id:'c1', kind:'jiujitsu', name:'Jiu-Jitsu', days:[4], time:'18:00', minutes:90, from:'2026-09-07', skips:[]}]} : null, error:null});
      },
      then(res, rej){ return Promise.resolve({data: op==='select' ? (table==='workout_logs' ? logRows : []) : null, error:null}).then(res, rej); },
    };
    return api;
  }
  return { createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}

(async () => {
  const backend = makeBackend();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(300);
  const w = dom.window, doc = w.document;
  for(const id of ['badgeOverlay', 'locPromptOverlay']) doc.getElementById(id).hidden = true;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Calendar: Fridays have Jiu-Jitsu besides their workout.
  go('calendar');
  await wait(30);
  const fridays = [...doc.querySelectorAll('#screen-calendar .mo-cell')].filter(c=> c.querySelector('.mo-class'));
  check('Calendar: class days show the class icon', fridays.length>=3, fridays.length);
  const amounts = fridays.map(c=> (c.querySelector('.mo-desc-a') || {textContent:''}).textContent.trim());
  check('...and the workout\'s own amount, with no "+1" for the class', amounts.some(a=> /\d/.test(a)) && amounts.every(a=> !/\+1/.test(a)), amounts.join(' | '));

  // Today (a Friday): the class row.
  go('home');
  await wait(30);
  const row = doc.querySelector('#screen-home .class-entry');
  check('Today\'s class row: Start class sits under its time', !!row && !!row.querySelector('.body [data-class-start]') && /6:00 PM · 1h 30m/.test(row.querySelector('.body .v').textContent), row && row.querySelector('.body .v').textContent);

  // An exercise line's (i) stays with its last word.
  const tipLine = [...doc.querySelectorAll('#screen-home .r-exercise-list li')].find(li=> li.querySelector('.term-btn, [data-term]'));
  check('An exercise line\'s (i) is kept with its last word', !!tipLine && !!tipLine.querySelector('.rx-end [data-term]'), tipLine && tipLine.innerHTML.slice(0, 160));

  // The workout sheet: unlinked exercises show just the link icon (its words for screen readers / tooltip).
  doc.getElementById('recordBtn').click();
  await wait(950);
  const links = [...doc.querySelectorAll('#logPerfExercisesList .live-ss-link')];
  const off = links.filter(b=> b.getAttribute('aria-pressed')==='false');
  check('Workout sheet: an unlinked pair shows the link icon, labelled "Superset with above" for screen readers and as a tooltip', off.length>0 && off.every(b=> b.title==='Superset with above' && /Superset with above/.test(b.textContent) && !!b.querySelector('svg')), off.length + ' ' + (off[0] && off[0].title));
  const css = [...doc.querySelectorAll('style')].map(s=> s.textContent).join('\n');
  check('...the words only shown once it\'s linked', /\.ss-link\[aria-pressed="false"\] > span\{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect\(0 0 0 0\)/.test(css));
  doc.getElementById('closeLogPerf').click();
  await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  check('Create workout: the help says to tap the link icon', /tap the link icon above the second one/.test(doc.getElementById('manualEntryOverlay').textContent));
  doc.getElementById('closeManualEntry').click();

  // A lift's history: the unit stays with the last set.
  go('progress');
  await wait(30);
  doc.querySelector('#liftProgress [data-lift="Bench Press"]').click();
  await wait(20);
  const hist = [...doc.querySelectorAll('#liftDetailBody .lift-hist .st')].map(e=> e.textContent);
  check('Lift history: "lb" is joined to the last set, never alone on a line', hist.length===2 && hist.every(t=> /×10 lb$/.test(t)), JSON.stringify(hist));

  // In Spanish.
  doc.getElementById('closeLiftDetail').click();
  doc.querySelector('.lang-btn[data-lang="es"]').click();
  await wait(30);
  go('home');
  await wait(30);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  check('In Spanish: the help says to tap the link icon', /toca el ícono de enlace sobre el segundo ejercicio/.test(doc.getElementById('manualEntryOverlay').textContent));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
