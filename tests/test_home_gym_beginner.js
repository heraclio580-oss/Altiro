const fs = require('fs');
const path = require('path');

// The hand-sorted exercise list: a gym plan never suggests a home-only move (Superman, Bird Dog...),
// a plan at home never suggests a gym-only one, and a beginner never gets a move marked not for
// beginners -- in generated lifts, short mobility add-ons and the swap options alike.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
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
  return {setState: s => { state = s; }, exercisesForSession, exerciseAlternatives, LIFT_TEMPLATES, MOBILITY_TEMPLATES, HOME_ONLY, GYM_ONLY, exerciseDef};
`)();

let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail ? ' ('+detail+')' : ''}`);
}
function setup(eq, level){
  E.setState({trainingDays:[0,2,4], focusRatio:4, level, intensityIdx:1, equipment:eq, planStart:'2026-09-28', lang:'en', progression:{}, classes:[]});
}
const TITLES = [...Object.keys(E.LIFT_TEMPLATES), 'Upper Body Strength B', 'Lower Body Strength B', 'Push Day Strength B', 'Pull Day Strength B'];
const MOB = Object.keys(E.MOBILITY_TEMPLATES);
const isNB = k => !!(E.exerciseDef(k) || {}).minLevel;

for(const eq of ['gym','dumbbells','kettlebells','bodyweight']) for(const level of ['beginner','intermediate','advanced']){
  setup(eq, level);
  const bad = new Set(), shortLift = [], emptyMob = [];
  const seen = new Set();
  for(let w=0; w<12; w++) for(const title of [...TITLES, ...MOB]){
    const list = E.exercisesForSession({t:'strength', en:{title}}, new Date(2026,8,28+w*7));
    if(!list) continue;
    if(MOB.includes(title) && list.length<3) emptyMob.push(`${title} ${list.length}`);
    if(!MOB.includes(title) && list.length<3) shortLift.push(`${title} ${list.map(e=>e.key).join('/')}`);
    list.forEach(ex=>{
      seen.add(ex.key);
      if(eq==='gym' && E.HOME_ONLY.has(ex.key)) bad.add(ex.key+' (home only)');
      if(eq!=='gym' && E.GYM_ONLY.has(ex.key)) bad.add(ex.key+' (gym only)');
      if(level==='beginner' && isNB(ex.key)) bad.add(ex.key+' (not for beginners)');
    });
    list.forEach(ex=> E.exerciseAlternatives(ex.key).forEach(k=>{
      if(eq==='gym' && E.HOME_ONLY.has(k)) bad.add('swap '+k+' (home only)');
      if(eq!=='gym' && E.GYM_ONLY.has(k)) bad.add('swap '+k+' (gym only)');
      if(level==='beginner' && isNB(k)) bad.add('swap '+k+' (not for beginners)');
    }));
  }
  check(`${eq} / ${level}: every suggested and swap-in move fits`, !bad.size, [...bad].join(', '));
  check(`${eq} / ${level}: mobility add-ons keep all 3 moves`, !emptyMob.length, emptyMob.slice(0,3).join('; '));
  check(`${eq} / ${level}: every lifting workout still has 3+ moves`, !shortLift.length, shortLift.slice(0,3).join('; '));
}

setup('gym', 'intermediate');
const coreAct = new Set();
for(let w=0; w<6; w++) E.exercisesForSession({t:'strength', en:{title:'Core Activation'}}, new Date(2026,8,28+w*7)).forEach(e=>coreAct.add(e.key));
check('A gym member\'s Core Activation never has Bird Dog or Dead Bug', !coreAct.has('Bird Dog') && !coreAct.has('Dead Bug'), [...coreAct].join(', '));
setup('bodyweight', 'intermediate');
const home = new Set();
for(let w=0; w<6; w++) E.exercisesForSession({t:'strength', en:{title:'Core Activation'}}, new Date(2026,8,28+w*7)).forEach(e=>home.add(e.key));
check('At home, Bird Dog still shows up', home.has('Bird Dog'), [...home].join(', '));
setup('bodyweight', 'beginner');
check('A bodyweight beginner is never offered Pike Push-Up', !E.exerciseAlternatives('Incline Push-Up').includes('Pike Push-Up'));
setup('kettlebells', 'beginner');
check('Kettlebell Clean is fine for beginners now', E.exerciseAlternatives('Kettlebell Deadlift').includes('Kettlebell Clean'));

console.log(failures ? `${failures} FAILED` : 'ALL DONE');
process.exit(failures ? 1 : 0);
