const fs = require('fs');
const path = require('path');

// How every generated lifting workout is built (the workout questionnaire, Round 1):
//  - arms are always the last of the weights, then a core finisher ends every lifting workout; leg days
//    have no arm work;
//  - exercises by level: beginner 4 lifts, intermediate 5, advanced 6 (plus the core);
//  - a beginner in a gym starts on machines for the big lifts for 4 weeks, then free weights;
//  - the main lift changes every time its movement leads a workout, unless the user keeps it;
//  - the week's wave: 3 days light/peak/easy, 4 light/build/peak/easy, 5+ ends with a recovery day,
//    with a coaching message for each;
//  - lifting days pair with mobility, not the separate core add-on; bodyweight moves never get weight;
//  - beginners go up 2.5 lb on upper-body lifts, 5 lb on legs.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail ? ' ('+detail+')' : ''}`); }

const coachSrc = html.slice(html.indexOf('// What to aim for on a lifting day'), html.indexOf('const FOCUS_POINTS = {'));
const src = html.slice(html.indexOf('/* ---------------- plan engine ---------------- */'), html.indexOf('function fmtExercisePrescription(ex){'));
const stepSrc = html.slice(html.indexOf('const LOWER_MOVEMENTS'), html.indexOf('function applyProgressionResult('));
const E = new Function(`
  function ses(type, enT, enD, esT, esD){return {t:type, en:{title:enT, detail:enD}, es:{title:esT, detail:esD}};}
  function dateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function parseDateKey(key){ const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d); }
  const WEEK_MONDAY = new Date(2026,8,28), TODAY_DATE = WEEK_MONDAY;
  let state = {};
  function exerciseProgressionKey(key){ return 'strength:'+key; }
  function getExerciseTarget(ex){ return ex.bodyweight ? null : {weight:80, reps:10}; }
  ${coachSrc}
  ${src}
  ${stepSrc}
  return {setState: s => { state = s; }, generatePlanWeek, planConfig, exercisesForSession, waveCoach, MOVEMENTS, EXERCISES, weightStepFor, HOWTO_KEYS: null};
`)();
const M = E.MOVEMENTS;
const inMove = (key, moves) => moves.some(m=> Object.values(M[m]).some(list=> list.includes(key)));
const ARMS = ['biceps','triceps','arms','armstrength','grip'];
const LOWER = ['squat','lunge','hinge','deadlift','calves'];
function setUp(o){
  E.setState({trainingDays:o.days, focusRatio:o.focus ?? 4, goal:'strength', level:o.level, intensityIdx:1, liftSplit:o.split ?? 'auto',
    weeklyMiles:o.miles ?? null, equipment:o.eq, planStart:'2026-09-28', lang:o.lang || 'en', progression:{}, weightUnit:'lb', exerciseSwaps:o.swaps || {}});
}
function liftDays(o, n){
  setUp(o);
  return E.generatePlanWeek(E.planConfig(), n).map((d,i)=>({...d, date:new Date(2026, 8, 28 + 7*n + i)})).filter(d=>d.p.t==='strength' && d.wave);
}
const exs = d => E.exercisesForSession(d.p, d.date);

