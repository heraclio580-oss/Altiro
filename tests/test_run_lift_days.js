const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Adjust -> "Run + lift days": training days that get a lifting workout as well as the run. The plan keeps
// every run and adds the lifting on those days (placed around the runs); the lifting workout is listed with
// the day's workouts and made a real one when it's started; taking it off one day keeps it off (with Undo).
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// ---- the engine on its own ----
const src = html.slice(html.indexOf('/* ---------------- plan engine ---------------- */'), html.indexOf('function fmtExercisePrescription(ex){'));
const E = new Function(`
  function ses(type, enT, enD, esT, esD){return {t:type, en:{title:enT, detail:enD}, es:{title:esT, detail:esD}};}
  function dateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function parseDateKey(key){ const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d); }
  const WEEK_MONDAY = new Date(2026,8,28), TODAY_DATE = WEEK_MONDAY;
  let state = {};
  function exerciseProgressionKey(key){ return 'strength:'+key; }
  function getExerciseTarget(){ return null; }
  ${src}
  return {setState: s => { state = s; }, generatePlanWeek, planConfig};
`)();
function week(o, n){
  E.setState({trainingDays:o.days, focusRatio:o.focus ?? 0, goal:null, level:o.level ?? 'intermediate', intensityIdx:2, weeklyMiles:25, equipment:'gym',
    planStart:'2026-09-28', lang:'en', progression:{}, classes:[], hardRunDay:o.hard ?? null, longRunDay:null, runLiftDays:o.both ?? []});
  return E.generatePlanWeek(E.planConfig(), n);
}
const RUNS = [0,1,2,3,5];
const plain = week({days:RUNS}, 0);
const all = week({days:RUNS, both:RUNS}, 0);
check('Running only, Mon-Thu + Sat, every day run + lift: every run stays as it was',
  RUNS.every(d=> all[d].p.t==='run' && all[d].p.en.title===plain[d].p.en.title && all[d].p.en.detail===plain[d].p.en.detail),
  RUNS.map(d=> all[d].p.en.title).join(','));
check('...and each of those days has a lifting workout too', RUNS.every(d=> all[d].x && all[d].x.t==='strength'), RUNS.map(d=> all[d].x && all[d].x.en.title).join(','));
check('...with the week\'s wave over them: one peak', RUNS.filter(d=> all[d].xWave && all[d].xWave.pos==='peak').length===1, RUNS.map(d=> all[d].xWave && all[d].xWave.pos).join(','));
check('...and no add-on on a run + lift day (the lifting is its pairing)', RUNS.every(d=> !all[d].c));
check('Rest days stay rest', all[4].p.t==='rest' && !all[4].x && all[6].p.t==='rest');
const LEGS = /Lower Body|Legs|Leg Day/;
let legsOk = true, legsBad = '';
for(const n of [0,1,2,4,5]) for(const both of [[0,1,2,3,5],[0,2,3],[1,3],[2],[0,1,2,3]]){
  const w = week({days:RUNS, both}, n);
  both.forEach(d=>{
    const next = w[(d+1)%7].p;
    if(w[d].x && LEGS.test(w[d].x.en.title) && next.t==='run' && /Long Run|Tempo|Interval|Fartlek|Hill/.test(next.en.title) && both.length<5){ legsOk = false; legsBad = `${both} wk${n} day${d}`; }
  });
  if(both.some(d=> !w[d].x || w[d].p.t!=='run')){ legsOk = false; legsBad = 'missing '+both+' wk'+n; }
}
check('A heavy leg day isn\'t put the day before a hard run (when the week leaves room)', legsOk, legsBad);
const two = week({days:RUNS, both:[1,3]}, 0);
check('Just Tue + Thu: lifting on those two, the other days plain runs', [1,3].every(d=> two[d].x) && [0,2,5].every(d=> !two[d].x && two[d].p.t==='run'));
const mostly = week({days:RUNS, focus:1, both:[0,1,2,3]}, 0);
check('Mostly running + lifting Mon-Thu: Saturday stays a run -- the long run -- with no lifting',
  mostly[5].p.t==='run' && /Long Run/.test(mostly[5].p.en.title) && !mostly[5].x && [0,1,2,3].every(d=> mostly[d].p.t==='run' && mostly[d].x),
  RUNS.map(d=> mostly[d].p.en.title+(mostly[d].x ? '+'+mostly[d].x.en.title : '')).join(' | '));
