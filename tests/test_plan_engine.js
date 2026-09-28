const fs = require('fs');
const path = require('path');

// The plan engine's own rules, checked directly across many setups: the engine section of the app is
// pure (it only reads `state`), so it's lifted out of index.html and run on its own here.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const src = html.slice(html.indexOf('/* ---------------- plan engine ---------------- */'), html.indexOf('function fmtExercisePrescription(ex){'));
const E = new Function(`
  function ses(type, enT, enD, esT, esD){return {t:type, en:{title:enT, detail:enD}, es:{title:esT, detail:esD}};}
  function dateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function parseDateKey(key){ const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d); }
  const WEEK_MONDAY = new Date(2026,8,28), TODAY_DATE = WEEK_MONDAY;
  let state = {};
  ${src}
  return {setState: s => { state = s; }, generatePlanWeek, planConfig, exercisesForSession, weeklyRunMiles, planWeekIndex,
          LEVEL_PLAN, MOVEMENTS, EXERCISES, isRecoveryWeek};
`)();

let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail ? ' ('+detail+')' : ''}`);
}
function setup(o){
  E.setState({trainingDays:o.days, focusRatio:o.focus ?? 0, goal:o.goal ?? null, level:o.level ?? 'intermediate', intensityIdx:o.int ?? 1,
    weeklyMiles:o.miles ?? null, equipment:o.eq ?? 'gym', planStart:o.planStart ?? '2026-09-28', lang:'en'});
  return n => E.generatePlanWeek(E.planConfig(), n);
}
const miles = d => d.p.t==='run' ? parseFloat(d.p.en.detail) : 0;
const total = w => w.reduce((s,d)=>s+miles(d), 0);
const HARD = /Long Run|Tempo Run|Interval Run|Fartlek Run|Hill Repeats/;

// ---- every setup: right number of sessions, well-formed runs ----
const DAY_SETS = [[0],[1,4],[0,2,4],[1,3,5],[0,1,3,4],[1,2,3,5,6],[0,1,2,3,4],[0,1,2,3,4,5],[0,1,2,3,4,5,6]];
let sessionsOk = true, detailOk = true, longestOk = true, capOk = true, sessionsBad = '', detailBad = '', longestBad = '';
for(const days of DAY_SETS) for(const focus of [0,1,2,3,4]) for(const level of ['beginner','intermediate','advanced'])
for(const int of [0,1,2]) for(const mi of [0,8,25,45]) for(const n of [0,1,2,3,4,9,15]){
  const w = setup({days, focus, level, int, miles:mi})(n);
  const trained = w.filter(d=>d.p.t!=='rest').length;
  if(trained!==days.length){ sessionsOk = false; sessionsBad = `${days} f${focus} ${level}: ${trained}`; }
  const runs = w.filter(d=>d.p.t==='run');
  runs.forEach(d=>{ if(!/^\d+(\.5)?\s*mi\b/.test(d.p.en.detail) || !/^\d+(\.5)?\s*mi\b/.test(d.p.es.detail)){ detailOk = false; detailBad = d.p.en.detail; } });
  const top = Math.max(0, ...runs.map(miles));
  const long = runs.find(d=>d.p.en.title==='Long Run');
  if(long && miles(long) < top){ longestOk = false; longestBad = `${days} ${level} n${n}`; }
  if(top > E.LEVEL_PLAN[level].longCap) capOk = false;
}
check('Every setup schedules exactly one session per training day', sessionsOk, sessionsBad);
check('Every run\'s detail starts with its distance, in both languages', detailOk, detailBad);
check('The long run is always the week\'s longest run', longestOk, longestBad);
check('No run is ever longer than the level\'s longest run', capOk);

// ---- mileage builds, with a recovery week every 4th ----
const runner = setup({days:[1,2,3,5,6], focus:0, level:'advanced', miles:30});
const wk = [0,1,2,3,4,5,6,7,8].map(n=>total(runner(n)));
check('Week 0 starts at the miles the runner does now', Math.abs(wk[0]-30) <= 1, wk[0]);
check('Build weeks grow (0 < 1 < 2)', wk[0]<wk[1] && wk[1]<wk[2], wk.slice(0,3).join(' < '));
check('No build week grows more than ~10% (+ rounding)', [1,2,4,5,6].every(i=> wk[i] <= wk[i-1===3 ? 2 : i-1]*1.10 + 1.5), wk.join(', '));
check('Week 3 is a recovery week, clearly easier', wk[3] < wk[2]*0.9, `${wk[2]} -> ${wk[3]}`);
check('...and week 4 picks back up past week 2', wk[4] > wk[2], `${wk[2]} -> ${wk[4]}`);
check('Recovery week has no hard sessions besides the long run', runner(3).every(d=> !/Tempo|Interval|Fartlek|Hill/.test(d.p.en.title)));
const far = total(runner(40));
check('Mileage levels off at a ceiling instead of growing forever', far <= 30*1.5*1.02 + 1, far);

const lightVsHigh = [0,2].map(int=> total(setup({days:[1,2,3,5,6], focus:0, level:'intermediate', int, miles:20})(0)));
check('Light intensity plans fewer miles than High', lightVsHigh[0] < lightVsHigh[1], lightVsHigh.join(' vs '));

// ---- placement ----
const wk0 = runner(0);
check('Long run lands on Sunday when Sunday is a training day', wk0[6].p.en.title==='Long Run', wk0[6].p.en.title);
let adjacentHard = null;
for(const n of [0,1,2,4,5,6]){
  const w = runner(n);
  for(let d=0; d<6; d++) if(HARD.test(w[d].p.en.title) && HARD.test(w[d+1].p.en.title)) adjacentHard = `week ${n} day ${d}`;
}
check('Hard days are never back to back', !adjacentHard, adjacentHard);
const noWeekend = setup({days:[0,2,4], focus:0, level:'intermediate', miles:15})(0);
check('No weekend training day: long run goes on the last one (Friday)', noWeekend[4].p.en.title==='Long Run', noWeekend[4].p.en.title);
const lifter4 = setup({days:[0,1,3,4], focus:4, level:'intermediate'})(0);
check('4 lifting days: Upper / Lower / Upper B / Lower B, same group never on consecutive days',
  ['Upper Body Strength','Lower Body Strength','Upper Body Strength B','Lower Body Strength B'].join()===[0,1,3,4].map(d=>lifter4[d].p.en.title).join(),
  [0,1,3,4].map(d=>lifter4[d].p.en.title).join(', '));
const mix = setup({days:[0,2,4], focus:2, level:'intermediate', miles:12})(0);
check('Balanced 3-day plan: 2 runs + 1 lift', mix.filter(d=>d.p.t==='run').length===2 && mix.filter(d=>d.p.t==='strength').length===1);
const mixStrength = setup({days:[0,2,4], focus:2, goal:'strength', level:'intermediate', miles:12})(0);
check('...a strength goal tips an even split toward lifting', mixStrength.filter(d=>d.p.t==='strength').length===2);

// ---- mostly lifting: a runner's weekly miles aren't dumped onto one run ----
const fewRuns = setup({days:[0,1,2,3,4,5], focus:3, level:'advanced', miles:20})(0);
const oneRun = fewRuns.filter(d=>d.p.t==='run');
check('Mostly lifting with 1 run day: that run is a normal length, not the whole week\'s miles', oneRun.length===1 && miles(oneRun[0]) <= 8, oneRun.map(d=>d.p.en.detail));

// ---- beginners ----
const newbie = setup({days:[1,3,5], focus:0, level:'beginner', miles:0});
check('A brand-new runner starts on Run/Walk', newbie(0).filter(d=>d.p.t==='run').every(d=>d.p.en.title==='Run/Walk'));
check('...with the running part growing week to week', /run 2 min/.test(newbie(0)[1].p.en.detail) && /run 5 min/.test(newbie(3)[1].p.en.detail), newbie(3)[1].p.en.detail);
check('...and graduates to regular runs after 8 weeks', newbie(8).filter(d=>d.p.t==='run').every(d=>d.p.en.title!=='Run/Walk'));
const beginner = setup({days:[1,3,5], focus:0, level:'beginner', miles:8});
check('A beginner gets no hard runs in their first 4 weeks', [0,1,2,3].every(n=> beginner(n).every(d=> !/Tempo|Interval|Fartlek|Hill/.test(d.p.en.title))));
check('...and a gentle one (fartlek or hills) after that', beginner(4).some(d=>/Fartlek|Hill/.test(d.p.en.title)));

// ---- exercises follow equipment and level ----
function exercisesFor(o, title, date){
  setup(o);
  return E.exercisesForSession({t:'strength', en:{title}}, date || new Date(2026,8,30));
}
const LIFTS = ['Full Body Strength','Full Body Strength B','Upper Body Strength','Lower Body Strength','Push Day Strength','Pull Day Strength','Upper Body Strength B'];
let bwOnly = true, dbOnly = true, noAdvancedForBeginner = true;
for(let wkOffset=0; wkOffset<8; wkOffset++){
  const date = new Date(2026,8,30+wkOffset*7);
  for(const title of LIFTS){
    exercisesFor({days:[0,2,4], focus:4, eq:'bodyweight'}, title, date).forEach(ex=>{ if(!ex.bodyweight) bwOnly = false; });
    exercisesFor({days:[0,2,4], focus:4, eq:'dumbbells'}, title, date).forEach(ex=>{
      if(!Object.values(E.MOVEMENTS).some(m=>m.dumbbells.includes(ex.key))) dbOnly = false;
    });
    exercisesFor({days:[0,2,4], focus:4, eq:'gym', level:'beginner'}, title, date).forEach(ex=>{
      if(E.EXERCISES[ex.key].minLevel) noAdvancedForBeginner = false;
    });
  }
}
check('Bodyweight-only plans only use bodyweight moves', bwOnly);
check('Dumbbells-at-home plans never use gym-only equipment', dbOnly);
check('Beginners don\'t get technical lifts (Pull-Up, Front Squat, ...)', noAdvancedForBeginner);
const upperA = exercisesFor({days:[0,1,3,4], focus:4, eq:'gym'}, 'Upper Body Strength').map(e=>e.key);
const upperB = exercisesFor({days:[0,1,3,4], focus:4, eq:'gym'}, 'Upper Body Strength B').map(e=>e.key);
check('A second Upper day in the same week uses different exercises', upperA.join()!==upperB.join(), upperA.join()+' / '+upperB.join());
const mainLifts = [0,1,2,3].map(w=> exercisesFor({days:[0,2,4], focus:4}, 'Lower Body Strength', new Date(2026,8,28+w*7))[0].key);
check('Main lifts stay the same through a 4-week block, so they can progress', new Set(mainLifts).size===1, mainLifts.join(', '));
const setsNormal = exercisesFor({days:[0,2,4], focus:4, level:'advanced'}, 'Push Day Strength', new Date(2026,8,28))[0].sets;
const setsRecovery = exercisesFor({days:[0,2,4], focus:4, level:'advanced'}, 'Push Day Strength', new Date(2026,9,19))[0].sets;
check('Recovery week lifts a set less', setsRecovery===setsNormal-1, `${setsNormal} -> ${setsRecovery}`);
const squatBw = exercisesFor({days:[0,2,4], focus:4, eq:'bodyweight'}, 'Lower Body Strength', new Date(2026,8,28))[0];
check('A bodyweight move keeps its own reps (not the barbell lift\'s)', squatBw.reps!==8, `${squatBw.name} x${squatBw.reps}`);

console.log('ALL DONE');
process.exit(failures ? 1 : 0);
