const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The week before a plan starts, with the user's own workouts on it -- some saved as the day's own workout,
// some added to a rest day (which then shows as that day's workout). Dragging a missed run onto a later day
// puts the run there (the days between shift up, as any drag does): the whole day moves, added workouts
// included, and a rest day doesn't drag its "Plan starts Monday" note along. Nothing disappears.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const flat = el => el ? el.textContent.replace(/\s+/g,' ').trim() : '';

const day = (date, type, title, detail, done) => ({id:'w'+date, user_id:'u1', log_date:date, completed_override: done ? true : null, planned_type:type, planned_title:title, planned_detail:detail, manual_entries:[]});
const added = (id, date, title, detail) => ({id, user_id:'u1', log_date:date, session_type:'run', title, detail, completed:false});

async function openWeek(logRows, extras){
  const dayUpdates = [], moves = [];
  function from(table){
    let op = 'select', payload = null, id = null;
    const api = { select(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; }, in(){ return api; },
      eq(c, v){ if(c==='id' || c==='log_date') id = v; return api; },
      insert(p){ op = 'insert'; payload = p; return api; }, delete(){ op = 'delete'; return api; }, update(p){ op = 'update'; payload = p; return api; }, upsert(){ op = 'upsert'; return api; },
      maybeSingle(){
        if(table==='profiles') return Promise.resolve({data:{id:'u1', goal:'both', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-10-12', plan_start_date:'2026-10-12', created_at:'2026-09-01T12:00:00Z', badges:{day_one:'2026-09-01'}}, error:null});
        if(table==='workout_logs') return Promise.resolve({data:{id:'w'+(payload && payload.log_date || id)}, error:null});
        return Promise.resolve({data:null, error:null});
      },
      then(r, j){
        if(op==='update' && table==='workout_logs') dayUpdates.push([id, payload]);
        if(op==='update' && table==='planned_workouts' && payload.log_date) moves.push(`${id}->${payload.log_date}`);
        return Promise.resolve({data: op==='select' ? (table==='workout_logs' ? logRows : table==='planned_workouts' ? extras : []) : null, error:null}).then(r, j); } };
    return api;
  }
  const client = { auth:{ onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'a@b.c'}}}}; }, async signOut(){ return {error:null}; } }, from };
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => client }; w.__ALTIRO_TEST_TODAY__ = '2026-10-08'; } });
  const { window } = dom;
  const ROW_H = 50;
  window.Element.prototype.getBoundingClientRect = function(){
    const f = this.getAttribute && this.getAttribute('data-flat-idx');
    if(this.classList && this.classList.contains('plan-row') && f!==null){ const top = parseInt(f,10)*ROW_H; return {top, bottom:top+ROW_H, left:0, right:300, width:300, height:ROW_H, x:0, y:top}; }
    return {top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0};
  };
  await wait(900);
  const doc = window.document;
  if(!doc.getElementById('badgeOverlay').hidden) doc.getElementById('badgeDoneBtn').click();
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'week').click();
  await wait(30);
  const rowEl = d => doc.querySelector(`.plan-row[data-day="${d}"][data-week-idx="0"]`);
  const fire = (el, type, y)=> el.dispatchEvent(new window.PointerEvent(type, {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:y}));
  return {
    doc, dayUpdates, moves,
    titles: () => [0,1,2,3,4,5,6].map(d=> flat(rowEl(d).querySelector('.prow-title'))).join('|'),
    detail: d => flat(rowEl(d).querySelector('.prow-detail')),
    async drag(from, to){
      const y = d => parseInt(rowEl(d).getAttribute('data-flat-idx'),10)*ROW_H + 25, el = rowEl(from);
      fire(el, 'pointerdown', y(from)); await wait(400);
      fire(el, 'pointermove', y(to)); await wait(20);
      fire(el, 'pointerup', y(to)); await wait(60);
    },
  };
}
const WEEK = 'Pull day|Rest Day|4.5 mile easy run|5mil hill sprints|Rest Day|18mi long run|Easy 4.5 mile run';
const MOVED = 'Pull day|Rest Day|5mil hill sprints|Rest Day|4.5 mile easy run|18mi long run|Easy 4.5 mile run';

(async () => {
  // Each workout saved as its day's own workout.
  {
    const w = await openWeek([day('2026-10-05','strength','Pull day','',true), day('2026-10-07','run','4.5 mile easy run','4.5 mi'), day('2026-10-08','run','5mil hill sprints','5mi'), day('2026-10-10','run','18mi long run','18mi'), day('2026-10-11','run','Easy 4.5 mile run','4.5 mi')], []);
    check('(set-up, own workouts) the week as on the phone', w.titles()===WEEK, w.titles());
    await w.drag(2, 4);
    check('Dragging Wednesday\'s missed run to Friday: it lands on Friday, Thursday and Friday shift up', w.titles()===MOVED, w.titles());
    const fri = w.dayUpdates.filter(([id, p])=> /2026-10-09/.test(id) && 'planned_title' in p).pop();
    check('...saved to the cloud', fri && fri[1].planned_title==='4.5 mile easy run', JSON.stringify(fri));
  }
  // Each workout added to a rest day (how "+ Add" saves it) -- the case from the phone.
  {
    const w = await openWeek([day('2026-10-05','strength','Pull day','',true)],
      [added('x7','2026-10-07','4.5 mile easy run','4.5 mi'), added('x8','2026-10-08','5mil hill sprints','5mi'), added('x10','2026-10-10','18mi long run','18mi'), added('x11','2026-10-11','Easy 4.5 mile run','4.5 mi')]);
    check('(set-up, added workouts) the week as on the phone', w.titles()===WEEK, w.titles());
    check('(set-up) Friday is a rest day with the plan\'s start date on it', /Plan starts/.test(w.detail(4)), w.detail(4));
    await w.drag(2, 4);
    check('Dragging the missed run to Friday: the run moves too (it\'s the day\'s workout)', w.titles()===MOVED, w.titles());
    check('...the rest day moved up to Thursday is a plain rest day (no "Plan starts" note)', !/Plan starts/.test(w.detail(3)), w.detail(3));
    check('...and the cloud moves the workouts to their new days', w.moves.includes('x7->2026-10-09') && w.moves.includes('x8->2026-10-07'), w.moves.join(', '));
    // Dragging the sprints (now Wednesday) back down to Friday: the run doesn't stay behind.
    w.moves.length = 0;
    await w.drag(2, 4);
    check('Dragging the sprints back to Friday: everything follows, nothing is left on Wednesday', w.titles()==='Pull day|Rest Day|Rest Day|4.5 mile easy run|5mil hill sprints|18mi long run|Easy 4.5 mile run', w.titles());
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