const balanced = week({days:RUNS, focus:2, both:[1,3]}, 0);
check('Balanced + Tue/Thu run + lift: those cover its lifting days -- every day a run',
  RUNS.every(d=> balanced[d].p.t==='run') && [1,3].every(d=> balanced[d].x), RUNS.map(d=> balanced[d].p.en.title+(balanced[d].x ? '+'+balanced[d].x.en.title : '')).join(' | '));
const mixed = week({days:RUNS, focus:3, both:[1,3]}, 0);
check('Mostly lifting + Tue/Thu run + lift: still lifting-only days for the rest of its lifting',
  [1,3].every(d=> mixed[d].p.t==='run' && mixed[d].x) && RUNS.filter(d=> mixed[d].p.t==='strength').length===2, RUNS.map(d=> mixed[d].p.en.title+(mixed[d].x ? '+'+mixed[d].x.en.title : '')).join(' | '));
const heavy = week({days:RUNS, focus:4, both:[1,3]}, 0);
check('Weights only: run + lift days do nothing (no runs to pair with)', RUNS.every(d=> heavy[d].p.t==='strength' && !heavy[d].x));
check('No run + lift days: the plan is exactly as before', JSON.stringify(week({days:RUNS, both:[]}, 3))===JSON.stringify(week({days:RUNS}, 3)));

