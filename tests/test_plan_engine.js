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
  // Lift targets live outside the engine; none set here, so every lift shows its plan numbers.
  function exerciseProgressionKey(key){ return 'strength:'+key; }
  function getExerciseTarget(){ return null; }
  ${src}
  return {setState: s => { state = s; }, generatePlanWeek, planConfig, exercisesForSession, exerciseAlternatives, weeklyRunMiles, planWeekIndex,
          LEVEL_PLAN, MOVEMENTS, EXERCISES, isRecoveryWeek};
`)();

let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail ? ' ('+detail+')' : ''}`);
}
function setup(o){
  E.setState({trainingDays:o.days, focusRatio:o.focus ?? 0, goal:o.goal ?? null, level:o.level ?? 'intermediate', intensityIdx:o.int ?? 1,
    weeklyMiles:o.miles ?? null, equipment:o.eq ?? 'gym', jogBaseline:o.jog ?? null, planStart:o.planStart ?? '2026-09-28', lang:'en', progression:{}});
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
  // Timed sessions (a new runner's walks and run/walks) start with their minutes; every other run with its miles.
  const timed = d => /^(Run\/Walk|Brisk Walk|Walk \+ Jog)$/.test(d.p.en.title);
  const runs = w.filter(d=>d.p.t==='run' && !timed(d));
  w.filter(d=>d.p.t==='run').forEach(d=>{
    const lead = timed(d) ? /^\d+ min\b/ : /^\d+(\.5)?\s*mi\b/;
    if(!lead.test(d.p.en.detail) || !lead.test(d.p.es.detail)){ detailOk = false; detailBad = d.p.en.detail; }
  });
  const top = Math.max(0, ...runs.map(miles));
  const long = runs.find(d=>d.p.en.title==='Long Run');
  if(long && miles(long) < top){ longestOk = false; longestBad = `${days} ${level} n${n}`; }
  if(top > E.LEVEL_PLAN[level].longCap) capOk = false;
}
check('Every setup schedules exactly one session per training day', sessionsOk, sessionsBad);
check('Every run\'s detail starts with its distance (or a timed session\'s minutes), in both languages', detailOk, detailBad);
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
check('Long run lands on Saturday when Saturday is a training day', wk0[5].p.en.title==='Long Run', wk0[5].p.en.title);
check('...with a short recovery run the day after', wk0[6].p.en.title==='Recovery Jog' && miles(wk0[6]) < miles(wk0[5])/2, wk0[6].p.en.title+' '+wk0[6].p.en.detail);
check('...and the week\'s one fast session early (Tuesday)', /Tempo Run|Interval Run/.test(wk0[1].p.en.title), wk0[1].p.en.title);
check('One quality run a week, even for an advanced runner on High', [0,1,2,4,5].every(n=> setup({days:[1,2,3,5,6], focus:0, level:'advanced', int:2, miles:30})(n).filter(d=>HARD.test(d.p.en.title) && d.p.en.title!=='Long Run').length===1));
// The building block, shaped like a real week: 4 runs of ~30 mi -> tempo 4.5, longer easy 6.5, long 16, recovery 3.5.
const block = setup({days:[1,3,5,6], focus:0, level:'intermediate', miles:30})(0);
const bl = [1,3,5,6].map(d=>block[d].p.en.title+' '+block[d].p.en.detail);
check('4 runs a week: fast Tuesday, longer easy Thursday, long Saturday, recovery Sunday',
  /^(Tempo Run|Interval Run)/.test(bl[0]) && /^Easy Run .*longer easy/.test(bl[1]) && /^Long Run/.test(bl[2]) && /^Recovery Jog/.test(bl[3]), bl.join(' | '));
check('...the long run about half the week, the longer easy run next, the recovery run shortest',
  miles(block[5]) >= total(block)*0.42 && miles(block[3]) > miles(block[1]) && miles(block[6]) <= miles(block[1]), bl.join(' | '));
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
// New to running: timed walks and run/walks by feel, building step by step.
const runsOf = w => w.filter(d=>d.p.t==='run');
const newbie = setup({days:[1,3,5], focus:0, level:'beginner', miles:0}); // Moderate
const det = (w, d) => w[d].p.en.title+' '+w[d].p.en.detail;
check('Week 1 for a brand-new runner: a 20-min walk, then walks ending in 5 min of jogging',
  det(newbie(0),1)==='Brisk Walk 20 min' && /^Walk \+ Jog 20 min · walk 15 min, then jog the last 5 min at your walking pace$/.test(det(newbie(0),3)) && /jog the last 5 min a touch quicker$/.test(det(newbie(0),5)),
  runsOf(newbie(0)).map(d=>d.p.en.title+' '+d.p.en.detail).join(' | '));
