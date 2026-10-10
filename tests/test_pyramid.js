const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The lifting philosophy: a pyramid on each workout's main lift, a weekly wave that builds to one peak
// day mid-week (the only day the focus lift goes to a top single), and a focus lift that the user
// picks and that rotates week to week.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? `OK${detail ? ' ('+detail+')' : ''}` : `FAIL${detail ? ' ('+detail+')' : ''}`);
}

// ---------------- the engine on its own ----------------
const src = html.slice(html.indexOf('/* ---------------- plan engine ---------------- */'), html.indexOf('function fmtExercisePrescription(ex){'));
const E = new Function(`
  function ses(type, enT, enD, esT, esD){return {t:type, en:{title:enT, detail:enD}, es:{title:esT, detail:esD}};}
  function dateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function parseDateKey(key){ const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d); }
  const WEEK_MONDAY = new Date(2026,8,28), TODAY_DATE = WEEK_MONDAY;
  let state = {};
  function exerciseProgressionKey(key){ return 'strength:'+key; }
  // Every weighted lift: 80 x 10 -- the example the pyramid was described with.
  function getExerciseTarget(ex){ return ex.bodyweight ? null : {weight:80, reps:10}; }
  ${src}
  return {setState: s => { state = s; }, generatePlanWeek, planConfig, exercisesForSession, MOVEMENTS};
`)();
function setup(o){
  E.setState({trainingDays:o.days, focusRatio:4, goal:'strength', level:o.level ?? 'intermediate', intensityIdx:1,
    weeklyMiles:null, equipment:o.eq ?? 'gym', strengthFocus:o.focus ?? 'allround', planStart:'2026-09-28', lang:'en', progression:{}, weightUnit:'lb'});
}
const monday = n => new Date(2026, 8, 28 + 7*n);
function liftDays(n){
  const w = E.generatePlanWeek(E.planConfig(), n);
  return w.map((d,i)=>({...d, i, date: new Date(2026, 8, 28 + 7*n + i)})).filter(d=>d.p.t==='strength');
}
const exs = d => E.exercisesForSession(d.p, d.date);
const movementOf = key => Object.keys(E.MOVEMENTS).filter(m=>Object.values(E.MOVEMENTS[m]).some(l=>l.includes(key)));

setup({days:[0,1,2,3,4]});
const wk0 = liftDays(0);
check('5 lifting days: light, building, PEAK, easy, recovery', wk0.map(d=>d.wave.pos).join()==='light,build,peak,step,recovery', wk0.map(d=>d.wave.pos).join());
check('...the peak is Wednesday', wk0.find(d=>d.wave.pos==='peak').i===2);
const peak0 = exs(wk0[2]);
check('Peak day leads with the focus lift (week 1: a press)', movementOf(peak0[0].key).includes('hpush'), peak0[0].key);
const steps = peak0[0].pyramid && peak0[0].pyramid.steps;
check('...as a peak pyramid, 80 x 10 -> the exact example ladder',
  steps && steps.map(s=>s.weight+'x'+s.reps).join(' ')==='45x10 50x10 55x10 60x10 70x10 80x10 85x5 90x5 95x5 100x1 90x5 80x5 70x10 60x10 50x10 40x10',
  steps && steps.map(s=>s.weight+'x'+s.reps).join(' '));
const light = exs(wk0[0])[0];
check('A light day\'s main lift is a pyramid too, with no single', light.pyramid && !light.pyramid.peak && light.pyramid.steps.every(s=>s.reps>=5), light.pyramid && light.pyramid.steps.map(s=>s.weight+'x'+s.reps).join(' '));
check('...shaped 3x10 warm-up, 3x10 work, 3x5, 2x5 down, 2x10 finish', light.pyramid.steps.map(s=>s.reps).join()==='10,10,10,10,10,10,5,5,5,5,5,10,10');
check('...and topping out lighter than the peak', light.pyramid.top < steps[9].weight, `${light.pyramid.top} vs ${steps[9].weight}`);
const tops = wk0.map(d=>exs(d)[0].pyramid ? exs(d)[0].pyramid.top : null);
check('The week builds to the peak and comes back down', tops[0]<=tops[1] && tops[1]<tops[2] && tops[3]<tops[2], tops.join(' → '));
check('Only the main lift is a pyramid; accessories stay straight sets', wk0.every(d=>exs(d).slice(1).every(e=>!e.pyramid)));
check('Every workout is 5 lifts and the core finisher (an intermediate lifter); the recovery day 3 and the core', wk0.map(d=>exs(d).length).join()==='6,6,6,6,4', wk0.map(d=>exs(d).length).join());

