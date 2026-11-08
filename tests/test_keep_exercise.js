const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// An exercise added to one of the user's own workouts can be kept in the upcoming ones of the same name,
// in one tap -- without clearing and repeating weeks:
// - added while doing it (or with Change exercises): "Also add Champagnes to your next 3 'Back and chest'
//   workouts?" -- Add to all 3 / Just this one. Only adds: a change made to one of them stays, other
//   workouts aren't touched, and it isn't added twice.
// - Repeat week onto weeks that already have the same workout: they keep their changes and get just the
//   exercises they're missing (they used to be skipped).
// - The Repeat note says "1 workout a week" (not "1 workouts").
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const ex = (name, sets)=> ({key:name, name, sets: sets||3, reps:10});
const own = (id, date, title, exercises)=> ({id, user_id:'u1', log_date:date, completed_override:null, planned_type:'strength', planned_title:title, planned_detail:'', planned_exercises:exercises, manual_entries:[]});
function rows(){
  return [
    own('r08', '2026-11-08', 'Back and chest', [ex('Pull ups', 6), ex('Seated Row')]),
    own('r15', '2026-11-15', 'Back and chest', [ex('Pull ups', 6), ex('Seated Row')]),
    own('r16', '2026-11-16', 'Arm workout', [ex('Curls')]),
    own('r22', '2026-11-22', 'Back and chest', [ex('Pull ups', 6), ex('Face Pull'), ex('Seated Row')]), // changed by the user
    own('r29', '2026-11-29', 'Back and chest', [ex('Pull ups', 6), ex('Seated Row')]),
  ];
}
function makeBackend(logs){
  const sent = [];
  function from(table){
    let op = 'select', payload = null;
    const filters = {};
    const api = {
      select(){ return api; }, eq(c, v){ filters[c] = v; return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; }, in(){ return api; }, limit(){ return api; },
      insert(p){ op = 'insert'; payload = p; return api; }, delete(){ op = 'delete'; return api; }, update(p){ op = 'update'; payload = p; return api; }, upsert(p){ op = 'upsert'; payload = p; return api; },
      single(){ return api.maybeSingle(); },
      maybeSingle(){
        if(table==='workout_logs'){
          const d = filters.log_date || (payload && payload.log_date);
          let row = logs.find(r=> r.log_date===d);
          if(!row && op!=='select' && d){ row = {id:'new-'+d, user_id:'u1', log_date:d, manual_entries:[]}; logs.push(row); }
          return Promise.resolve({data: row || null, error:null});
        }
        return Promise.resolve({data: table==='profiles' ? {id:'u1', goal:'strength', training_days:[0,2,4], focus_ratio:4, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-10-05'} : null, error:null});
      },
      then(res, rej){
        if(op==='update' && table==='workout_logs' && payload){
          const row = logs.find(r=> r.id===filters.id);
          if(row){ Object.assign(row, payload); sent.push({date: row.log_date, payload}); }
        }
        const data = op!=='select' ? null : table==='workout_logs' ? logs : [];
        return Promise.resolve({data, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { sent, createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}
async function openApp(logs, lang){
  const backend = makeBackend(logs);
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-11-08'; if(lang) w.localStorage.setItem('altiro_lang', lang); } });
  await wait(300);
  const w = dom.window, doc = w.document;
  for(const id of ['badgeOverlay', 'locPromptOverlay']) doc.getElementById(id).hidden = true;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  return {w, doc, go, backend};
}
const names = (logs, date)=> (logs.find(r=> r.log_date===date).planned_exercises || []).map(e=> e.name).join(', ');
async function addLive(w, doc, name){
  const input = doc.getElementById('logPerfAddExerciseInput');
  input.value = name;
  doc.getElementById('logPerfAddExerciseBtn').click();
  await wait(30);
}

(async () => {
  // 1) Added while doing today's "Back and chest": kept in the next three, in one tap.
  {
    const logs = rows();
    const {w, doc, go} = await openApp(logs);
    go('home');
    await wait(20);
    doc.getElementById('recordBtn').click();
    await wait(950);
    await addLive(w, doc, 'Champagnes');
    const box = doc.getElementById('logPerfKeepEx');
    check('Added while doing it: it asks about the next ones', !box.hidden && /Also add Champagnes to your next 3 “Back and chest” workouts\?/.test(box.textContent), box.hidden ? '(hidden)' : box.textContent.trim());
    check('...two buttons: Add to all 3 / Just this one', !!box.querySelector('[data-keep-all]') && /Add to all 3/.test(box.querySelector('[data-keep-all]').textContent) && /Just this one/.test(box.querySelector('[data-keep-just]').textContent));
    check('...today\'s workout has it', /Champagnes/.test(names(logs, '2026-11-08')), names(logs, '2026-11-08'));
    box.querySelector('[data-keep-all]').click();
    await wait(60);
    check('Add to all 3: Nov 15 has it, after Seated Row', names(logs, '2026-11-15')==='Pull ups, Seated Row, Champagnes', names(logs, '2026-11-15'));
    check('...Nov 22 has it and keeps the Face Pull added there', names(logs, '2026-11-22')==='Pull ups, Face Pull, Seated Row, Champagnes', names(logs, '2026-11-22'));
    check('...Nov 29 has it', /Champagnes/.test(names(logs, '2026-11-29')), names(logs, '2026-11-29'));
    check('...the Arm workout isn\'t touched', names(logs, '2026-11-16')==='Curls', names(logs, '2026-11-16'));
    check('...and the question goes away', box.hidden);
    const toast = (doc.getElementById('toast') || doc.querySelector('.toast') || {textContent:''}).textContent;
    check('...with a note saying so', /Champagnes added to your next 3 “Back and chest” workouts/.test(toast), toast);
    // Added again (another exercise): asked again; this time just this one.
    await addLive(w, doc, 'Dips');
    check('Another one: asked again', !box.hidden && /Dips/.test(box.textContent));
    box.querySelector('[data-keep-just]').click();
    await wait(30);
    check('Just this one: the next ones don\'t get it', !/Dips/.test(names(logs, '2026-11-15')) && /Dips/.test(names(logs, '2026-11-08')), names(logs, '2026-11-15'));
    w.close();
  }

  // 1b) Added with Change exercises, before starting it.
  {
    const logs = rows();
    const {w, doc, go} = await openApp(logs);
    go('home');
    await wait(20);
    doc.getElementById('changeExercisesBtn').click();
    await wait(30);
    doc.getElementById('wpAddExerciseInput').value = 'Champagnes';
    doc.getElementById('wpAddExerciseBtn').click();
    await wait(30);
    const box = doc.getElementById('wpKeepEx');
    check('Change exercises: asked the same', !box.hidden && /next 3 “Back and chest” workouts/.test(box.textContent), box.hidden ? '(hidden)' : box.textContent.trim());
    box.querySelector('[data-keep-all]').click();
    await wait(60);
    check('...and added to them', ['2026-11-15', '2026-11-22', '2026-11-29'].every(d=> /Champagnes/.test(names(logs, d))) && /Champagnes/.test(names(logs, '2026-11-08')), names(logs, '2026-11-15'));
    w.close();
  }

  // 2) No upcoming workout of that name: nothing asked.
  {
    const logs = rows().filter(r=> !['2026-11-15', '2026-11-22', '2026-11-29'].includes(r.log_date));
    const {w, doc, go} = await openApp(logs);
    go('home');
    await wait(20);
    doc.getElementById('recordBtn').click();
    await wait(950);
    await addLive(w, doc, 'Champagnes');
    check('No upcoming "Back and chest": nothing asked', doc.getElementById('logPerfKeepEx').hidden);
    w.close();
  }

  // 3) Repeat week onto weeks that already have it: they get what they're missing, and keep their changes.
  {
    const logs = rows();
    logs[0].planned_exercises = [ex('Pull ups', 6), ex('Seated Row'), ex('Champagnes')];
    const {doc, go} = await openApp(logs);
    go('week');
    await wait(30);
    doc.querySelector('[data-repeat-week="0"]').click();
    await wait(20);
    const note = doc.getElementById('repeatNote').textContent;
    check('Repeat note: "1 workout a week" (not "1 workouts")', /^1 workout a week, copied into/.test(note), note);
    check('...and it says a workout already there keeps its changes', /keeps your changes and just gets any exercises it's missing/.test(note), note);
    const four = [...doc.querySelectorAll('#repeatSpanChips .chip')].find(c=> /Next 4 weeks/.test(c.textContent));
    if(four) four.click();
    await wait(10);
    doc.getElementById('applyRepeatBtn').click();
    await wait(60);
    check('Repeated: Nov 15 gets Champagnes', names(logs, '2026-11-15')==='Pull ups, Seated Row, Champagnes', names(logs, '2026-11-15'));
    check('...Nov 22 too, keeping its Face Pull', names(logs, '2026-11-22')==='Pull ups, Face Pull, Seated Row, Champagnes', names(logs, '2026-11-22'));
    check('...and Dec 6 (nothing there yet) gets the whole workout', names(logs, '2026-12-06')==='Pull ups, Seated Row, Champagnes', logs.find(r=> r.log_date==='2026-12-06') ? names(logs, '2026-12-06') : '(none)');
    check('...nothing doubled', !/Champagnes.*Champagnes/.test(names(logs, '2026-11-29')), names(logs, '2026-11-29'));
  }

  // 4) In Spanish.
  {
    const logs = rows();
    const {w, doc, go} = await openApp(logs, 'es');
    go('home');
    await wait(20);
    doc.getElementById('recordBtn').click();
    await wait(950);
    await addLive(w, doc, 'Champagnes');
    const box = doc.getElementById('logPerfKeepEx');
    check('In Spanish: "¿Añadir también Champagnes a tus próximos 3 entrenamientos «Back and chest»?"', /¿Añadir también Champagnes a tus próximos 3 entrenamientos «Back and chest»\?/.test(box.textContent) && /Añadir a los 3/.test(box.textContent) && /Solo este/.test(box.textContent), box.textContent.trim());
    w.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