check('Week 2 (no jog logged yet): walk 10, then jog 3 / walk 1 to the end', newbie(1)[1].p.en.detail==='20 min · walk 10 min, then jog 3 min / walk 1 min to the end', newbie(1)[1].p.en.detail);
const logged2 = setup({days:[1,3,5], focus:0, level:'beginner', miles:0, jog:{min:2, week:0, held:false}});
check('...built from the jog they actually held in week 1 (2 min)', /jog 2 min \/ walk 1 min/.test(logged2(1)[1].p.en.detail), logged2(1)[1].p.en.detail);
const blockOf = w => +((w[1].p.en.detail.match(/jog (?:the whole )?(\d+) min/)||[])[1]);
const blocks = [1,2,3,4,5,6,7,8].map(n=>blockOf(newbie(n)));
check('Jog blocks grow each week (a recovery week repeats the one before)', blocks[0]<blocks[1] && blocks[2]===blocks[1] && blocks[3]>blocks[2] && blocks[7]>blocks[3], blocks.join(', '));
check('The starting walk shrinks: 10, then 5, then none', /walk 10 min/.test(newbie(1)[1].p.en.detail) && /walk 5 min/.test(newbie(2)[1].p.en.detail) && !/walk \d+ min, then/.test(newbie(5)[1].p.en.detail), [1,2,5].map(n=>newbie(n)[1].p.en.detail).join(' | '));
const held = setup({days:[1,3,5], focus:0, level:'beginner', miles:0, jog:{min:4, week:2, held:true}})(4);
check('Held the block: next week it grows', blockOf(held)===5, held[1].p.en.detail);
const missed = setup({days:[1,3,5], focus:0, level:'beginner', miles:0, jog:{min:3, week:2, held:false}})(4);
check('Couldn\'t hold it: next week repeats what they managed', blockOf(missed)===3, missed[1].p.en.detail);
setup({days:[1,3,5], focus:0, level:'beginner', miles:0});
check('...with no miles planned for timed sessions', [0,1,2,5].every(n=> runsOf(newbie(n)).every(d=>!/\bmi\b/.test(d.p.en.detail))));
const grad = [...Array(16).keys()].find(n=> /jog the whole 20 min/.test(newbie(n)[1].p.en.detail));
check('...until they jog the whole 20 minutes', grad!=null, grad);
// (the week after -- or after the recovery week, which repeats it)
const running = [grad+1, grad+2].find(n=> runsOf(newbie(n)).every(d=>['Easy Run','Long Run','Recovery Jog'].includes(d.p.en.title)));
check('...then run continuously', running!=null, runsOf(newbie(grad+2)).map(d=>d.p.en.title).join(', '));
check('...still with no hard sessions for a while after that', [0,1,2,3].every(k=> runsOf(newbie(running+k)).every(d=>!/Tempo|Interval|Fartlek|Hill/.test(d.p.en.title))));
const beginner = setup({days:[1,3,5], focus:0, level:'beginner', miles:8});
check('A beginner gets no hard runs in their first 4 weeks', [0,1,2,3].every(n=> beginner(n).every(d=> !/Tempo|Interval|Fartlek|Hill/.test(d.p.en.title))));
check('...and one tempo or interval run a week after that', beginner(4).filter(d=>/Tempo|Interval/.test(d.p.en.title)).length===1);

// ---- the weekly split matches real training weeks ----
// 21 mi: repeats 3.8, easy 4.5, easy 4.5, long 8.5 · 27 mi: tempo 4.5, easy 5.5, easy 3.25, long 14 · 30 mi: tempo 4.5, easy 6.5, recovery 3.5, long 16
const split = (mi, days) => { const w = setup({days, focus:0, level:'intermediate', miles:mi})(1); return days.map(d=>({t:w[d].p.en.title, mi:miles(w[d])})); };
const near = (a, b, tol) => Math.abs(a-b) <= tol;
const w21 = split(20, [1,2,3,5]), w30 = split(30, [1,2,3,5]);
check('~21 mi week: fast 3.5-4, longer easy 4.5, easy 4.5, long 8.5-9', near(w21[0].mi,3.8,0.5) && near(w21[1].mi,4.5,0.5) && near(w21[2].mi,4.5,0.5) && near(w21[3].mi,8.75,0.5), w21.map(r=>r.t+' '+r.mi).join(' | '));
check('~30 mi week: long about half, longer easy ~6.5, short easy ~3.5-4', w30[3].mi>=14 && near(w30[1].mi,6.75,0.75) && w30[2].mi<=4.5, w30.map(r=>r.t+' '+r.mi).join(' | '));
check('...the longer easy run comes before the short one, and is well short of the long run', w30[1].mi > w30[2].mi && w30[1].mi <= w30[3].mi*0.55 && w21[1].mi <= w21[3].mi*0.55, `${w30[1].mi} vs long ${w30[3].mi}; ${w21[1].mi} vs ${w21[3].mi}`);
check('...a short run that isn\'t the day after the long run is an Easy Run, not a Recovery Jog', w30[2].t==='Easy Run', w30[2].t);
let nearLong = null;
for(const lvl of ['beginner','intermediate','advanced']) for(const mi of [10,15,20,25,30,40,50]) for(const days of [[1,3,5],[1,2,3,5],[1,3,5,6],[0,1,2,3,5,6]]){
  const w = setup({days, focus:0, level:lvl, miles:mi})(2);
  const long = w.find(d=>d.p.en.title==='Long Run');
  if(!long) continue;
  const other = Math.max(...w.filter(d=>d.p.t==='run' && d!==long).map(miles));
  if(other > miles(long)*0.6) nearLong = `${lvl} ${mi}mi ${days}: ${other} vs long ${miles(long)}`;
}
check('No other run is ever close to the long run (at most ~55-60% of it)', !nearLong, nearLong);

