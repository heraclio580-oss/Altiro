const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// "Create my own workouts": on the first setup question it skips the rest of the questions; in Adjust
// it turns the generated plan off (and back on). With it on, every day is open for the user's own
// workouts, and Today's button adds one.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  const w = dom.window, doc = w.document;
  await wait(50);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const text = el => (el ? el.textContent : '').replace(/\s+/g,' ').trim();
  const screen = () => [...doc.querySelectorAll('.screen')].find(s=>!s.hidden).id;
  const click = async el => { (typeof el==='string' ? doc.querySelector(el) : el).click(); await wait(20); };
  const rows = idx => [...doc.querySelectorAll(`.plan-row[data-week-idx="${idx}"]`)].map(text);
  const workoutsIn = idx => rows(idx).filter(r=>!/Rest Day/.test(r)).length;

  // ---- setup: the first question can skip the rest ----
  go('welcome'); await wait(20);
  await click('[data-go="onb-goal"]');
  const toggle = doc.getElementById('onbOwnToggle'), next = doc.getElementById('goalNext');
  check('The first question offers "Create my own workouts"', !!toggle && /Create my own workouts/.test(text(toggle.closest('.toggle-row'))) && next.disabled);
  await click(toggle);
  check('Turning it on lets them continue without answering', toggle.classList.contains('on') && !next.disabled);
  await click(next);
  check('...straight to creating the account', screen()==='screen-onb-account', screen());
  await click('#accountBackBtn');
  check('Back from the account goes back to that question', screen()==='screen-onb-goal');
  await click('#goalList .option-card');
  check('Picking a goal instead turns it off (the questions are back)', !toggle.classList.contains('on') && next.getAttribute('data-go')==='onb-level');
  await click(toggle);
  await click(next);

  // ---- their app: every day open ----
  go('loading'); await wait(4200);
  if(!doc.getElementById('tourOverlay').hidden) doc.getElementById('tourSkip').click();
  go('home'); await wait(20);
  check('Today: nothing planned yet', /Nothing planned yet/.test(text(doc.getElementById('todayHero'))), text(doc.getElementById('todayHero')));
  const btn = doc.getElementById('recordBtn');
  check('...and its button adds a workout', /Add Workout/.test(text(btn)) && !btn.classList.contains('disabled'), text(btn));
  await click(btn);
  check('...opening Create Workout for today', !doc.getElementById('manualEntryOverlay').hidden);
  doc.getElementById('manualNameInput').value = 'Push Day';
  doc.getElementById('manualNameInput').dispatchEvent(new w.Event('input', {bubbles:true}));
  await click('#manualTypeRow [data-type="strength"]');
  await click('#saveManualEntry');
  check('A workout they create is today\'s workout', /Push Day/.test(text(doc.querySelector('#sessionCard .title'))), text(doc.querySelector('#sessionCard .title')));
  go('week'); await wait(20);
  check('The Plan has no generated workouts, only theirs', workoutsIn(0)===1 && workoutsIn(1)===0, rows(0).join(' | '));
  check('...and no build / deload weeks', !/Build week|Deload week/i.test(text(doc.getElementById('weekList'))));

  // ---- Adjust: the switch is there, and turns the plan on ----
  go('adjust'); await wait(20);
  const adjToggle = doc.getElementById('adjOwnToggle');
  check('Adjust shows the switch on, with the plan\'s options put away', adjToggle.classList.contains('on') && doc.getElementById('adjPlanOptions').hidden);
  await click(adjToggle);
  check('Turning it off brings the plan\'s options back', !adjToggle.classList.contains('on') && !doc.getElementById('adjPlanOptions').hidden);
  await click('#applyAdjust');
  go('week'); await wait(20);
  check('Applied: a generated plan from today on (next week has workouts)', workoutsIn(1)>=2, rows(1).join(' | '));
  check('...their own workout still there', rows(0).some(r=>/Push Day/.test(r)));
  check('...and the plan\'s weeks are back', /Build week|Deload week/i.test(text(doc.getElementById('weekList'))));
  go('home'); await wait(20);
  check('Today keeps the workout they made', /Push Day/.test(text(doc.querySelector('#sessionCard .title'))));

  // ---- and back off again, from Adjust ----
  go('adjust'); await wait(20);
  await click(adjToggle);
  await click('#applyAdjust');
  go('week'); await wait(20);
  check('Turning it on in Adjust clears the generated plan from the days ahead', workoutsIn(1)===0, rows(1).join(' | '));

  // ---- in Spanish ----
  go('settings'); await wait(10);
  doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
  go('adjust'); await wait(20);
  check('In Spanish', /Crear mis propios entrenamientos/.test(text(adjToggle.closest('.toggle-row'))));

  // ---- switching mid-plan keeps history (signed in: past days show the plan they had) ----
  {
    const profileUpdates = [];
    const db = { profiles: {u1: {id:'u1', full_name:'Sam', goal:'mix', level:'intermediate', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, plan_start:'2026-08-31'}}, workout_logs: {} };
    function from(table){
      let op = 'select', payload = null;
      const api = {
        select(){ return api; }, order(){ return api; }, in(){ return api; }, is(){ return api; }, gte(){ return api; }, lte(){ return api; }, limit(){ return api; }, eq(){ return api; },
        upsert(p){ op='upsert'; payload=p; return api; }, update(p){ op='update'; payload=p; return api; }, insert(p){ op='insert'; payload=p; return api; }, delete(){ op='noop'; return api; },
        maybeSingle(){ return run(true); }, single(){ return run(true); },
        then(res, rej){ return run(false).then(res, rej); },
      };
      async function run(single){
        if(op==='update' && table==='profiles'){ profileUpdates.push(payload); Object.assign(db.profiles.u1, payload); return {data:null, error:null}; }
        if(op!=='select') return {data: single ? {id:'x'+Math.random()} : [], error:null};
        const rows = Object.values(db[table] || {});
        return {data: single ? rows[0] || null : rows, error:null};
      }
      return api;
    }
    const user = {id:'u1', email:'sam@example.com'};
    const client = { auth: { async getSession(){ return {data:{session:{user}}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async signOut(){ return {}; } },
      from, functions: { async invoke(){ return {data:{connected:false}, error:null}; } } };
    const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/Altiro/', beforeParse(w){ w.supabase = { createClient: () => client }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
    const d2 = dom2.window.document;
    await wait(300);
    const go2 = id => [...d2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    const cell = key => (d2.querySelector(`.mo-cell[data-date="${key}"]`)?.textContent || '').replace(/\s+/g,' ').trim().replace(/^\d+/, '').trim();
    const cal = async () => { go2('calendar'); await wait(20); return {last: ['2026-09-07','2026-09-09','2026-09-11'].map(cell).join(' | '), mon: cell('2026-09-14'), next: ['2026-09-21','2026-09-23','2026-09-25'].map(cell).join(' | ')}; };
    const before = await cal();
    check('(set-up) a generated plan: workouts last week, this Monday and next week', !/^\s*\|/.test(before.last) && before.last.replace(/[|\s]/g,'') && before.mon && before.next.replace(/[|\s]/g,''), JSON.stringify(before));
    go2('adjust'); await wait(20);
    d2.getElementById('adjOwnToggle').click(); await wait(10);
    d2.getElementById('applyAdjust').click(); await wait(20);
    const own = await cal();
    check('Switched to their own workouts: earlier days keep the plan they had', own.last===before.last && own.mon===before.mon, JSON.stringify([before, own]));
    check('...and the days ahead are open', own.next.replace(/[|\s]/g,'')==='', own.next);
    const saved = profileUpdates.filter(u=>'own_since' in u).pop();
    check('...saved to the account, from today', saved && saved.own_since==='2026-09-18', JSON.stringify(saved));
    go2('adjust'); await wait(20);
    d2.getElementById('adjOwnToggle').click(); await wait(10);
    d2.getElementById('applyAdjust').click(); await wait(20);
    const back = await cal();
    check('Back to the plan: workouts ahead again', back.next.replace(/[|\s]/g,'')!=='', back.next);
    check('...saved off', profileUpdates.filter(u=>'own_since' in u).pop().own_since===null);
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
