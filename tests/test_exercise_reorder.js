const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Changing the order of a workout's exercises while doing it (the next machine is free, so that exercise
// goes to the top): hold its handle and drag, and the others slide out of the way, like the Plan page.
// What's typed and ticked moves with it, the moved exercise becomes the one up next, and a superset moves
// as one block. Only this workout's order changes -- the plan's workout keeps its order for next time.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// jsdom has no layout: each exercise block is 50px tall with a 10px gap, by its place in the list, and
// its handle sits 10px into it. (The sheet has no height, so it never auto-scrolls here.)
const BLOCK = 60;
const blockY = i => i*BLOCK + 15;
async function open(){
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; window.Element.prototype.getBoundingClientRect = fakeRect; } });
  await wait(50);
  const window = dom.window, doc = window.document;
  const list = () => doc.getElementById('logPerfExercisesList');
  const row = key => [...list().querySelectorAll('.exercise-log-row')].find(r=> r.getAttribute('data-exercise-key')===key);
  return {
    window, doc, list, row,
    goPill: id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click(),
    keys: () => [...list().querySelectorAll('.exercise-log-row')].map(r=> r.getAttribute('data-exercise-key')),
    handleOf: key => row(key).querySelector('.ex-drag'),
    current: () => { const r = list().querySelector('.exercise-log-row.current-exercise'); return r && r.getAttribute('data-exercise-key'); },
    pointer: (el, type, y) => el.dispatchEvent(new window.PointerEvent(type, {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:y})),
  };
}
function fakeRect(){
  const block = this.classList && (this.classList.contains('ex-block') ? this : this.classList.contains('ex-drag') ? this.closest('.ex-block') : null);
  if(block){
    const i = [...block.parentElement.children].indexOf(block);
    const top = i*BLOCK + (block===this ? 0 : 10), h = block===this ? 50 : 20;
    return { top, bottom: top+h, left:0, right:300, width:300, height:h, x:0, y:top };
  }
  return { top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0 };
};
async function drag(pointer, handle, fromY, toY, end){
  pointer(handle, 'pointerdown', fromY);
  pointer(handle, 'pointermove', (fromY+toY)/2);
  pointer(handle, 'pointermove', toY);
  pointer(handle, end || 'pointerup', toY);
  await wait(20);
}

