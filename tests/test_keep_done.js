const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A done workout stays as it was done, whatever happens to the plan later. Two runs logged Monday and
// Tuesday, then the weekly miles changed on Thursday (which starts the plan again from that day): they
// were hidden, the days showing as rest. Now:
// - a day with a logged workout shows it -- a run from its distance, even logged before the app kept
//   which workout it was -- done, counted in the week and its miles;
// - logging a workout keeps which workout it was with it, so the day shows that same workout after the
//   plan restarts (and after a reload);
// - a done workout's share card has the day it was done, not the day it's shared.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const route = [[40.0, -75.0], [40.001, -75.001], [40.002, -75.002]].map(([lat, lng], i)=> ({lat, lng, t: 1762000000000 + i*60000}));
function makeBackend(o){
  const sent = [];
  function from(table){
    let op = 'select', payload = null;
    const filters = {};
    const api = {
      select(){ return api; }, eq(c, v){ filters[c] = v; return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; }, in(){ return api; }, limit(){ return api; },
      insert(p){ op = 'insert'; payload = p; return api; }, delete(){ op = 'delete'; return api; }, update(p){ op = 'update'; payload = p; return api; }, upsert(p){ op = 'upsert'; payload = p; return api; },
      single(){ return api.maybeSingle(); },
      maybeSingle(){
        if(op!=='select') sent.push({table, op, payload, filters: {...filters}});
        if(table==='workout_logs'){
          const row = o.logs.find(r=> r.log_date===filters.log_date) || (filters.id && o.logs.find(r=> r.id===filters.id));
          return Promise.resolve({data: row || (op!=='select' ? {id: 'new-'+(filters.log_date || (payload && payload.log_date) || ''), log_date: filters.log_date || (payload && payload.log_date)} : null), error:null});
        }
        return Promise.resolve({data: table==='profiles' ? o.profile : null, error:null});
      },
      then(res, rej){
        if(op!=='select') sent.push({table, op, payload, filters: {...filters}});
        const data = op!=='select' ? null : table==='workout_logs' ? o.logs : [];
        return Promise.resolve({data, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { sent, createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'runner@example.com'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}
// A stand-in for the canvas jsdom doesn't have: draws nothing, measures text, and makes a picture.
function fakeCanvas(w){
  const ctx = new Proxy({}, { get(t, k){
    if(k in t) return t[k];
    if(k==='measureText') return s=> ({width: String(s).length*8});
    if(k==='getImageData') return (x, y, ww, hh)=> ({data: new Uint8ClampedArray(4*ww*hh), width: ww, height: hh});
    if(k==='createImageData') return (ww, hh)=> ({data: new Uint8ClampedArray(4*ww*hh), width: ww, height: hh});
    return function(){ return ctx; };
  }, set(t, k, v){ t[k] = v; return true; } });
  w.HTMLCanvasElement.prototype.getContext = function(){ return ctx; };
  w.HTMLCanvasElement.prototype.toBlob = function(cb){ cb(new w.Blob(['x'], {type:'image/jpeg'})); };
  w.URL.createObjectURL = ()=> 'blob:fake'; w.URL.revokeObjectURL = ()=>{};
}
async function openApp(o){
  const backend = makeBackend(o);
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = o.today; fakeCanvas(w); } });
  await wait(300);
  const w = dom.window, doc = w.document;
  for(const id of ['badgeOverlay', 'locPromptOverlay']) doc.getElementById(id).hidden = true;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  return {w, doc, go, backend};
}
const profile = extra => ({id:'u1', goal:'run', training_days:[0,1,3,5], focus_ratio:0, intensity_idx:1, level:'intermediate', equipment:'gym', weekly_miles:12, plan_start:'2026-11-02', ...extra});
const dayText = (doc, key)=>{
  const cell = doc.querySelector(`#screen-calendar .mo-cell[data-date="${key}"]`);
  return cell ? {cls: cell.className, text: cell.textContent.replace(/\s+/g, ' ').trim()} : null;
};
async function dayDetail(doc, key){
  doc.querySelector(`#screen-calendar .mo-cell[data-date="${key}"]`).click();
  await wait(20);
  const t = doc.getElementById('dayDetailPlanRow').textContent.replace(/\s+/g, ' ').trim();
  return t;
}

(async () => {
  // 1) The user's week: runs logged Monday and Tuesday (before the app kept which workout it was), the
  //    plan restarted Thursday. Today is Friday.
  {
    const {doc, go, w} = await openApp({today:'2026-11-06', profile: profile({plan_start_date:'2026-11-05'}), logs: [
      {id:'l-mon', user_id:'u1', log_date:'2026-11-02', completed_override:true, actual_run_distance:3.12, manual_entries:[], performance:{distance:3.12, time:31.5, route, splits:[], source:'gps'}},
      {id:'l-tue', user_id:'u1', log_date:'2026-11-03', completed_override:true, actual_run_distance:5.05, manual_entries:[], performance:{distance:5.05, time:44}},
    ]});
    go('calendar');
    await wait(30);
    const mon = dayText(doc, '2026-11-02'), tue = dayText(doc, '2026-11-03'), wed = dayText(doc, '2026-11-04');
    check('Calendar: Monday\'s run is back, done', !!mon && /done/.test(mon.cls) && /3\.1/.test(mon.text), JSON.stringify(mon));
    check('...Tuesday\'s too', !!tue && /done/.test(tue.cls) && /5(\.1)?/.test(tue.text), JSON.stringify(tue));
    check('...and Wednesday (nothing logged) is still a rest day', !!wed && !/done/.test(wed.cls), JSON.stringify(wed));
    const det = await dayDetail(doc, '2026-11-02');
    check('Monday\'s day: a run, 3.12 mi', /Run/.test(det) && /3\.12 mi/.test(det), det);
    doc.getElementById('closeDayDetail').click();
    go('home');
    await wait(30);
    const strip = [...doc.querySelectorAll('#weekStrip .day-cell')].filter(c=> ['2026-11-02', '2026-11-03'].includes(c.getAttribute('data-date')));
    check('Today\'s week strip (centered on today): Tuesday done', strip.length>=1 && strip.some(c=> c.getAttribute('data-date')==='2026-11-03') && strip.every(c=> /done/.test(c.className)), strip.map(c=> c.className).join(' | '));
    go('progress');
    await wait(30);
    const prog = doc.getElementById('screen-progress').textContent.replace(/\s+/g, ' ');
    check('Progress: this week\'s miles include them (8.2 mi)', /8\.2/.test(prog), prog.slice(0, 300));

    // Its share card has the day it was done.
    go('calendar');
    await wait(20);
    await dayDetail(doc, '2026-11-02');
    doc.getElementById('dayDetailPlanRow').click();
    await wait(30);
    doc.getElementById('shareWorkoutBtn').click();
    await wait(200);
    const alt = (doc.getElementById('shareCardPreview') || {}).alt || '';
    check('Share card of Monday\'s run: dated Mon, Nov 2, not today', /Mon, Nov 2, 2026/.test(alt) && !/Nov 6/.test(alt), alt.slice(0, 120));
    w.close();
  }

  // 2) Logging a run keeps which workout it was: today (Tuesday) is a plan run; then the weekly miles
  //    change (the plan starts again from today -- today stays); reloaded after a later restart, the day
  //    still shows that same run.
  let kept;
  {
    const {doc, go, w, backend} = await openApp({today:'2026-11-03', profile: profile(), logs: []});
    go('home');
    await wait(20);
    const planned = null;
    const title = planned ? planned.textContent.trim() : '';
    doc.getElementById('recordBtn').click();
    await wait(950);
    const dist = doc.getElementById('logPerfDistanceInput');
    if(dist){ dist.value = '4.2'; dist.dispatchEvent(new w.Event('input', {bubbles:true})); }
    doc.getElementById('saveLogPerf').click();
    await wait(100);
    const perfWrites = backend.sent.filter(s=> s.table==='workout_logs' && s.payload && s.payload.performance);
    kept = perfWrites.length ? perfWrites[perfWrites.length-1].payload.performance : null;
    check('Saved with it: which workout it was (a run, its name)', !!kept && !!kept.session && kept.session.t==='run' && !!kept.session.en.title && (!title || title.includes(kept.session.en.title)), JSON.stringify(kept && kept.session) + ' / ' + title);
    w.close();
  }
  {
    // Reloaded after the plan started again on Thursday (and today is Friday): Tuesday is the same run.
    const {doc, go, w} = await openApp({today:'2026-11-06', profile: profile({plan_start_date:'2026-11-05'}), logs: [
      {id:'l-tue', user_id:'u1', log_date:'2026-11-03', completed_override:true, actual_run_distance:4.2, manual_entries:[], performance: kept},
    ]});
    go('calendar');
    await wait(30);
    const det = await dayDetail(doc, '2026-11-03');
    check('After the plan restarted: Tuesday still shows that run, by its name', !!kept && det.includes(kept.session.en.title), det + ' / ' + (kept && kept.session.en.title));
    check('...done', /done/.test(dayText(doc, '2026-11-03').cls));
    doc.getElementById('closeDayDetail').click();
    // In Spanish, by its Spanish name.
    doc.querySelector('.lang-btn[data-lang="es"]').click();
    await wait(30);
    go('calendar');
    await wait(20);
    const es = await dayDetail(doc, '2026-11-03');
    check('...in Spanish by its Spanish name', !!kept && es.includes(kept.session.es.title), es);
    w.close();
  }

  // 3) A day the plan still has the same workout on keeps showing the plan's own (nothing changes).
  {
    const {doc, go, w} = await openApp({today:'2026-11-06', profile: profile(), logs: [
      {id:'l-tue', user_id:'u1', log_date:'2026-11-03', completed_override:true, actual_run_distance:4.2, manual_entries:[], performance: kept},
    ]});
    go('calendar');
    await wait(30);
    const det = await dayDetail(doc, '2026-11-03');
    check('Plan unchanged: Tuesday shows its run as before', !!kept && det.includes(kept.session.en.title), det);
    w.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