// All-round: press -> squat -> deadlift, then a deload week with no peak, then the next variations.
const peakOf = n => { const d = liftDays(n).find(x=>x.wave.pos==='peak' && x.wave.focus); return d ? exs(d)[0].key : null; };
const rot = [0,1,2,3,4,5,6].map(peakOf);
check('All-round rotation: press, squat, deadlift', movementOf(rot[0]).includes('hpush') && movementOf(rot[1]).includes('squat') && movementOf(rot[2]).includes('deadlift'), rot.slice(0,3).join(', '));
const deload = liftDays(3);
check('Deload week (4th): every training day still has its workout', deload.length===liftDays(2).length && deload.length===5, deload.length);
check('...no peak single, a shorter pyramid (10 sets, not 13+)', rot[3]===null && deload.every(d=>{ const p = exs(d)[0].pyramid; return p && p.deload && !p.peak && p.steps.length===10 && p.steps.every(s=>s.reps>=5); }));
const tops2 = liftDays(2).map(d=>exs(d)[0].pyramid.top), tops3 = deload.map(d=>exs(d)[0].pyramid.top);
check('...and lighter every day than the week before (about 85%)', tops3.every((t,i)=> t < tops2[i] && t >= tops2[i]*0.6), tops2.join('/')+' -> '+tops3.join('/'));
check('...accessories a set less', deload.every((d,i)=> exs(d).slice(1).every(e=> e.sets <= 3)));
check('Next round peaks the same order again (the lift itself moves on every session its movement leads)', movementOf(rot[4]).includes('hpush') && movementOf(rot[5]).includes('squat'), rot.slice(4).join(', '));

// Beginners build up to the heavy 5s but don't single yet.
setup({days:[0,2,4], level:'beginner'});
const bPeak = liftDays(0).find(d=>d.wave.pos==='peak');
const bSteps = exs(bPeak)[0].pyramid.steps;
check('Beginner peak day: no single', bSteps.every(s=>s.reps>1), bSteps.map(s=>s.weight+'x'+s.reps).join(' '));

// Bodyweight only: no weights, so no pyramid.
setup({days:[0,2,4], eq:'bodyweight'});
check('Bodyweight plans have no pyramid', liftDays(0).every(d=>exs(d).every(e=>!e.pyramid)));

