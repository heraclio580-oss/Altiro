const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A new account's first steps on Home -- first workout, location, reminders, Strava (optional) -- each one
// a tap away, ticked off as they're done, gone once the three that matter are done or it's hidden, and
// never shown to an account older than two weeks.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const flat = el => el ? el.textContent.replace(/\s+/g,' ').trim() : '';

function app(createdAt, before){
  function from(table){ let op='select'; const api = { select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; }, in(){ return api; },
    insert(){ op='insert'; return api; }, delete(){ op='delete'; return api; }, update(){ op='update'; return api; }, upsert(){ op='upsert'; return api; },
    maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', goal:'both', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, level:'beginner', equipment:'gym', plan_start:'2026-09-14', created_at: createdAt, badges:{day_one: createdAt.slice(0,10)}} : null, error:null}); },
    then(r, j){ return Promise.resolve({data: op==='select' ? [] : null, error:null}).then(r, j); } }; return api; }
  const client = { auth:{ onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'new@example.com'}}}}; }, async signOut(){ return {error:null}; } }, from };
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => client }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; if(before) before(w); } });
}

(async () => {
  {
    const dom = app('2026-09-16T15:00:00Z');
    await wait(900);
    const doc = dom.window.document, ck = doc.getElementById('homeChecklist');
    const item = k => ck.querySelector(`[data-ck="${k}"]`);
    check('A new account sees "Getting started" on Home', !ck.hidden && /Getting started/.test(flat(ck)), flat(ck).slice(0,60));
    check('...four steps, none done yet', ck.querySelectorAll('[data-ck]').length===4 && /0 of 4/.test(flat(ck)) && !ck.querySelector('.ck-item.done'), flat(ck));
    check('...Strava marked optional', /Connect Strava \(optional\)/.test(flat(item('strava'))));
    item('location').click();
    await wait(10);
    check('"Allow location" opens the location prompt', !doc.getElementById('locPromptOverlay').hidden);
    doc.getElementById('locPromptLater').click();
    item('reminders').click();
    await wait(100);
    check('"Turn on reminders" goes to that setting', !doc.getElementById('screen-settings').hidden);
    // Do a workout: that step ticks off.
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(20);
    doc.getElementById('addTodayWorkoutBtn').click();
    await wait(20);
    doc.getElementById('manualNameInput').value = 'First Walk';
    doc.getElementById('manualNameInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
    [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
    doc.getElementById('createCompletedToggle').click();
    doc.getElementById('manualDistanceInput').value = '1';
    doc.getElementById('saveManualEntry').click();
    await wait(80);
    if(!doc.getElementById('dayDetailOverlay').hidden) doc.getElementById('closeDayDetail').click();
    if(!doc.getElementById('badgeOverlay').hidden) doc.getElementById('badgeDoneBtn').click();
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(30);
    check('Doing a workout ticks off the first step', item('workout').classList.contains('done') && /1 of 4/.test(flat(ck)), flat(ck));
    ck.querySelector('#ckHideBtn').click();
    await wait(10);
    check('It can be hidden', ck.hidden);
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'week').click();
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(20);
    check('...and stays hidden', ck.hidden);
  }
  {
    const dom = app('2026-08-01T15:00:00Z');
    await wait(900);
    check('An account older than two weeks never sees it', dom.window.document.getElementById('homeChecklist').hidden);
  }
  {
    const dom = app('2026-09-17T15:00:00Z', w=>{ w.localStorage.setItem('altiro_weather_ok', '1'); });
    await wait(900);
    const ck = dom.window.document.getElementById('homeChecklist');
    check('Location already allowed: that step is already ticked', ck.querySelector('[data-ck="location"]').classList.contains('done'));
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
