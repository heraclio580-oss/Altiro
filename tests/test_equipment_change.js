const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Changing equipment in Adjust changes the lifting workouts to fit it -- including lifts the user kept
// ("Keep this lift") or swapped in for every workout at the gym: one their new equipment can't do waits
// until they're back at the gym, and the plan's own pick shows instead.
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
  return {setState: s => { state = s; }, exercisesForSession, MOVEMENTS, EXERCISES, EQUIP_ACCESS};
`)();
const upper = {t:'strength', en:{title:'Upper Body Strength', detail:'45 min'}, es:{title:'Fuerza de tren superior', detail:'45 min'}};
const lower = {t:'strength', en:{title:'Lower Body Strength', detail:'45 min'}, es:{title:'Fuerza de tren inferior', detail:'45 min'}};
function lifts(equipment, swaps, session){
  E.setState({trainingDays:[0,2,4], focusRatio:4, goal:null, level:'intermediate', intensityIdx:1, equipment, planStart:'2026-09-28', lang:'en',
    progression:{}, classes:[], exerciseSwaps: swaps || {}});
  return E.exercisesForSession(session || upper, new Date(2026,9,5)).map(ex=>ex.key);
}
const GYM_GEAR = /Bench Press|Barbell|Cable|Machine|Pulldown|T-Bar|Back Squat|Front Squat|Leg Press|Trap Bar|Rack Pull|^Deadlift|Overhead Press|Push Press/;
for(const eq of ['dumbbells','kettlebells','bodyweight']){
  const allowed = new Set(E.EQUIP_ACCESS[eq].flatMap(t=> Object.values(E.MOVEMENTS).flatMap(m=> m[t]||[])));
  const bad = [upper, lower].flatMap(s=> lifts(eq, {}, s)).filter(k=> !allowed.has(k) && !(E.EXERCISES[k]||{}).bodyweight);
  check(`${eq}: every lift is one listed for that equipment`, !bad.length, bad.join(','));
}
check('Gym: "Keep this lift" on Bench Press keeps it', lifts('gym', {'__lock:hpush':'Bench Press'})[0]==='Bench Press', lifts('gym', {'__lock:hpush':'Bench Press'}).join(','));
const kept = lifts('dumbbells', {'__lock:hpush':'Bench Press'});
check('Dumbbells at home: the kept Bench Press doesn\'t follow -- a dumbbell press instead', !kept.some(k=> GYM_GEAR.test(k)) && /Dumbbell|Push-Up/.test(kept[0]), kept.join(','));
const dbPick = lifts('dumbbells', {})[0];
const swapped = lifts('dumbbells', {[dbPick]:'Incline Barbell Press'});
check('Dumbbells: a swap to a barbell lift (made at the gym) waits -- the plan\'s pick shows', swapped[0]===dbPick, swapped.join(','));
const homeSwap = lifts('dumbbells', {[dbPick]:'Push-Up'});
check('...while a swap their equipment can do still applies', homeSwap[0]==='Push-Up', homeSwap.join(','));
check('Back at the gym, the kept lift is back', lifts('gym', {'__lock:hpush':'Bench Press'})[0]==='Bench Press');

// ---- in the app: Adjust -> equipment -> Apply changes today's lifting ----
(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-10-12'; } }); // a Monday
  const { window } = dom;
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const key = k => doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:k, bubbles:true}));
  go('adjust'); await wait(10);
  for(let i=0;i<4;i++) key('ArrowRight'); // Weights only
  for(let pass=0; pass<2; pass++) for(let d=0; d<7; d++){
    const chip = doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`);
    const want = [0,2,4].includes(d);
    if(chip.classList.contains('sel')!==want && (pass===0 ? !want : want)) chip.click();
  }
  const equip = name => [...doc.querySelectorAll('#adjEquipChips .chip')].find(c=> c.textContent===name).click();
  equip('Full gym');
  doc.getElementById('applyAdjust').click(); await wait(20);
  go('home'); await wait(20);
  const today = () => [...doc.querySelectorAll('#sessionCard .r-exercise-list li')].map(li=> li.textContent.replace(/\s+/g,' ').trim());
  const gym = today();
  check('Full gym: today\'s lifting has gym lifts', gym.some(t=> GYM_GEAR.test(t)), gym.join(' | '));
  go('adjust'); await wait(10);
  equip('Bodyweight only');
  doc.getElementById('applyAdjust').click(); await wait(20);
  go('home'); await wait(20);
  const bw = today();
  check('Bodyweight only: today\'s lifting changes to bodyweight moves', bw.length && !bw.some(t=> GYM_GEAR.test(t) || /Dumbbell|Kettlebell/.test(t)) && bw.join()!==gym.join(), bw.join(' | '));
  go('adjust'); await wait(10);
  check('Reopening Adjust shows Bodyweight only chosen', doc.querySelector('#adjEquipChips .chip.sel').textContent==='Bodyweight only');

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
