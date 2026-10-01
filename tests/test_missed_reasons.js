const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A missed workout can say why -- sick, injured, vacation, work, needed rest, other, plus a note. It then
// shows as excused rather than missed, and a sick / injured / vacation week pauses the streak instead of
// breaking it.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

// Today is Friday Sep 18. Two workouts the week of Aug 31, none the week of Sep 7 (Wed Sep 9 missed,
// marked sick), two so far this week.
function makeBackend(){
  const logs = {}, updates = [];
  let n = 1;
  const addLog = (log_date, f) => { const id = 'l'+(n++); logs[id] = {id, user_id:'u1', log_date, completed_override:null, manual_entries:[], ...f}; };
  addLog('2026-08-31', {completed_override:true});
  addLog('2026-09-02', {completed_override:true});
  addLog('2026-09-09', {missed_reason:'sick', missed_note:'Flu'});
  addLog('2026-09-14', {completed_override:true});
  addLog('2026-09-16', {completed_override:true});
  const db = { profiles: {u1: {id:'u1', full_name:'Sam', goal:'mix', level:'intermediate', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, plan_start:'2026-08-31'}}, workout_logs: logs };
  function from(table){
    let filters = [], op = 'select', payload = null;
    const api = {
      select(){ return api; }, order(){ return api; }, in(){ return api; }, is(){ return api; }, gte(){ return api; }, lte(){ return api; }, limit(){ return api; },
      eq(c,v){ filters.push([c,v]); return api; },
      upsert(p){ op='upsert'; payload=p; return api; }, update(p){ op='update'; payload=p; return api; }, insert(p){ op='insert'; payload=p; return api; }, delete(){ op='noop'; return api; },
      maybeSingle(){ return run(true); }, single(){ return run(true); },
      then(res, rej){ return run(false).then(res, rej); },
    };
    async function run(single){
      const rows = db[table];
      const hit = rows ? Object.values(rows).filter(r=>filters.every(([c,v])=>r[c]===v)) : [];
      if(op==='update'){ hit.forEach(r=>Object.assign(r, payload)); if(table==='workout_logs') updates.push(payload); return {data:null, error:null}; }
      if(op==='insert' && table==='workout_logs'){ const id='l'+(n++); db.workout_logs[id] = {id, manual_entries:[], ...payload}; return {data:{id}, error:null}; }
      if(op!=='select') return {data: single ? {id:'x'+(n++)} : [], error:null};
      if(single) return {data: hit[0]||null, error:null};
      return {data: hit, error:null};
    }
    return api;
  }
  const user = {id:'u1', email:'sam@example.com'};
  return { db, updates, createClient: () => ({
    auth: { async getSession(){ return {data:{session:{user}}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async signOut(){ return {}; } },
    from, functions: { async invoke(){ return {data:{connected:false}, error:null}; } },
  }) };
}

(async () => {
  const backend = makeBackend();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/Altiro/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; },
  });
  const w = dom.window, doc = w.document;
  await wait(300);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const click = async sel => { doc.querySelector(sel).click(); await wait(20); };
  const streak = () => parseInt(doc.getElementById('streakChip').textContent, 10);
  const openCalDay = async key => {
    go('calendar'); await wait(20);
    for(let i=0; i<4 && !doc.querySelector(`.mo-cell[data-date="${key}"]`); i++){
      const shown = doc.querySelector('.mo-cell[data-date]').getAttribute('data-date');
      doc.getElementById(key < shown ? 'calPrev' : 'calNext').click(); await wait(20);
    }
    doc.querySelector(`.mo-cell[data-date="${key}"]`).click(); await wait(20);
  };
  go('home'); await wait(20);

  // ---- the sick week pauses the streak ----
  check('A week marked sick doesn\'t break the streak (this week + the week before it)', streak()===2, streak());
  await openCalDay('2026-09-09');
  check('That day shows as excused, with its reason', doc.querySelector('.mo-cell[data-date="2026-09-09"]').classList.contains('excused') && /Sick/.test(doc.querySelector('#dayDetailPlanRow .stpill')?.textContent||''), doc.querySelector('.mo-cell[data-date="2026-09-09"]').className);
  check('...and its note', doc.getElementById('missedNoteInput').value==='Flu');
  check('...and explains the streak pause', !doc.getElementById('dayDetailMissedSection').hidden && !doc.getElementById('missedPauseNote').hidden);
  await click('#missedReasonRow [data-missed-reason="sick"]');
  check('Tapping the reason again clears it: missed again', doc.querySelector('.mo-cell[data-date="2026-09-09"]').classList.contains('missed') && /Missed/i.test(doc.querySelector('#dayDetailPlanRow .stpill')?.textContent||''));
  await click('#closeDayDetail');
  go('home'); await wait(20);
  check('...and the streak breaks there', streak()===1, streak());

  // ---- other reasons: excused, but the streak isn't paused ----
  await openCalDay('2026-09-09');
  await click('#missedReasonRow [data-missed-reason="busy"]');
  check('Work / Busy: excused too', doc.querySelector('.mo-cell[data-date="2026-09-09"]').classList.contains('excused'));
  check('...without the streak pause note', doc.getElementById('missedPauseNote').hidden);
  const saved = backend.updates.filter(u=>'missed_reason' in u).pop();
  check('...saved to the account', saved && saved.missed_reason==='busy', JSON.stringify(saved));
  const note = doc.getElementById('missedNoteInput');
  note.value = 'Late shift'; note.dispatchEvent(new w.Event('change', {bubbles:true})); await wait(20);
  check('...with a note', backend.updates.filter(u=>'missed_reason' in u).pop().missed_note==='Late shift');
  await click('#closeDayDetail');
  go('home'); await wait(20);
  check('...but the streak stays broken (only sick, injured or vacation pause it)', streak()===1, streak());

  // ---- vacation ----
  await openCalDay('2026-09-09');
  await click('#missedReasonRow [data-missed-reason="vacation"]');
  await click('#closeDayDetail');
  go('home'); await wait(20);
  check('Vacation pauses it again', streak()===2, streak());

  // ---- today, not done yet: can say why ----
  await openCalDay('2026-09-18');
  check('Today, not done: "Can\'t make it today?"', !doc.getElementById('dayDetailMissedSection').hidden && /Can't make it today/.test(doc.getElementById('missedWhyLabel').textContent));
  await click('#missedReasonRow [data-missed-reason="injured"]');
  check('...marking it injured excuses today', doc.querySelector('.mo-cell[data-date="2026-09-18"]').classList.contains('excused'));
  await click('#closeDayDetail');
  go('week'); await wait(20);
  const planTags = [...doc.querySelectorAll('.prow-status.excused')].map(e=>e.textContent);
  check('...and the Plan list shows the reason', planTags.includes('Injured'), planTags.join(', '));
  await openCalDay('2026-09-25');
  check('A future day has nothing to excuse yet', doc.getElementById('dayDetailMissedSection').hidden);
  await click('#closeDayDetail');

  // ---- in Spanish ----
  go('settings'); await wait(10);
  doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
  await openCalDay('2026-09-09');
  check('In Spanish', /Vacaciones/.test(doc.querySelector('#dayDetailPlanRow .stpill')?.textContent||'') && /¿Por qué no lo hiciste\?/.test(doc.getElementById('missedWhyLabel').textContent));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