// Every split, level and kind of equipment, over a block and a half.
const SPLITS = [['auto',[0,2,4]],['auto',[0,1,3,4]],['auto',[0,1,2,3,4]],['ppl',[0,1,2,3,4,5]],['bodypart',[0,1,2,3,4]],['bodypart',[0,2,4]],['full',[1,4]],['ppl',[1,4]]];
const LEVELS = ['beginner','intermediate','advanced'], EQUIP = ['gym','dumbbells','kettlebells','bodyweight'];
let primaryOnly = true, ex5 = '';
let coreLast = true, armsLast = true, legsNoArms = true, counts = true, noWeightBw = true, ex1 = '', ex2 = '', ex3 = '', ex4 = '';
const WANT = {beginner:4, intermediate:5, advanced:6};
SPLITS.forEach(([split, days])=> LEVELS.forEach(level=> EQUIP.forEach(eq=> [0,1,2,4,5].forEach(n=>{
  liftDays({days, level, eq, split}, n).forEach(d=>{
    const list = exs(d), keys = list.map(e=>e.key);
    const last = list[list.length-1];
    if(!last.finisher || !inMove(last.key, ['core'])){ coreLast = false; ex1 = ex1 || `${d.p.en.title}: ${keys.join(' > ')}`; }
    const weights = keys.slice(0, -1);
    const firstArm = weights.findIndex((k,i)=> i>0 && list[i].movement && ARMS.includes(list[i].movement));
    if(firstArm>=0 && weights.slice(firstArm).some((k,i)=> !ARMS.includes(list[firstArm+i].movement))){ armsLast = false; ex2 = ex2 || `${d.p.en.title}: ${keys.join(' > ')}`; }
    if(/Lower Body|Leg Day/.test(d.p.en.title) && list.some(e=> e.movement && ARMS.includes(e.movement))){ legsNoArms = false; ex3 = ex3 || `${d.p.en.title}: ${keys.join(' > ')}`; }
    // (A recovery day is short; the peak's focus lift can stand in for one that was already there; and
    // bodyweight-only back days run out of different moves one short.)
    if(d.wave.pos!=='recovery' && weights.length!==WANT[level] && !((d.wave.focus || eq==='bodyweight') && weights.length===WANT[level]-1)){ counts = false; ex4 = ex4 || `${level} ${d.p.en.title} (${weights.length}): ${keys.join(' > ')}`; }
    if(list.some(e=> e.bodyweight && e.pyramid)) noWeightBw = false;
    if(keys.slice(1).some(k=> k==='Back Squat' || k==='Front Squat')){ primaryOnly = false; ex5 = ex5 || `${level} ${eq} ${d.p.en.title}: ${keys.join(' > ')}`; }
  });
}))));
check('Every lifting workout ends with a core finisher', coreLast, ex1);
check('Arms are always the last of the weights (push days end with triceps, pull days with biceps)', armsLast, ex2);
check('Leg days have no arm work', legsNoArms, ex3);
check('Back Squat and Front Squat are only ever the main lift -- never both in one workout', primaryOnly, ex5);
check('Lifts per workout by level: beginner 4, intermediate 5, advanced 6 (plus the core)', counts, ex4);
check('Bodyweight moves never get weight (no pyramid on them)', noWeightBw);
check('No behind-the-neck exercise anywhere in the catalog', !Object.keys(E.EXERCISES).some(k=> /behind/i.test(k)));

// Push / pull days end with triceps / biceps.
const ppl = liftDays({days:[0,1,2,3,4,5], level:'intermediate', eq:'gym', split:'ppl'}, 1);
const lastLift = d => { const l = exs(d); return l[l.length-2]; };
check('Push days end with triceps, pull days with biceps', ppl.filter(d=>/Push/.test(d.p.en.title)).every(d=> lastLift(d).movement==='triceps') && ppl.filter(d=>/Pull/.test(d.p.en.title)).every(d=> lastLift(d).movement==='biceps'),
  ppl.map(d=> d.p.en.title+': '+lastLift(d).key).join(' | '));
const ul = liftDays({days:[0,1,3,4], level:'intermediate', eq:'gym'}, 1);
const upperA = ul.find(d=> d.p.en.title==='Upper Body Strength' && !d.wave.focus), upperB = ul.find(d=> d.p.en.title==='Upper Body Strength B' && !d.wave.focus);
const lowerB = ul.find(d=> d.p.en.title==='Lower Body Strength B' && !d.wave.focus);
check('Upper A leads with the chest, Upper B with the back, Lower B with the deadlift',
  (!upperA || inMove(exs(upperA)[0].key, ['hpush'])) && (!upperB || inMove(exs(upperB)[0].key, ['hpull'])) && (!lowerB || inMove(exs(lowerB)[0].key, ['deadlift'])) && (upperA || upperB) && lowerB,
  ul.map(d=> d.p.en.title+': '+exs(d)[0].key).join(' | '));

// Machines first for a beginner in a gym.
const MACHINES = ['Chest Press Machine','Shoulder Press Machine','Leg Press','Assisted Pull-Up','Assisted Dip'];
const bg = n => liftDays({days:[0,2,4], level:'beginner', eq:'gym'}, n);
const early = [0,1,2].flatMap(n=> bg(n)).flatMap(d=> exs(d));
check('A gym beginner\'s first 4 weeks: the machine version of every big lift', early.filter(e=> ['hpush','vpush','squat','vpull','triceps'].includes(e.movement)).every(e=> MACHINES.includes(e.key)),
  early.filter(e=> ['hpush','vpush','squat','vpull','triceps'].includes(e.movement)).map(e=>e.key).join(', '));
