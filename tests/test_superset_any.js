const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Any workout's exercises can be made supersets -- the plan's too, not just one being built: "Superset
// with above" between each pair, in the preview before starting or while doing it, and "Make it one
// circuit" for all of them. A superset runs round by round: one set of each, no rest between, rest after.
// For that day only.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const BLOCK = 60;
function fakeRect(){
  const block = this.classList && (this.classList.contains('ex-block') ? this : this.classList.contains('ex-drag') ? this.closest('.ex-block') : null);
  if(block){
    const i = [...block.parentElement.children].indexOf(block);
    const top = i*BLOCK + (block===this ? 0 : 10), h = block===this ? 50 : 20;
    return { top, bottom: top+h, left:0, right:300, width:300, height:h, x:0, y:top };
  }
  return { top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0 };
}
const blockY = i => i*BLOCK + 15;

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; w.Element.prototype.getBoundingClientRect = fakeRect; } });
  await wait(50);
  const w = dom.window, doc = w.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const pointer = (el, type, y) => el.dispatchEvent(new w.PointerEvent(type, {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:y}));
  const wpRows = () => [...doc.querySelectorAll('#wpExerciseList .wp-ex')];
  const wpTags = () => wpRows().map(el=> { const t = el.querySelector('.ss-tag'); return t ? t.textContent : '-'; }).join(',');
  const wpLink = key => doc.querySelector(`#wpExerciseList [data-wp-link="${key}"]`);
  const rows = () => [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')];
  const keys = () => rows().map(r=> r.getAttribute('data-exercise-key'));
  const tags = () => rows().map(r=> { const t = r.querySelector('.ss-tag'); return t ? t.textContent : '-'; }).join(',');
  const current = () => { const r = doc.querySelector('#logPerfExercisesList .exercise-log-row.current-exercise'); return r && r.getAttribute('data-exercise-key'); };
  const restOn = () => !doc.getElementById('restBar').hidden;

  goPill('adjust');
  for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  doc.getElementById('applyAdjust').click();
  await wait(10);
  goPill('home');
  await wait(20);

  // ---- In the preview ----
  doc.getElementById('changeExercisesBtn').click();
  await wait(20);
  const ks = wpRows().map(el=> el.getAttribute('data-key'));
  const n = ks.length;
  check('Every exercise but the first can be linked to the one above', doc.querySelectorAll('#wpExerciseList [data-wp-link]').length===n-1, doc.querySelectorAll('#wpExerciseList [data-wp-link]').length);
  check('...and there\'s a "Make it one circuit" button', /Make it one circuit/.test(doc.getElementById('wpCircuitBtn').textContent) && !doc.getElementById('wpCircuitBtn').hidden);
  wpLink(ks[2]).click();
  await wait(20);
  check('Linking the 3rd to the 2nd: a superset, A1 and A2', wpTags()===['-','A1','A2',...ks.slice(3).map(()=>'-')].join(','), wpTags());
  check('...its link shows it\'s on', wpLink(ks[2]).getAttribute('aria-pressed')==='true');
  wpLink(ks[4]).click();
  await wait(20);
  check('Another pair: B1 and B2', wpTags().split(',')[3]==='B1' && wpTags().split(',')[4]==='B2', wpTags());
  doc.getElementById('wpCircuitBtn').click();
  await wait(20);
  check('Make it one circuit: A1 to A' + n, wpTags()===ks.map((_, i)=> 'A'+(i+1)).join(','), wpTags());
  check('...then the button splits it up', /Split up the circuit/.test(doc.getElementById('wpCircuitBtn').textContent));
  doc.getElementById('wpCircuitBtn').click();
  await wait(20);
  check('Split up: no supersets', wpTags()===ks.map(()=>'-').join(','), wpTags());
  wpLink(ks[1]).click();
  await wait(20);
  // A superset moves as one block: the pair of the first two goes below the third.
  check('Linked first two are one block to drag', doc.querySelectorAll('#wpExerciseList .ex-block').length===n-1);
  doc.getElementById('closeWorkoutPreview').click();
  await wait(20);

  // ---- Doing it ----
  doc.getElementById('recordBtn').click();
  await wait(950);
  check('Started: the superset is there', tags().split(',').slice(0, 2).join()==='A1,A2' && !!doc.querySelector('#logPerfExercisesList .ss-head'), tags());
  check('...and can be linked here too', doc.querySelectorAll('#logPerfExercisesList [data-ss-live]').length===n-1 && !doc.getElementById('logPerfCircuitBtn').hidden);
  rows()[0].querySelector('.set-check-dot').click();
  await wait(10);
  check('A set of A1 goes straight to A2, no rest', current()===ks[1] && !restOn(), current()+' rest:'+restOn());
  rows()[1].querySelector('.set-check-dot').click();
  await wait(10);
  check('A set of A2 ends the round: rest, back to A1', current()===ks[0] && restOn(), current()+' rest:'+restOn());

  // Moved here, then linked: "above" is what's above on screen.
  const lone = keys()[n-1];
  const h = rows()[n-1].querySelector('.ex-drag');
  const lastBlock = doc.querySelectorAll('#logPerfExercisesList .ex-block').length-1;
  pointer(h, 'pointerdown', blockY(lastBlock)); pointer(h, 'pointermove', blockY(1) - 5); pointer(h, 'pointerup', blockY(1) - 5);
  await wait(20);
  check('Moved the last one up, under the superset', keys()[2]===lone, keys().join());
  doc.querySelector(`#logPerfExercisesList [data-ss-live="${lone}"]`).click();
  await wait(20);
  check('Linked to the one above it on screen: the superset is now three', tags().split(',').slice(0, 3).join()==='A1,A2,A3' && keys()[2]===lone, tags()+' / '+keys().join());
  check('...what was ticked stays ticked', rows()[0].querySelector('.set-check-dot').classList.contains('checked'));
  doc.getElementById('logPerfCircuitBtn').click();
  await wait(20);
  check('One circuit while doing it', tags()===keys().map((_, i)=> 'A'+(i+1)).join(','), tags());
  doc.getElementById('closeLogPerf').click();
  await wait(20);

  // Next week's comes as usual.
  goPill('week');
  await wait(20);
  const fri = doc.querySelector('#weekList .plan-row[data-day="4"][data-week-idx="1"]');
  pointer(fri, 'pointerdown', 10); pointer(fri, 'pointerup', 10);
  await wait(20);
  check('Next Friday: no supersets', !/A1/.test(wpTags()) && wpRows().length>0, wpTags());
  doc.getElementById('closeWorkoutPreview').click();

  doc.querySelector('.lang-btn[data-lang="es"]').click();
  await wait(20);
  goPill('home');
  await wait(20);
  doc.getElementById('changeExercisesBtn').click();
  await wait(20);
  check('In Spanish', /Hacerlo un circuito|Separar el circuito/.test(doc.getElementById('wpCircuitBtn').textContent), doc.getElementById('wpCircuitBtn').textContent);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
