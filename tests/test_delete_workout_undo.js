const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Every workout -- the plan's own, one the user created, an added or a logged one -- has a Delete
// workout button. Deleting is immediate, with Undo on the toast for a few seconds: Undo puts the day back
// exactly as it was, and nothing reaches the cloud until the Undo has run out.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const flat = el => el.textContent.replace(/\s+/g,' ').trim();
const UNDO_MS = 400;

(async () => {
  // ---- on the device ----
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; w.__ALTIRO_UNDO_MS__ = UNDO_MS; } });
    await wait(50);
    const doc = dom.window.document;
    const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    go('home');
    await wait(20);
    const title = flat(doc.querySelector('#sessionCard .title'));
    check('(set-up) today has a plan workout', !/Rest/.test(title), title);
    const del = doc.getElementById('deleteTodayWorkoutBtn');
    check('Home has a Delete workout button for today\'s workout', del && /Delete workout/.test(del.textContent));
    del.click();
    await wait(20);
    check('Delete is immediate: today is a rest day', /Rest Day/.test(flat(doc.querySelector('#sessionCard .title'))), flat(doc.querySelector('#sessionCard .title')));
    check('...no "are you sure" sheet', !doc.getElementById('confirmDeleteOverlay'));
    const toast = doc.getElementById('toast'), undo = doc.getElementById('toastUndo');
    check('...a toast names it, with Undo', !toast.hidden && !undo.hidden && flat(doc.getElementById('toastMsg')).includes('deleted') && flat(doc.getElementById('toastMsg')).includes(title.split(',')[0]), flat(toast));
    undo.click();
    await wait(20);
    check('Undo brings it back, exactly', flat(doc.querySelector('#sessionCard .title'))===title, flat(doc.querySelector('#sessionCard .title')));
    check('...and says so', /Workout restored/.test(flat(doc.getElementById('toastMsg'))) && undo.hidden);

    doc.getElementById('deleteTodayWorkoutBtn').click();
    await wait(UNDO_MS + 150);
    check('Without Undo, the toast goes after a few seconds and it stays deleted', toast.hidden && /Rest Day/.test(flat(doc.querySelector('#sessionCard .title'))));

    // A future day's workout, from its day details.
    go('calendar');
    await wait(20);
    doc.querySelector('#calGrid .mo-cell[data-date="2026-09-21"]').click();
    await wait(20);
    const before = flat(doc.getElementById('dayDetailPlanRow'));
    const ddDel = doc.getElementById('ddDeleteWorkoutBtn');
    check('A day\'s details have Delete workout too', !!ddDel && /Delete workout/.test(ddDel.textContent));
    ddDel.click();
    await wait(20);
    check('...the day becomes a rest day at once', flat(doc.getElementById('dayDetailPlanRow'))==='Rest Day', flat(doc.getElementById('dayDetailPlanRow')));
    doc.getElementById('toastUndo').click();
    await wait(20);
    check('...and Undo puts it back while the sheet is open', flat(doc.getElementById('dayDetailPlanRow'))===before, flat(doc.getElementById('dayDetailPlanRow')));
  }

  // ---- in the cloud ----
  {
    const deletes = [];
    const extra = {id:'pw1', user_id:'u1', log_date:'2026-09-18', session_type:'strength', title:'Arms', detail:'', exercises:null, completed:false};
    function from(table){
      let op = 'select';
      const api = {
        select(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; }, in(){ return api; },
        eq(col, val){ if(op==='delete') deletes.push(`${table}:${val}`); return api; },
        insert(){ op = 'insert'; return api; }, delete(){ op = 'delete'; return api; }, update(){ op = 'update'; return api; }, upsert(){ op = 'upsert'; return api; },
        maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', goal:'both', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, level:'beginner', equipment:'gym', plan_start:'2026-09-14', badges:{day_one:'2026-09-14'}} : null, error:null}); },
        then(res, rej){ return Promise.resolve({data: op==='select' ? (table==='planned_workouts' ? [extra] : []) : null, error:null}).then(res, rej); },
      };
      return api;
    }
    const client = { auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'a@b.c'}}}}; }, async signOut(){ return {error:null}; } }, from };
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(w){ w.supabase = { createClient: () => client }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; w.__ALTIRO_UNDO_MS__ = UNDO_MS; } });
    await wait(900);
    const doc = dom.window.document;
    if(!doc.getElementById('badgeOverlay').hidden) doc.getElementById('badgeDoneBtn').click();
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(30);
    const arms = () => [...doc.querySelectorAll('#homeExtraWorkoutsWrap [data-extra-id]')].find(r=> /Arms/.test(r.textContent));
    check('(set-up) the added workout is on Home', !!arms());
    arms().querySelector('[data-del-extra]').click();
    await wait(30);
    check('Deleting it: gone from the screen, not from the cloud yet', !arms() && !deletes.length, deletes.join());
    doc.getElementById('toastUndo').click();
    await wait(UNDO_MS + 150);
    check('Undo: back on screen, and the cloud never heard about it', !!arms() && !deletes.length, deletes.join());
    arms().querySelector('[data-del-extra]').click();
    await wait(UNDO_MS + 150);
    check('Without Undo: deleted from the cloud once the toast is gone', deletes.join()==='planned_workouts:pw1', deletes.join());
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