const later = [4,5,6].flatMap(n=> bg(n)).flatMap(d=> exs(d));
check('...then the free-weight versions from week 5', later.some(e=> e.movement==='hpush' && /Bench|Press/.test(e.key) && !MACHINES.includes(e.key)) && !later.some(e=> ['Chest Press Machine','Shoulder Press Machine','Assisted Pull-Up','Assisted Dip'].includes(e.key)),
  later.filter(e=> e.movement==='hpush' || e.movement==='squat').map(e=>e.key).join(', '));
const inter = [0,1,2,4,5].flatMap(n=> liftDays({days:[0,1,3,4], level:'intermediate', eq:'gym'}, n)).flatMap(d=> exs(d));
check('Nobody else rotates onto the machine-only versions', !inter.some(e=> ['Chest Press Machine','Shoulder Press Machine','Assisted Pull-Up','Assisted Dip'].includes(e.key)));
check('Assisted pull-ups and dips go by reps (bodyweight, no added weight)', ['Assisted Pull-Up','Assisted Dip'].every(k=> E.EXERCISES[k].bodyweight));
const homeBeg = liftDays({days:[0,2,4], level:'beginner', eq:'dumbbells'}, 0).flatMap(d=> exs(d));
check('...and nobody at home gets a machine', !homeBeg.some(e=> MACHINES.includes(e.key)), homeBeg.map(e=>e.key).join(', '));

// The main lift changes every session its movement leads.
const leads = [];
[0,1,2,3,4,5].forEach(n=> liftDays({days:[0,2,4], level:'intermediate', eq:'gym', split:'full'}, n).forEach(d=>{ const e = exs(d)[0]; leads.push(e); }));
const byMove = {};
leads.forEach(e=> (byMove[e.movement] = byMove[e.movement] || []).push(e.key));
const rotates = Object.values(byMove).every(keys=> keys.every((k,i)=> i===0 || k!==keys[i-1]));
check('The main lift changes every time its movement leads a workout', rotates, Object.entries(byMove).map(([m,k])=> m+': '+k.join(' > ')).join(' | '));
const kept = [];
[0,1,2,3].forEach(n=> liftDays({days:[0,2,4], level:'intermediate', eq:'gym', split:'full', swaps:{'__lock:hpush':'Bench Press'}}, n).forEach(d=>{ const e = exs(d)[0]; if(e.movement==='hpush') kept.push(e.key); }));
check('"Keep this lift" keeps it every time', kept.length>=3 && kept.every(k=> k==='Bench Press'), kept.join(', '));
check('...marked as the main lift, with its movement', leads.every(e=> e.mainLift && e.movement));

// The wave and its coaching.
const pos = days => liftDays({days, level:'intermediate', eq:'gym'}, 1).map(d=> d.wave.pos).join(',');
check('3 lifting days: light, peak, easy', pos([0,2,4])==='light,peak,step', pos([0,2,4]));
check('4: light, build, peak, easy', pos([0,1,3,4])==='light,build,peak,step', pos([0,1,3,4]));
check('5: light, build, peak, easy, recovery', pos([0,1,2,3,4])==='light,build,peak,step,recovery', pos([0,1,2,3,4]));
const five = liftDays({days:[0,1,2,3,4], level:'intermediate', eq:'gym'}, 1);
const rec = five[4];
check('...the recovery day is short (3 lifts and the core), lighter, with mobility', exs(rec).length===4 && exs(rec)[0].pyramid && exs(rec)[0].pyramid.steps.length===10 && rec.c.en.title==='Mobility & Stretch',
  exs(rec).map(e=>e.key).join(' > ')+' / '+(rec.c && rec.c.en.title));
const coach = five.map(d=> E.waveCoach(d.wave));
check('Each day has its coaching message', /^Welcome back/.test(coach[0]) && /move the weight a little faster/.test(coach[1]) && /^Peak of the week/.test(coach[2]) && /^Nice and easy/.test(coach[3]) && /^Recovery day/.test(coach[4]), coach.join(' | '));
setUp({days:[0,1,2,3,4], level:'intermediate', eq:'gym', lang:'es'});
check('...in Spanish too', /^De vuelta/.test(E.waveCoach(five[0].wave)) && /^Pico de la semana/.test(E.waveCoach(five[2].wave)));
setUp({days:[0,1,2,3,4], level:'intermediate', eq:'gym'});
const deload = liftDays({days:[0,2,4], level:'intermediate', eq:'gym'}, 3);
check('A deload week says so', deload.every(d=> /^Deload week/.test(E.waveCoach(d.wave))));

