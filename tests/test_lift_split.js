const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Users choose how their lifting is split across the week -- full body every day, push/pull/legs, or one
// muscle group a day (chest, back, legs, shoulders, arms) -- or let Altiro choose. Arm and shoulder days
// bring curls, triceps extensions, shoulder presses and raises.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? `OK${detail ? ' ('+detail+')' : ''}` : `FAIL${detail ? ' ('+detail+')' : ''}`);
}

// ---------------- the engine ----------------
const src = html.slice(html.indexOf('/* ---------------- plan engine ---------------- */'), html.indexOf('function fmtExercisePrescription(ex){'));
const E = new Function(`
  function ses(type, enT, enD, esT, esD){return {t:type, en:{title:enT, detail:enD}, es:{title:esT, detail:esD}};}
  function dateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function parseDateKey(key){ const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d); }
  const WEEK_MONDAY = new Date(2026,8,28), TODAY_DATE = WEEK_MONDAY;
  let state = {};
  function exerciseProgressionKey(key){ return 'strength:'+key; }
  function getExerciseTarget(ex){ return ex.bodyweight ? null : {weight:80, reps:10}; }
  ${src}
  return {setState: s => { state = s; }, generatePlanWeek, planConfig, exercisesForSession};
`)();
function week(o, n=0){
  E.setState({trainingDays:o.days, focusRatio:4, goal:'strength', level:o.level ?? 'intermediate', intensityIdx:1, liftSplit:o.split,
    weeklyMiles:null, equipment:o.eq ?? 'gym', planStart:'2026-09-28', lang:'en', progression:{}, weightUnit:'lb'});
  return E.generatePlanWeek(E.planConfig(), n).map((d,i)=>({...d, date:new Date(2026, 8, 28 + 7*n + i)})).filter(d=>d.p.t==='strength');
}
const titles = w => w.map(d=>d.p.en.title);
const sorted = w => titles(w).slice().sort().join(', ');
const exs = d => E.exercisesForSession(d.p, d.date).map(e=>e.key);

check('Full body: every lifting day is a full-body workout', titles(week({days:[0,1,2,3,4], split:'full'})).every(t=>/^Full Body Strength/.test(t)), titles(week({days:[0,1,2,3,4], split:'full'})).join(', '));
check('Push / Pull / Legs, 3 days', sorted(week({days:[0,2,4], split:'ppl'}))==='Leg Day, Pull Day Strength, Push Day Strength', sorted(week({days:[0,2,4], split:'ppl'})));
check('...6 days runs it twice', sorted(week({days:[0,1,2,3,4,5], split:'ppl'}))==='Leg Day, Leg Day B, Pull Day Strength, Pull Day Strength B, Push Day Strength, Push Day Strength B', sorted(week({days:[0,1,2,3,4,5], split:'ppl'})));
check('...2 days: push & legs, pull & legs', sorted(week({days:[1,4], split:'ppl'}))==='Pull & Legs Day, Push & Legs Day', sorted(week({days:[1,4], split:'ppl'})));
check('One muscle group a day, 5 days: chest, back, legs, shoulders, arms', sorted(week({days:[0,1,2,3,4], split:'bodypart'}))==='Arm Day, Back Day, Chest Day, Leg Day, Shoulder Day', sorted(week({days:[0,1,2,3,4], split:'bodypart'})));
check('...4 days: shoulders and arms together', sorted(week({days:[0,1,3,4], split:'bodypart'}))==='Back Day, Chest Day, Leg Day, Shoulders & Arms Day', sorted(week({days:[0,1,3,4], split:'bodypart'})));
check('...3 days: chest & triceps, back & biceps, legs & shoulders', sorted(week({days:[0,2,4], split:'bodypart'}))==='Back & Biceps Day, Chest & Triceps Day, Legs & Shoulders Day', sorted(week({days:[0,2,4], split:'bodypart'})));
check('Let Altiro choose: the plan\'s own split (as before)', sorted(week({days:[0,1,3,4]}))==='Lower Body Strength, Lower Body Strength B, Upper Body Strength, Upper Body Strength B', sorted(week({days:[0,1,3,4]})));