// ---------------- in the app ----------------
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  const { window } = dom;
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Weights only, Monday, Tuesday, Wednesday and Friday (week 2 of the plan peaks the squat).
  go('adjust');
  await wait(10);
  for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  doc.querySelector('#adjDayCountChips .chip[data-count="4"]').click();
  for(let pass=0; pass<2; pass++) for(let d=0; d<7; d++){
    const chip = doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`);
    const want = [0,1,2,4].includes(d);
    if(chip.classList.contains('sel')!==want && (pass===0 ? !want : want)) chip.click();
  }
  doc.getElementById('applyAdjust').click();
  await wait(20);

  // Next Wednesday is the peak.
  go('week');
  await wait(20);
  const tap = async (w, d) => {
    const row = doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`);
    for(const type of ['pointerdown','pointerup']) row.dispatchEvent(new window.PointerEvent(type, {bubbles:true}));
    await wait(20);
  };
  await tap(1, 2);
  const detail = doc.getElementById('wpDetail').textContent;
  check('Next Wednesday\'s preview says it\'s the peak day', /Peak day/.test(detail), detail);
  const first = doc.querySelector('#wpExerciseList .wp-ex');
  check('...leading with a squat, as a peak pyramid', /Squat/.test(first.querySelector('.wp-ex-name').textContent) && /Peak pyramid · 16 sets/.test(first.textContent), first.querySelector('.wp-ex-rx').textContent);
  const ladder = [...first.querySelectorAll('.pyr-step')].map(el=>el.textContent.replace(/\s+/g,' ').trim());
  check('...with the ladder spelled out, up to a top single and back down', ladder.some(t=>/^Top single \d+ lb × 1$/.test(t)) && /^Warm-up/.test(ladder[0]) && ladder.some(t=>/^Back down/.test(t)), ladder.join(' | '));
  check('...and how to run it', /switch to 5s/.test(first.querySelector('.wp-pyramid .wp-ex-note').textContent));
  doc.getElementById('closeWorkoutPreview').click();
  await wait(10);
  await tap(1, 0);
  check('Monday is a light day, no single', /Light day/.test(doc.getElementById('wpDetail').textContent) && !doc.querySelector('#wpExerciseList .pyr-step[data-stage="top"]'), doc.getElementById('wpDetail').textContent);
  doc.getElementById('closeWorkoutPreview').click();
  await wait(10);

  // Today (Friday, the week's last lifting day, an easy day): log the pyramid.
  go('home');
  await wait(20);
  const cardLine = doc.querySelector('#sessionCard .r-exercise-list li').textContent.replace(/\s+/g,' ');
  check('Today\'s card shows the pyramid and its top weight', /Pyramid · \d+ sets · top \d+ lb/.test(cardLine), cardLine);
  doc.getElementById('recordBtn').click();
  await wait(950);
  const row = doc.querySelector('#logPerfExercisesList .exercise-log-row');
  const sets = () => [...row.querySelectorAll('.set-log-row')].map(r=>({w: r.querySelector('[data-field="weight"]').value, r: r.querySelector('[data-field="reps"]').value, stage: r.dataset.stage}));
  const before = sets();
  check('Log Performance starts each set from its step of the ladder', before.length===13 && before[0].r==='10' && before[6].r==='5' && +before[0].w < +before[8].w, before.map(s=>s.w+'x'+s.r).join(' '));
  check('...with the pyramid\'s buttons', !!row.querySelector('[data-pyr="fives"]') && !!row.querySelector('[data-pyr="single"]'));

  // Warm-ups and two working sets done; the third set of 10 would get ugly -> 5s from here.
  const dots = () => [...row.querySelectorAll('.set-check-dot')];
  for(let i=0;i<5;i++) dots()[i].click();
  check('A set of the main lift starts a 2:30 rest', !doc.getElementById('restBar').hidden && doc.getElementById('restTime').textContent==='2:30', doc.getElementById('restTime').textContent);
  row.querySelector('[data-pyr="fives"]').click();
  const afterFives = sets();
  check('"Switch to 5s" turns the rest of the climb into 5s', afterFives.slice(5,9).every(s=>s.r==='5') && afterFives.slice(0,5).every(s=>s.r==='10'), afterFives.map(s=>s.w+'x'+s.r).join(' '));
  check('...but leaves the way back down alone', afterFives[afterFives.length-1].r==='10');

  // Two heavy 5s done; 5 isn't there at the next weight -> top single now.
  for(let i=5;i<7;i++) dots()[i].click();
  const topWeight = +afterFives[7].w;
  row.querySelector('[data-pyr="single"]').click();
  const afterSingle = sets();
  check('"Top single now" makes this set one rep', afterSingle[7].r==='1' && afterSingle[7].stage==='top', afterSingle[7].w+'x'+afterSingle[7].r);
  check('...then works back down from it: 90% and 80% for 5, then 70% to 40% for 10',
    afterSingle.length===14 && afterSingle.slice(8).map(s=>s.r).join()==='5,5,10,10,10,10' && +afterSingle[8].w < topWeight && +afterSingle[13].w < +afterSingle[8].w,
    afterSingle.slice(7).map(s=>s.w+'x'+s.r).join(' '));
  check('...and the label counts the new sets', /· 14 sets/.test(row.querySelector('.exercise-log-name span').textContent), row.querySelector('.exercise-log-name span').textContent);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
