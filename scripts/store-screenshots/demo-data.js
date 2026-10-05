// Store screenshots, step 1: a lived-in demo account for the store screenshots: five weeks into a plan, past workouts logged.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'www', 'index.html'), 'utf8');
const src = html.slice(html.indexOf('/* ---------------- plan engine ---------------- */'), html.indexOf('function fmtExercisePrescription(ex){'));
const E = new Function(`
  function ses(type, enT, enD, esT, esD){return {t:type, en:{title:enT, detail:enD}, es:{title:esT, detail:esD}};}
  function dateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function parseDateKey(key){ const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d); }
  const WEEK_MONDAY = new Date(2026,9,5), TODAY_DATE = new Date(2026,9,9);
  let state = {};
  function exerciseProgressionKey(key){ return 'strength:'+key; }
  function getExerciseTarget(){ return null; }
  ${src}
  return {setState: s => { state = s; }, generatePlanWeek, planConfig, exercisesForSession, planWeekIndex};
`)();
const profile = {trainingDays:[0,2,4,5], focusRatio:2, goal:'mix', level:'intermediate', intensityIdx:1, weeklyMiles:15, equipment:'gym',
  planStart:'2026-09-07', lang:'en', progression:{}, classes:[{id:'c1', kind:'jiujitsu', name:'Jiu-Jitsu', days:[4], time:'18:00', minutes:90, from:'2026-09-07', skips:[]}]};
E.setState(profile);
const key = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const logs = [];
let seed = 7; const rnd = () => (seed = (seed*9301+49297)%233280)/233280;
for(let d = new Date(2026,8,7); d < new Date(2026,9,9); d.setDate(d.getDate()+1)){
  const n = E.planWeekIndex(d), w = E.generatePlanWeek(E.planConfig(), n), day = w[(d.getDay()+6)%7];
  const k = key(d);
  if(day.p.t==='rest') continue;
  if(k==='2026-09-23'){ logs.push({log_date:k, missed_reason:'busy', missed_note:'Late shift'}); continue; }
  if(day.p.t==='run'){
    const planned = parseFloat(day.p.en.detail) || 3;
    const dist = Math.round((planned + (rnd()-0.4)*0.4)*10)/10;
    logs.push({log_date:k, completed_override:true, actual_run_distance:dist, performance:{distance:dist, time:Math.round(dist*(9.1+rnd()*0.6))}});
  } else {
    const exs = (E.exercisesForSession(day.p, new Date(d)) || []).slice(0,5);
    const base = {'Back Squat':185,'Front Squat':155,'Deadlift':245,'Trap Bar Deadlift':235,'Romanian Deadlift':165,'Bench Press':165,'Incline Barbell Press':135,'Overhead Press':95,'Bent-Over Row':135,'Seated Cable Row':120,'Lat Pulldown':130,'Leg Press':270,'Hip Thrust':185};
    logs.push({log_date:k, completed_override:true, performance:{time: 46+Math.round(rnd()*12), exercises: exs.map(ex=>({key:ex.key, name:ex.name||ex.key,
      sets: Array.from({length: ex.sets||3}, (_,i)=>({reps: ex.reps||10, weight: ex.bodyweight ? 0 : (base[ex.key] || 60) + 5*Math.min(i,2)}))}))}});
  }
}
fs.writeFileSync(require('path').join(__dirname, '.demo-data.json'), JSON.stringify({logs}, null, 1));
console.log(logs.length, 'logs', logs.slice(-3).map(l=>l.log_date+' '+(l.actual_run_distance||'lift')).join(', '));
