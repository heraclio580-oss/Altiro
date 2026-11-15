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
// Walks, hikes and bike rides (from a watch), on the days between.
const OTHER = [['2026-09-13','hike','Ridge Trail Hike',4.2,118],['2026-09-15','walk','Evening Walk',2.1,41],['2026-09-20','ride','Sunday Ride',18.4,71],
  ['2026-09-27','hike','Ridge Trail Hike',5.6,152],['2026-09-29','walk','Evening Walk',2.4,46],['2026-10-04','walk','Evening Walk',2.2,43],
  ['2026-10-06','ride','Morning Ride',16.8,62],['2026-10-07','walk','Evening Walk',2.6,49],['2026-10-08','hike','Lakeside Hike',3.8,97]];
OTHER.forEach(([k, type, name, miles, min], i)=>{
  const h = Math.floor(min/60), m = min%60, vol = `${miles} mi · ${h ? h+':'+String(m).padStart(2,'0')+':00' : m+':00'}`;
  const entry = {id:'o'+i, name, type, volume: vol, notes:'', distance: miles, duration_min: min, performance:{distance: miles, time: min, notes:'', source:'strava', stravaId: 9000+i}};
  const row = logs.find(l=> l.log_date===k);
  if(row) (row.manual_entries = row.manual_entries || []).push(entry); else logs.push({log_date:k, manual_entries:[entry]});
});
// Monday's run tracked with the phone's GPS: a loop around a lake, for its share card.
{
  const run = logs.find(l=> l.log_date==='2026-10-05');
  const n = 160, t0 = Date.UTC(2026,9,5,11,32), route = [];
  for(let i=0;i<=n;i++){
    const a = i/n*2*Math.PI, r = 1 + 0.08*Math.sin(3*a) + 0.04*Math.cos(7*a);
    route.push([+(40.7812 + 0.0185*r*Math.sin(a)).toFixed(6), +(-73.9665 + 0.017*r*Math.cos(a) - 0.017).toFixed(6)]);
  }
  run.performance = {...run.performance, route: [route], source:'gps', startedAt: t0, finishedAt: t0 + run.performance.time*60000};
}
logs.sort((x, y)=> x.log_date<y.log_date ? -1 : 1);
fs.writeFileSync(require('path').join(__dirname, '.demo-data.json'), JSON.stringify({logs}, null, 1));
console.log(logs.length, 'logs', logs.slice(-3).map(l=>l.log_date+' '+(l.actual_run_distance||'lift')).join(', '));