// Companions: lifting days get mobility (or the easy jog in a running plan), never the core add-on.
const allLift = SPLITS.flatMap(([split, days])=> liftDays({days, level:'intermediate', eq:'gym', split}, 1));
check('Lifting days pair with mobility, not the Core Activation add-on', allLift.every(d=> d.c && d.c.en.title==='Mobility & Stretch'), [...new Set(allLift.map(d=> d.c && d.c.en.title))].join(', '));
setUp({days:[0,1,2,3,5], focus:2, miles:15, level:'intermediate', eq:'gym'});
const mixed = E.generatePlanWeek(E.planConfig(), 1);
check('...and run days still can have it', mixed.some(d=> d.p.t==='run' && d.c && d.c.en.title==='Core Activation') || mixed.filter(d=>d.p.t==='run').length<4, mixed.map(d=> d.p.en.title+' + '+(d.c ? d.c.en.title : '-')).join(' | '));

// Weight steps.
setUp({days:[0,2,4], level:'beginner', eq:'gym'});
E.setState({level:'beginner', weightUnit:'lb'});
check('A beginner goes up 2.5 lb on upper-body lifts, 5 lb on legs', E.weightStepFor('Bench Press')===2.5 && E.weightStepFor('Bicep Curl')===2.5 && E.weightStepFor('Back Squat')===5 && E.weightStepFor('Leg Press')===5 && E.weightStepFor('Romanian Deadlift')===5);
E.setState({level:'intermediate', weightUnit:'lb'});
check('...everyone else 5 lb on everything', E.weightStepFor('Bench Press')===5 && E.weightStepFor('Back Squat')===5);
E.setState({level:'beginner', weightUnit:'kg'});
check('...in kg: 1 kg upper body, 2.5 kg legs', E.weightStepFor('Bench Press')===1 && E.weightStepFor('Back Squat')===2.5);

// At home, back work is pull-ups and chin-ups, and rows with the user's dumbbells or kettlebells.
const homeBack = eq => [0,1,2,4,5].flatMap(n=> liftDays({days:[0,1,2,3,4], level:'intermediate', eq, split:'bodypart'}, n)).flatMap(d=> exs(d));
['dumbbells','kettlebells','bodyweight'].forEach(eq=>{
  const list = homeBack(eq);
  const vpull = list.filter(e=> e.movement==='vpull').map(e=>e.key), hpull = list.filter(e=> e.movement==='hpull').map(e=>e.key);
  const rowsOk = eq==='bodyweight' || hpull.every(k=> /^(Dumbbell|Kettlebell)( Gorilla)? Row$/.test(k) || hpull.indexOf(k)>0);
  check(`${eq}: back days use pull-ups and chin-ups${eq==='bodyweight' ? '' : ', and '+eq.replace(/s$/,'')+' rows'}`,
    vpull.length && vpull.every(k=> k==='Pull-Up' || k==='Chin-Up') && rowsOk, [...new Set(vpull.concat(hpull))].join(', '));
});
const begHome = [0,1].flatMap(n=> liftDays({days:[0,1,2,3,4], level:'beginner', eq:'bodyweight', split:'bodypart'}, n)).flatMap(d=> exs(d));
check('...a beginner not yet on pull-ups gets an easier back move instead', !begHome.some(e=> e.key==='Pull-Up' || e.key==='Chin-Up') && begHome.some(e=> e.movement==='vpull'), begHome.filter(e=>e.movement==='vpull').map(e=>e.key).join(', '));

// The new machine moves have how-to steps in both languages.
['Chest Press Machine','Shoulder Press Machine','Assisted Pull-Up','Assisted Dip'].forEach(k=>{
  const i = html.indexOf(`  '${k}': {en:[`);
  check(`${k}: how-to steps in English and Spanish`, i>0 && /es:\[/.test(html.slice(i, i+900)));
});

console.log(failures ? `${failures} FAILED` : 'ALL DONE');
process.exit(failures ? 1 : 0);
