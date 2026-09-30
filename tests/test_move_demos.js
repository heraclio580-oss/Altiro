const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Exercise demos: a small looping figure beside each exercise that has one (the workout preview and
// Log Performance), which opens a bigger one with pause, slow motion and form cues.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

// ---- the figure itself: every frame keeps the body's proportions, and planted feet stay put ----
const start = html.indexOf('/* ---------------- exercise demos');
const end = html.indexOf('// The part of the picture a move uses');
const engine = new Function(html.slice(start, end) + '\nreturn {MV, MOVES, mvSkeleton, mvPoseAt, mvShapes};')();
const {MV, MOVES, mvSkeleton, mvPoseAt} = engine;
const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const DEMO_KEYS = Object.keys(MOVES);
let worst = 0, worstAt = '';
const planted = [];
DEMO_KEYS.forEach(key=>{
  const move = MOVES[key], total = move.loop.reduce((s, st)=> s + st[1], 0);
  for(let i=0; i<=60; i++){
    const pose = mvPoseAt(move, total*i/60), s = mvSkeleton(pose);
    const off = (got, want, what) => { const d = Math.abs(got - want); if(d > worst){ worst = d; worstAt = `${key} ${what}`; } };
    off(dist(s.hip, s.shoulder), MV.TORSO, 'torso');
    s.legs.forEach((l, n)=>{ off(dist(s.hip, l.knee), MV.THIGH, 'thigh'+n); off(dist(l.knee, l.ankle), MV.SHIN, 'shin'+n);
      const spec = pose.legs[n]; if(Array.isArray(spec.at)) planted.push(dist(l.ankle, spec.at)); });
    s.arms.forEach((a, n)=>{ off(dist(s.shoulder, a.elbow), MV.UARM, 'upper arm'+n); off(dist(a.elbow, a.hand), MV.FARM, 'forearm'+n);
      const spec = pose.arms[n]; if(Array.isArray(spec.at)) planted.push(dist(a.hand, spec.at)); });
  }
});
check('Every frame of every demo keeps the body in proportion', worst < 0.01, `${worst.toFixed(3)} at ${worstAt}`);
check('...and a planted hand or foot stays where it is', Math.max(...planted) < 0.5, Math.max(...planted).toFixed(2));
check('Each demo has form cues in English and Spanish', DEMO_KEYS.every(k=> MOVES[k].cues.en.length>=3 && MOVES[k].cues.en.length===MOVES[k].cues.es.length));

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  const w = dom.window, doc = w.document;
  await wait(50);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const click = async sel => { doc.querySelector(sel).click(); await wait(20); };
  const rows = () => [...doc.querySelectorAll('#wpExerciseList .wp-ex')];

  // A weights-only plan, so today is a lifting day; swap in a move that has a demo.
  go('adjust');
  for(let i=0;i<2;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  doc.getElementById('applyAdjust').click();
  await wait(10);
  go('home'); await wait(20);
  await click('#changeExercisesBtn');
  let swapped = rows().map(r=> r.querySelector('.wp-ex-name').textContent).find(n=> DEMO_KEYS.includes(n)) || null;
  for(let i=0; i<rows().length && !swapped; i++){
    await click(`#wpExerciseList [data-change="${i}"]`);
    const chip = [...doc.querySelectorAll('.wp-chooser [data-alt]')].find(c=> DEMO_KEYS.includes(c.getAttribute('data-alt')));
    if(chip){ swapped = chip.getAttribute('data-alt'); chip.click(); await wait(20); await click('.wp-chooser [data-scope="one"]'); }
    else await click('.wp-chooser [data-cancel-change]');
  }
  check('(set-up) a move with a demo is in the workout (planned or swapped in)', !!swapped);
  const withThumb = rows().filter(r=> r.querySelector('.ex-demo-btn')).map(r=> r.querySelector('.wp-ex-name').textContent);
  const without = rows().filter(r=> !r.querySelector('.ex-demo-btn')).map(r=> r.querySelector('.wp-ex-name').textContent);
  check('The workout shows a little figure beside the move with a demo', withThumb.includes(swapped) && doc.querySelector(`#wpExerciseList [data-demo="${swapped}"] svg[data-move] line`), withThumb.join(', '));
  check('...and none beside moves without one', without.length>0 && without.every(n=> !DEMO_KEYS.includes(n)), without.join(', '));

  await click(`#wpExerciseList [data-demo="${swapped}"]`);
  const ov = doc.getElementById('moveDemoOverlay');
  check('Tapping it opens the demo over the workout', !ov.hidden && !doc.getElementById('workoutPreviewOverlay').hidden && doc.getElementById('mdTitle').textContent===swapped);
  check('...with the bigger figure moving', doc.querySelector('#mdStage svg').getAttribute('data-move')===swapped && doc.querySelector('#mdStage svg').dataset.speed==='1');
  check('...and its form cues', [...doc.querySelectorAll('#mdCues li')].map(li=>li.textContent).join('|')===MOVES[swapped].cues.en.join('|'));
  check('...without opening the exercise\'s own options', !doc.querySelector('.wp-chooser'));
  await click('#mdPlayBtn');
  check('Pause stops it', doc.querySelector('#mdStage svg').dataset.speed==='0' && /Play/.test(doc.getElementById('mdPlayBtn').textContent));
  await click('#mdSlowBtn');
  check('Slow motion plays it at half speed', doc.querySelector('#mdStage svg').dataset.speed==='0.5' && doc.getElementById('mdSlowBtn').classList.contains('on') && /Pause/.test(doc.getElementById('mdPlayBtn').textContent));
  await click('#mdSlowBtn');
  check('...and tapping it again goes back to normal', doc.querySelector('#mdStage svg').dataset.speed==='1');
  await click('#closeMoveDemo');
  check('Closing it goes back to the workout', ov.hidden && !doc.getElementById('workoutPreviewOverlay').hidden);
  await click('#closeWorkoutPreview');

  // While recording it, the same figure sits beside the exercise.
  doc.querySelector('#weekStrip .day-cell.today').click(); await wait(20);
  doc.getElementById('dayDetailPlanRow').click(); await wait(20);
  const logBtn = doc.querySelector(`#logPerfExercisesList .exercise-log-row[data-exercise-key="${swapped}"] .ex-demo-btn`);
  check('Log Performance shows the figure beside the move too', !doc.getElementById('logPerfOverlay').hidden && !!logBtn);
  logBtn.click(); await wait(20);
  check('...and it opens the demo', !ov.hidden && doc.getElementById('mdTitle').textContent===swapped);
  await click('#closeMoveDemo');

  // In Spanish
  go('settings'); await wait(10);
  doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
  go('home'); await wait(20);
  doc.querySelector('#weekStrip .day-cell.today').click(); await wait(20);
  doc.getElementById('dayDetailPlanRow').click(); await wait(20);
  doc.querySelector(`#logPerfExercisesList [data-demo="${swapped}"]`).click(); await wait(20);
  check('In Spanish: the cues and buttons', [...doc.querySelectorAll('#mdCues li')].map(li=>li.textContent).join('|')===MOVES[swapped].cues.es.join('|') && doc.getElementById('mdPlayBtn').textContent.includes('Pausa') && doc.getElementById('mdSlowBtn').textContent==='Cámara lenta', doc.getElementById('mdTitle').textContent);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