// ---- running and lifting together: an easy jog after lifting ----
const hybrid = setup({days:[0,1,2,3,4,5], focus:2, level:'intermediate', miles:15})(0);
const liftDaysH = [0,1,2,3,4,5].filter(d=>hybrid[d].p.t==='strength');
const jogAfter = liftDaysH.filter(d=>hybrid[d].c && hybrid[d].c.en.title==='Easy Jog');
check('Hybrid plan: lifting days are followed by an easy 20-30 min jog', jogAfter.length>0 && jogAfter.every(d=>hybrid[d].c.t==='run' && /^20–30 min/.test(hybrid[d].c.en.detail)), liftDaysH.map(d=>hybrid[d].c.en.title).join(', '));
check('...but not on the peak day, or the day before a hard run', jogAfter.every(d=> hybrid[d].wave.pos!=='peak' && !/Long Run|Tempo Run|Interval Run/.test(hybrid[(d+1)%7].p.en.title)));
const newHybrid = setup({days:[0,1,2,3,4,5], focus:2, level:'beginner', miles:0})(0);
check('...and not for someone still building up to running', [0,1,2,3,4,5].every(d=> !newHybrid[d].c || newHybrid[d].c.en.title!=='Easy Jog'));

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

// ---- kettlebells and swap alternatives ----
let kbOnly = true;
for(let wkOffset=0; wkOffset<8; wkOffset++) for(const title of LIFTS){
  exercisesFor({days:[0,2,4], focus:4, eq:'kettlebells'}, title, new Date(2026,8,30+wkOffset*7)).forEach(ex=>{
    if(!Object.values(E.MOVEMENTS).some(m=>m.kettlebells.includes(ex.key) || m.bodyweight.includes(ex.key))) kbOnly = false;
  });
}
check('Kettlebell plans only use kettlebell and bodyweight moves', kbOnly);
check('Every movement has a kettlebell option list', Object.values(E.MOVEMENTS).every(m=>Array.isArray(m.kettlebells) && m.kettlebells.length));
setup({days:[0,2,4], focus:4, eq:'bodyweight', level:'beginner'});
const supermanAlts = E.exerciseAlternatives('Superman');
check('Superman can be swapped for easier bodyweight moves', supermanAlts.length>=2 && supermanAlts.every(k=>E.EXERCISES[k].bodyweight), supermanAlts.join(', '));
check('...never for a lift that needs equipment or is too technical', !supermanAlts.some(k=>E.EXERCISES[k].minLevel), supermanAlts.join(', '));
setup({days:[0,2,4], focus:4, eq:'dumbbells'});
const dbAlts = E.exerciseAlternatives('Dumbbell Row');
check('A dumbbells-at-home user is only offered moves they can do', dbAlts.every(k=>Object.values(E.MOVEMENTS).some(m=>m.dumbbells.includes(k) || m.bodyweight.includes(k))), dbAlts.join(', '));
setup({days:[0,2,4], focus:4, eq:'gym'});
check('A gym user can also swap to kettlebell moves', E.exerciseAlternatives('Romanian Deadlift').some(k=>/Kettlebell/.test(k)));
E.setState({trainingDays:[0,2,4], focusRatio:4, level:'intermediate', intensityIdx:1, equipment:'bodyweight', planStart:'2026-09-28', lang:'en', progression:{}, exerciseSwaps:{'Superman':'skip', 'Push-Up':'Incline Push-Up'}});
let swapsApplied = true;
for(let wkOffset=0; wkOffset<8; wkOffset++) for(const title of LIFTS){
  const list = E.exercisesForSession({t:'strength', en:{title}}, new Date(2026,8,30+wkOffset*7));
  if(list.some(ex=>ex.key==='Superman' || ex.key==='Push-Up')) swapsApplied = false;
}
check('Standing swaps and skips apply to every generated workout', swapsApplied);

console.log('ALL DONE');
process.exit(failures ? 1 : 0);