// ---- in the app ----
(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-10-12'; } }); // a Monday
  const { window } = dom;
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const key = k => doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:k, bubbles:true}));
  const shown = id => !doc.getElementById(id).hidden;

  go('adjust'); await wait(10);
  for(let i=0;i<4;i++) key('ArrowLeft');
  for(let pass=0; pass<2; pass++) for(let d=0; d<7; d++){
    const chip = doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`);
    const want = RUNS.includes(d);
    if(chip.classList.contains('sel')!==want && (pass===0 ? !want : want)) chip.click();
  }
  await wait(10);
  const chips = () => [...doc.querySelectorAll('#adjRunLiftChips [data-run-lift-day]')].map(c=> c.textContent + (c.classList.contains('sel') ? '*' : ''));
  check('Adjust has "Run + lift days" with each training day', shown('adjRunLiftSection') && chips().join(',')==='MON,TUE,WED,THU,SAT', chips().join(','));
  check('Running only: no equipment / lifting split yet', !shown('adjEquipSection'));
  doc.querySelector('#adjRunLiftChips [data-run-lift-day="0"]').click();
  doc.querySelector('#adjRunLiftChips [data-run-lift-day="2"]').click();
  check('Tapping Mon and Wed picks them, and says what it does', chips().join(',')==='MON*,TUE,WED*,THU,SAT' && /Run \+ lift on MON · WED/.test(doc.getElementById('adjRunLiftNote').textContent), doc.getElementById('adjRunLiftNote').textContent);
  check('...and lifting\'s settings show (equipment, split, lifting intensity)', shown('adjEquipSection') && shown('adjLiftIntensitySection'));
  doc.getElementById('applyAdjust').click(); await wait(20);

  // Signing in redraws the setup screens (language, focus preview) with the saved plan -- a run + lift day
  // has no add-on, which used to break that preview and with it signing in.
  let threw = null;
  try{ go('onb-focus'); await wait(20); doc.querySelector('.lang-btn[data-lang="es"]').click(); doc.querySelector('.lang-btn[data-lang="en"]').click(); }catch(e){ threw = e; }
  check('Setup\'s plan preview (redrawn when signing in) works with run + lift days', !threw && /(paired with|combinad).*(strength|fuerza)/i.test(doc.getElementById('onbPreview').textContent), threw ? threw.message : doc.getElementById('onbPreview').textContent);

  go('week'); await wait(20);
  const row = (w, d) => (doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`) || {textContent:''}).textContent.replace(/\s+/g,' ');
  const lifted = (w, d) => !!doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"] .prow-lift`);
  check('Plan: Monday and Wednesday show a lifting workout under the run', lifted(0,0) && lifted(0,2) && /Run/.test(row(0,0)), row(0,0)+' | '+row(0,2));
  check('...the other run days don\'t', !lifted(0,1) && !lifted(0,3) && !lifted(0,5));
  check('...next week too', lifted(1,0) && lifted(1,2));

  go('calendar'); await wait(20);
  const cal = d => (doc.querySelector(`#calGrid .mo-cell[data-date="${d}"] .mo-desc-a`) || {textContent:''}).textContent;
  check('Calendar: a run + lift day shows its lifting workout as +1', /\+1/.test(cal('2026-10-14')) && !/\+/.test(cal('2026-10-13')), cal('2026-10-14')+' / '+cal('2026-10-13'));

  // Today (Monday): the lifting workout is under "Also today", ready to start.
  go('home'); await wait(20);
  const also = doc.querySelector('#homeExtraWorkoutsWrap [data-extra-id="planlift"]');
  check('Home: today\'s lifting workout is listed under Also today', !!also && shown('homeAlsoToday'), also && also.textContent.replace(/\s+/g,' '));
  check('...with its exercises', !!(also && also.querySelector('.r-exercise-list, .r-ex, li')), also && also.innerHTML.slice(0,200));
  also.querySelector('[data-start-extra]').click(); await wait(30);
  check('Start opens Log Performance for it', !doc.getElementById('logPerfOverlay').hidden);
  const closeLp = doc.getElementById('closeLogPerf') || doc.querySelector('#logPerfOverlay .iconbtn');
  if(closeLp) closeLp.click();
  await wait(20);
  go('home'); await wait(20);
  const realRows = [...doc.querySelectorAll('#homeExtraWorkoutsWrap [data-extra-id]')];
  check('Once started it\'s a real workout of the day (listed once, not twice)', realRows.length===1 && realRows[0].getAttribute('data-extra-id')!=='planlift', realRows.map(r=>r.getAttribute('data-extra-id')).join(','));

  // The run done: the lifting workout is what's next, on the main card.
  doc.getElementById('homeCompleteToggle').click(); await wait(20);
  go('home'); await wait(20);
  check('Run done: the lifting workout takes the main card', /Strength/.test(doc.querySelector('#sessionCard .title').textContent), doc.querySelector('#sessionCard .title').textContent);

  // Wednesday: take it off, then Undo.
  const wedKey = '2026-10-14';
  window.document.querySelector('#weekStrip .day-cell[data-date="'+wedKey+'"]').click(); await wait(20);
  const ddLift = () => doc.querySelector('#dayDetailExtraWorkouts [data-extra-id="planlift"]');
  check('Day Detail (Wednesday): the lifting workout is listed', !!ddLift());
  ddLift().click(); await wait(20);
  check('Tapping it previews it (a future day)', !doc.getElementById('workoutPreviewOverlay').hidden && /Strength/.test(doc.getElementById('wpTitle').textContent), doc.getElementById('wpTitle').textContent);
  doc.getElementById('closeWorkoutPreview').click(); await wait(10);
  ddLift().querySelector('[data-del-extra]').click(); await wait(20);
  check('Deleting it takes it off Wednesday', !ddLift());
  go('week'); await wait(20);
  check('...and off the Plan row', !lifted(0,2) && lifted(1,2));
  doc.getElementById('toastUndo').click(); await wait(20);
  go('week'); await wait(20);
  check('Undo brings it back', lifted(0,2));

  // Weights only: the choice goes away.
  go('adjust'); await wait(10);
  check('Reopening Adjust shows Mon + Wed chosen', chips().join(',')==='MON*,TUE,WED*,THU,SAT', chips().join(','));
  for(let i=0;i<4;i++) key('ArrowRight');
  await wait(10);
  check('Weights only: no "Run + lift days"', !shown('adjRunLiftSection'));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