(async () => {
  let {window, doc, list, row, goPill, keys, handleOf, current, pointer} = await open();

  // A weights-only plan, so today's generated workout is a lifting day.
  goPill('adjust');
  for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  doc.getElementById('applyAdjust').click();
  await wait(10);
  goPill('home');
  await wait(20);
  const homeOrder = () => [...doc.querySelectorAll('#screen-home .r-exercise-list li')].map(li=> li.textContent.replace(/\s+/g,' ').trim());
  const planOrder = homeOrder();
  doc.getElementById('recordBtn').click();
  await wait(950);

  const start = keys();
  check('Today\'s workout has a few exercises to reorder', start.length>=3, start.length);
  check('Each exercise has a drag handle', list().querySelectorAll('.ex-drag').length===start.length);
  check('...with a hint for what it does', /Hold and drag to change the order/.test(handleOf(start[0]).getAttribute('title')));
  check('Starts on the first exercise', current()===start[0], current());

  // Something typed and ticked before the move.
  row(start[2]).querySelector('[data-field="weight"]').value = '123';
  row(start[2]).querySelector('[data-field="weight"]').dispatchEvent(new window.Event('input', {bubbles:true}));
  row(start[0]).querySelector('.set-check-dot').click();
  await wait(10);

  // A tap on the handle alone changes nothing.
  pointer(handleOf(start[1]), 'pointerdown', blockY(1));
  pointer(handleOf(start[1]), 'pointerup', blockY(1));
  handleOf(start[1]).click();
  await wait(20);
  check('A tap on a handle changes nothing (and doesn\'t pick that exercise)', keys().join()===start.join() && current()===start[0], keys().join()+' current:'+current());
  check('...and the list isn\'t left folded', !list().classList.contains('ex-reordering'));

  // Mid-drag: everything folds to its name line, and the exercises it passes slide down out of the way.
  const h = handleOf(start[2]);
  pointer(h, 'pointerdown', blockY(2));
  check('Holding a handle folds every exercise to its name line', list().classList.contains('ex-reordering'));
  check('...and lifts the one being moved', h.closest('.ex-block').classList.contains('ex-dragging'));
  pointer(h, 'pointermove', blockY(0) - 5);
  const blocks = [...list().querySelectorAll('.ex-block')];
  check('Dragged up past two exercises: both slide down to make room', blocks[0].style.transform==='translateY(60px)' && blocks[1].style.transform==='translateY(60px)', blocks.map(b=>b.style.transform).join('|'));
  check('...the rest stay put', blocks.slice(3).every(b=> !b.style.transform));
  pointer(h, 'pointerup', blockY(0) - 5);
  await wait(20);
  const moved = [start[2], start[0], start[1], ...start.slice(3)];
  check('Dropped at the top: it\'s first now, the others moved down one', keys().join()===moved.join(), keys().join());
  check('...and it\'s the one up next', current()===start[2], current());
  check('...what was typed in it moved with it', row(start[2]).querySelector('[data-field="weight"]').value==='123', row(start[2]).querySelector('[data-field="weight"]').value);
  check('...and the set already ticked elsewhere is still ticked', row(start[0]).querySelector('.set-check-dot').classList.contains('checked'));
  check('...the list is unfolded again', !list().classList.contains('ex-reordering') && !list().querySelector('.ex-dragging'));

  // Cancelled (e.g. the phone took the gesture): nothing changes.
  await drag(pointer, handleOf(moved[3] || moved[2]), blockY(3), blockY(0), 'pointercancel');
  check('A cancelled drag changes nothing', keys().join()===moved.join(), keys().join());

  // Closing and coming back (or the app restarting) keeps the new order.
  doc.getElementById('closeLogPerf').click();
  await wait(20);
  check('The plan\'s workout keeps its own order (for next time)', homeOrder().join()===planOrder.join(), homeOrder().join(' | '));
  doc.getElementById('recordBtn').click();
  await wait(950);
  check('Reopened mid-workout: still in the new order', keys().join()===moved.join(), keys().join());
  check('...with what was typed', row(start[2]).querySelector('[data-field="weight"]').value==='123');

  // Saved: the workout is logged in the order it was done.
  doc.getElementById('saveLogPerf').click();
  await wait(60);
  const summary = [...doc.querySelectorAll('#summaryExercisesList .se-name')].map(e=> e.textContent);
  const firstName = planOrder[2] ? planOrder[2] : '';
  check('The summary lists them in the order done', summary.length===start.length && firstName.startsWith(summary[0]), summary.join(' | ')+' / expected first: '+firstName);

  // ---- A workout of the user's own, with a superset ----
  ({window, doc, list, row, goPill, keys, handleOf, current, pointer} = await open());
  goPill('home');
  await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  const items = () => [...doc.querySelectorAll('#createExercisesList .exercise-edit-item')];
  const fill = (item, name, sets, reps) => { item.querySelector('.ex-name').value = name; item.querySelector('.ex-sets').value = sets; item.querySelector('.ex-reps').value = reps; };
  doc.getElementById('manualNameInput').value = 'Upper';
  fill(items()[0], 'Bench Press', 2, 8);
  fill(items()[1], 'Seated Row', 2, 10);
  fill(items()[2], 'Lateral Raise', 2, 15);
  items()[1].querySelector('.ss-link').click();
  await wait(5);
  doc.getElementById('saveManualEntry').click();
  await wait(30);
  doc.querySelector('#homeExtraWorkoutsWrap [data-start-extra]').click();
  await wait(950);
  check('A superset is one block to move', list().querySelectorAll('.ex-block').length===2 && list().querySelectorAll('.ex-block')[0].querySelectorAll('.exercise-log-row').length===2);
  await drag(pointer, handleOf('Lateral Raise'), blockY(1), blockY(0) - 5);
  check('Moving the lone exercise above the superset', keys().join()==='Lateral Raise,Bench Press,Seated Row', keys().join());
  const ss = list().querySelector('.ss-head');
  check('...the superset is still together, still Superset A', ss && /Superset A/.test(ss.textContent) && row('Bench Press').classList.contains('ss-member') && row('Seated Row').classList.contains('ss-member'), ss && ss.textContent);
  await drag(pointer, handleOf('Seated Row'), blockY(1), blockY(0) - 5);
  check('Dragging a superset by either exercise moves both', keys().join()==='Bench Press,Seated Row,Lateral Raise', keys().join());
  check('...and its first exercise is up next', current()==='Bench Press', current());

  // In Spanish.
  doc.getElementById('closeLogPerf').click();
  await wait(20);
  doc.querySelector('.lang-btn[data-lang="es"]').click();
  await wait(20);
  doc.querySelector('#homeExtraWorkoutsWrap [data-start-extra]').click();
  await wait(950);
  check('In Spanish', /Mantén presionado y arrastra para cambiar el orden/.test(handleOf('Bench Press').getAttribute('title')), handleOf('Bench Press').getAttribute('title'));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
