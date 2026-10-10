const fs = require('fs');
const path = require('path');

// Full body days each have a focus that rotates -- chest, back, legs, carrying on from week to week. The
// day's focus leads (its main lift first, with the pyramid), then one move for every other body part, a
// shoulder move as support, arms always last of the weights as the finisher, and then the core finisher.
// The week's peak day leads with its peak lift's body part.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail ? ' ('+detail+')' : ''}`); }

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
  return {setState: s => { state = s; }, generatePlanWeek, planConfig, exercisesForSession, MOVEMENTS};
`)();
function week(o, n){
  E.setState({trainingDays:o.days, focusRatio:4, goal:'strength', level:o.level ?? 'intermediate', intensityIdx:1, liftSplit:o.split ?? 'full',
    weeklyMiles:null, equipment:o.eq ?? 'gym', planStart:'2026-09-28', lang:'en', progression:{}, weightUnit:'lb', strengthFocus:o.focus});
  return E.generatePlanWeek(E.planConfig(), n).map((d,i)=>({...d, date:new Date(2026, 8, 28 + 7*n + i)})).filter(d=>d.p.t==='strength' && /^Full Body/.test(d.p.en.title));
}
const focusOf = d => (d.p.en.detail.match(/(Chest|Back|Legs|Shoulders) focus/) || [])[1];
const M = E.MOVEMENTS;
const inMove = (key, moves, eq) => moves.some(m=> Object.values(M[m]).some(list=> list.includes(key)));
const LEAD = {Chest:['hpush'], Back:['deadlift','hinge'], Legs:['squat'], Shoulders:['vpush']};
const ARMS = ['biceps','triceps','arms','armstrength'];
const CORE = ['core'];
// The weights, without the core finisher (checked to be last on its own).
const weights = list => list.slice(0, -1);

// Three full body days a week, over eight weeks.
const weeks = [0,1,2,3,4,5,6,7].map(n=> week({days:[0,2,4]}, n));
check('Every full body day has a focus, shown with the workout ("45 min · Chest focus")', weeks.flat().every(d=> focusOf(d) && /min · \w+ focus$/.test(d.p.en.detail)), weeks[0].map(d=>d.p.en.detail).join(' | '));
check('...a different focus each day of the week', weeks.every(w=> new Set(w.map(focusOf)).size===w.length), weeks.map(w=>w.map(focusOf).join('/')).join('  '));
const seen = new Set(weeks.slice(0,2).flat().map(focusOf));
check('...rotating chest, back, legs, so within two weeks each gets its turn', ['Chest','Back','Legs'].every(f=> seen.has(f)) && !seen.has('Shoulders'), [...seen].join(', '));
check('...and in Spanish too', weeks[0].every(d=> /Enfoque: (pecho|espalda|piernas|hombros)$/.test(d.p.es.detail)), weeks[0][0].p.es.detail);

let leadOk = true, armsOk = true, fiveOk = true, allPartsOk = true, coreOk = true, sample = '';
weeks.flat().forEach(d=>{
  const all = E.exercisesForSession(d.p, d.date).map(e=>e.key), f = focusOf(d);
  if(!inMove(all[all.length-1], CORE)) coreOk = false;
  const list = weights(all);
  if(!inMove(list[0], LEAD[f])) leadOk = false;
  if(!inMove(list[list.length-1], ARMS)) armsOk = false;
  if(list.length!==5) fiveOk = false;
  if(list.slice(0,-1).some(k=> inMove(k, ARMS) && !inMove(k, ['vpull','hpull']))) allPartsOk = false; // no arm isolation before the end
  if(!sample) sample = `${f}: ${all.join(' > ')}`;
});
check('The day\'s focus lift comes first', leadOk, sample);
check('Arms are always last of the weights, the finisher -- never earlier in the workout', armsOk && allPartsOk, sample);
check('...then the core finisher, the very last exercise', coreOk, sample);
check('Intermediate: five lifts (one for each body part, plus a shoulder move) and the core', fiveOk, sample);

// The week's peak: a full body plan's peak lift rotates bench / squat / deadlift; the peak day takes that focus.
const PART = {hpush:'Chest', squat:'Legs', deadlift:'Back'};
const peakOk = weeks.every((w, n)=>{
  const peak = w.find(d=> d.wave && d.wave.focus);
  return !peak || PART[peak.wave.focus.movement]===focusOf(peak);
});
check('The week\'s peak day leads with its peak lift\'s body part (bench -> chest, squat -> legs, deadlift -> back)', peakOk, weeks.map(w=>{ const p = w.find(d=>d.wave && d.wave.focus); return p ? `${p.wave.focus.movement}:${focusOf(p)}` : '-'; }).join(' '));
const peakFirst = weeks.every(w=>{ const p = w.find(d=>d.wave && d.wave.focus); if(!p) return true; const l = E.exercisesForSession(p.p, p.date); return l[0].pyramid && l[0].pyramid.peak; });
check('...and that lift gets the peak pyramid', peakFirst);

// Arm-strength focus: arms still finish the workout.
const armWeek = week({days:[0,2,4], focus:'arms'}, 0);
const armPeak = armWeek.find(d=> d.wave && d.wave.focus);
const armList = armPeak ? weights(E.exercisesForSession(armPeak.p, armPeak.date).map(e=>e.key)) : [];
check('An arm-strength week still ends with arms (grip stays fresh for the big lifts)', !armPeak || inMove(armList[armList.length-1], ARMS), armList.join(' > '));

// Other equipment and 2 days a week.
['dumbbells','kettlebells','bodyweight'].forEach(eq=>{
  const w = week({days:[1,4], eq}, 3);
  const ok = w.length===2 && w.every(d=>{ const l = weights(E.exercisesForSession(d.p, d.date).map(e=>e.key)); return l.length>=4 && inMove(l[l.length-1], ARMS.concat(['hpush'])); });
  check(`${eq}: two full body days, each ending with arms`, ok, w.map(d=> focusOf(d)+': '+E.exercisesForSession(d.p, d.date).map(e=>e.key).join(' > ')).join(' | '));
});

// Other splits are unchanged.
const ul = (()=>{ E.setState({trainingDays:[0,1,3,4], focusRatio:4, goal:'strength', level:'intermediate', intensityIdx:1, liftSplit:'auto', weeklyMiles:null, equipment:'gym', planStart:'2026-09-28', lang:'en', progression:{}, weightUnit:'lb'}); return E.generatePlanWeek(E.planConfig(), 0).filter(d=>d.p.t==='strength'); })();
check('Other splits are unchanged (no focus on Upper / Lower days)', ul.every(d=> !/focus/.test(d.p.en.detail)), ul.map(d=>d.p.en.title+' '+d.p.en.detail).join(' | '));

console.log(failures ? `${failures} FAILED` : 'ALL DONE');
process.exit(failures ? 1 : 0);