// Arm and shoulder work
const CURLS = ['Bicep Curl','Preacher Curl','Hammer Curl','Concentration Curl'];
const TRIS = ['Triceps Pushdown','Overhead Triceps Extension','Skull Crusher','Triceps Dip'];
let armWeeks = [], shoulderWeeks = [];
for(let n=0; n<4; n++){
  const w = week({days:[0,1,2,3,4], split:'bodypart'}, n);
  armWeeks.push(exs(w.find(d=>d.p.en.title==='Arm Day')));
  shoulderWeeks.push(exs(w.find(d=>d.p.en.title==='Shoulder Day')));
}
check('Arm Day: curls and triceps extensions', armWeeks.every(a=> a.some(k=>CURLS.includes(k)) && a.some(k=>TRIS.includes(k))), armWeeks[0].join(', '));
const curlsSeen = new Set(armWeeks.flat().filter(k=>CURLS.includes(k)));
check('...rotating through bicep, preacher, hammer and concentration curls', curlsSeen.has('Preacher Curl') && curlsSeen.has('Hammer Curl') && curlsSeen.size>=3, [...curlsSeen].join(', '));
check('Shoulder Day: a shoulder press, lateral raises, rear delts and front raises',
  shoulderWeeks.every(sh=> /Press/.test(sh[0]) && sh.some(k=>/Lateral Raise/.test(k)) && sh.some(k=>['Face Pull','Reverse Fly','Rear Delt Raise','Band Pull-Apart'].includes(k)) && sh.some(k=>['Front Raise','Upright Row'].includes(k))), shoulderWeeks[0].join(', '));
check('Push day now includes lateral raises; pull day, curls', exs(week({days:[0,2,4], split:'ppl'}).find(d=>/Push/.test(d.p.en.title))).some(k=>/Lateral Raise/.test(k)) && exs(week({days:[0,2,4], split:'ppl'}).find(d=>/Pull/.test(d.p.en.title))).some(k=>CURLS.includes(k)));
const dbWeek = week({days:[0,1,2,3,4], split:'bodypart', eq:'dumbbells'});
const dbArms = exs(dbWeek.find(d=>d.p.en.title==='Arm Day')), dbShoulders = exs(dbWeek.find(d=>d.p.en.title==='Shoulder Day'));
check('Dumbbells at home get arm and shoulder work too (no cable or machine moves)',
  dbArms.some(k=>CURLS.includes(k)) && dbArms.some(k=>['Overhead Triceps Extension','Skull Crusher','Bench Dip'].includes(k)) && dbShoulders.includes('Lateral Raise')
  && ![...dbArms, ...dbShoulders].some(k=>/Cable|Pushdown|Face Pull/.test(k)), dbArms.join(', ')+' | '+dbShoulders.join(', '));
const peakDay = week({days:[0,1,2,3,4], split:'bodypart'}).find(d=>d.wave && d.wave.pos==='peak');
check('The week\'s peak (a press week) lands on Chest Day', peakDay && peakDay.p.en.title==='Chest Day', peakDay && peakDay.p.en.title);

// ---------------- in the app ----------------
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(50);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('adjust'); await wait(20);
  for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  doc.querySelector('#adjDayCountChips .chip[data-count="5"]').click();
  for(let pass=0; pass<2; pass++) for(let d=0; d<7; d++){
    const chip = doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`);
    const want = d<5;
    if(chip.classList.contains('sel')!==want && (pass===0 ? !want : want)) chip.click();
  }
  const chips = [...doc.querySelectorAll('#adjLiftSplitChips .chip')].map(c=>c.textContent);
  check('Adjust asks how to split the lifting', chips.join()==='Let Altiro choose,Full body every day,Push / Pull / Legs,One muscle group a day', chips.join(', '));
  check('...Let Altiro choose by default', (doc.querySelector('#adjLiftSplitChips .chip.sel')||{}).textContent==='Let Altiro choose');
  check('The "get stronger at" question is gone', !doc.getElementById('adjStrengthFocusChips'));
  [...doc.querySelectorAll('#adjLiftSplitChips .chip')].find(c=>c.textContent==='One muscle group a day').click();
  await wait(5);
  const note = doc.getElementById('adjLiftSplitNote').textContent;
  check('...and shows the week it gives', note==='5 lifting days a week: Chest Day · Back Day · Leg Day · Shoulder Day · Arm Day', note);
  doc.getElementById('applyAdjust').click(); await wait(30);
  go('week'); await wait(20);
  const next = [0,1,2,3,4].map(d=> doc.querySelector(`.plan-row[data-week-idx="1"][data-day="${d}"] .prow-title`).textContent);
  check('Next week is one muscle group a day', next.slice().sort().join()==='Arm Day,Back Day,Chest Day,Leg Day,Shoulder Day', next.join(', '));
  go('calendar'); await wait(20);
  doc.getElementById('calNext').click(); await wait(20);
  const cal = doc.querySelector('.mo-cell[data-date="2026-10-05"]').textContent.replace(/\s+/g,' ');
  check('The calendar gives them short names', /Chest|Back|Legs|Shoulders|Arms/.test(cal), cal.trim());

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
