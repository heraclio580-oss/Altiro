const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A workout started stays under way until it's saved or discarded: closing its sheet (the X, the back
// gesture) or the app closing doesn't lose it. Today's button says Resume with its clock, opening the
// app again opens it straight away as it was left, and it can be discarded on purpose (asked first).
// Android's back gesture closes sheets, goes back to Today, and on Today sends the app to the background.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// A signed-in user with today's planned "Upper" workout, and an "Arms" workout added today.
function makeBackend(){
  const upper = [{key:'Bench Press', name:'Bench Press', sets:3, reps:8}, {key:'Seated Row', name:'Seated Row', sets:3, reps:10}];
  const logRows = [{id:'l1', user_id:'u1', log_date:'2026-09-18', completed_override:null, planned_type:'strength', planned_title:'Upper', planned_detail:'45 min', planned_exercises:upper, manual_entries:[]}];
  const extraRows = [{id:77, user_id:'u1', log_date:'2026-09-18', session_type:'strength', title:'Arms', detail:'30 min', exercises:[{key:'Hammer Curl', name:'Hammer Curl', sets:2, reps:12}], completed:false}];
  function from(table){
    let op = 'select';
    const filters = {};
    const api = {
      select(){ return api; }, eq(c, v){ filters[c] = v; return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, in(){ return api; }, limit(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ op = 'delete'; return api; }, update(){ op = 'update'; return api; }, upsert(){ op = 'upsert'; return api; }, single(){ return api.maybeSingle(); },
      maybeSingle(){
        if(table==='workout_logs') return Promise.resolve({data: logRows.find(r=>r.log_date===filters.log_date) || null, error:null});
        return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:4, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-09-07'} : null, error:null});
      },
      then(res, rej){
        const data = op!=='select' ? null : table==='workout_logs' ? logRows : table==='planned_workouts' ? extraRows : [];
        return Promise.resolve({data, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}
// The app opened (again): signed in, with whatever this phone had kept.
let back = null, minimized = 0;
async function openApp(kept, lang){
  const backend = makeBackend();
  back = null;
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){
      w.supabase = { createClient: () => backend.createClient() };
      w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      Object.entries(kept || {}).forEach(([k, v])=> w.localStorage.setItem(k, v));
      if(lang) w.localStorage.setItem('altiro_lang', lang);
      // (The store app's App plugin: the back gesture's listener, and sending the app to the background.)
      w.Capacitor = {isNativePlatform: ()=> false, Plugins: {App: {addListener(name, fn){ if(name==='backButton') back = fn; return Promise.resolve({remove(){}}); }, minimizeApp(){ minimized++; return Promise.resolve(); }}}};
    } });
  await wait(300);
  const w = dom.window, doc = w.document;
  const list = () => doc.getElementById('logPerfExercisesList');
  return {
    w, doc,
    sheetOpen: () => !doc.getElementById('logPerfOverlay').hidden,
    keys: () => [...list().querySelectorAll('.exercise-log-row')].map(r=> r.getAttribute('data-exercise-key')),
    row: key => [...list().querySelectorAll('.exercise-log-row')].find(r=> r.getAttribute('data-exercise-key')===key),
    label: () => doc.getElementById('recordLabel').textContent.replace(/\s+/g, ' ').trim(),
    kept: () => { const o = {}; for(let i=0; i<w.localStorage.length; i++){ const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; },
  };
}
const typeWeight = (app, key, v) => { const i = app.row(key).querySelector('[data-field="weight"]'); i.value = v; i.dispatchEvent(new app.w.Event('input', {bubbles:true})); };
const weightOf = (app, key) => app.row(key) ? app.row(key).querySelector('[data-field="weight"]').value : null;

(async () => {
  // ---- Started, then closed with the X ----
  let app = await openApp();
  check('Opening the app with nothing under way: Today, as usual', !app.sheetOpen() && /Start Workout/.test(app.label()), app.label());
  app.doc.getElementById('recordBtn').click();
  await wait(950);
  check('Start Workout opens today\'s workout', app.sheetOpen() && app.keys().join()==='Bench Press,Seated Row', app.keys().join());
  check('...with a Discard link at the bottom', !app.doc.getElementById('discardWorkout').hidden && /Discard this workout/.test(app.doc.getElementById('discardWorkoutBtn').textContent));
  typeWeight(app, 'Bench Press', '135');
  app.row('Bench Press').querySelector('.set-check-dot').click();
  await wait(20);
  app.doc.getElementById('closeLogPerf').click();
  await wait(20);
  check('Closed with the X: Today\'s button says Resume workout, with its clock', /^Resume workout · \d+:\d\d$/.test(app.label()), app.label());
  check('...and the hero isn\'t shown as done', !app.doc.getElementById('todayHero').classList.contains('done'));
  app.doc.getElementById('recordBtn').click();
  await wait(300);
  check('Resume opens it again as it was left', app.sheetOpen() && weightOf(app, 'Bench Press')==='135' && app.row('Bench Press').querySelector('.set-check-dot').classList.contains('checked'), weightOf(app, 'Bench Press'));

  // ---- The app closed mid-workout (the phone cleared it, or it was swiped away) ----
  const kept = app.kept();
  app.w.close();
  app = await openApp(kept);
  check('Opened again: the workout under way opens straight away', app.sheetOpen() && app.keys().join()==='Bench Press,Seated Row', app.keys().join());
  check('...with what was typed and ticked', weightOf(app, 'Bench Press')==='135' && app.row('Bench Press').querySelector('.set-check-dot').classList.contains('checked'));
  check('...and its clock still counting from when it started', JSON.parse(app.kept().altiro_workout_start).at===JSON.parse(kept.altiro_workout_start).at);

  // ---- Discard: asked first ----
  app.doc.getElementById('discardWorkoutBtn').click();
  check('Discard asks first', !app.doc.getElementById('discardWorkoutAsk').hidden && /Nothing is saved/.test(app.doc.getElementById('discardWorkoutAsk').textContent));
  app.doc.getElementById('discardWorkoutNo').click();
  check('Keep going: nothing changes', app.sheetOpen() && app.doc.getElementById('discardWorkoutAsk').hidden && weightOf(app, 'Bench Press')==='135');
  app.doc.getElementById('discardWorkoutBtn').click();
  app.doc.getElementById('discardWorkoutYes').click();
  await wait(30);
  check('Discarded: the sheet closes, with a message', !app.sheetOpen() && /Workout discarded/.test(app.doc.getElementById('toast') ? app.doc.getElementById('toast').textContent : app.doc.body.textContent));
  check('...Today says Start Workout again', /Start Workout/.test(app.label()), app.label());
  check('...and what was typed and its clock are gone', !app.kept().altiro_workout_start && !app.kept().altiro_log_draft, Object.keys(app.kept()).join());
  app.doc.getElementById('recordBtn').click();
  await wait(950);
  check('Starting it again starts fresh', app.sheetOpen() && weightOf(app, 'Bench Press')!=='135', weightOf(app, 'Bench Press'));

  // ---- Saved: it's over ----
  app.doc.getElementById('saveLogPerf').click();
  await wait(80);
  check('Saved: nothing under way any more', !app.kept().altiro_workout_start, app.kept().altiro_workout_start);
  const kept2 = app.kept();
  app.w.close();
  app = await openApp(kept2);
  check('...so opening the app again doesn\'t open it', !app.sheetOpen());

  // ---- A workout added today, under way when the app closed (it has a new id once loaded again) ----
  app.w.close();
  const start = Date.now() - 12*60000;
  app = await openApp({
    altiro_workout_start: JSON.stringify({key:'2026-09-18|extra|w1700000000abcde', at: start, sid: 77}),
    altiro_log_draft: JSON.stringify({target:'2026-09-18|extra|w1700000000abcde', ex:{'Hammer Curl':{sets:[{weight:'30', reps:'12'}, {weight:'', reps:''}], done:[true, false]}}, order:['Hammer Curl']}),
  });
  check('An added workout under way reopens too', app.sheetOpen() && app.keys().join()==='Hammer Curl', app.keys().join());
  check('...with what was typed in it', weightOf(app, 'Hammer Curl')==='30', weightOf(app, 'Hammer Curl'));
  app.doc.getElementById('closeLogPerf').click();
  await wait(20);
  check('...and Resume shows its 12 minutes so far', /^Resume workout · 12:\d\d$/.test(app.label()), app.label());

  // ---- Older than the clock's limit: let go ----
  app.w.close();
  app = await openApp({altiro_workout_start: JSON.stringify({key:'2026-09-18|primary|', at: Date.now() - 6*3600000})});
  check('A workout started over 5 hours ago doesn\'t come back', !app.sheetOpen() && /Start Workout/.test(app.label()), app.label());

  // ---- Android's back gesture ----
  check('The back gesture is handled by the app', typeof back==='function');
  app.doc.getElementById('recordBtn').click();
  await wait(950);
  // (A badge popped up on top: back closes that first.)
  const badge = app.doc.getElementById('badgeOverlay');
  if(!badge.hidden){ back(); await wait(20); check('Back closes what\'s on top first (a badge)', badge.hidden && app.sheetOpen() && minimized===0); }
  back();
  await wait(20);
  check('Back with a workout open: its sheet closes, the workout stays under way', !app.sheetOpen() && /^Resume workout/.test(app.label()) && minimized===0, app.label());
  back();
  check('Back on Today: the app goes to the background (it isn\'t closed)', minimized===1);
  [...app.doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'week').click();
  await wait(20);
  back();
  await wait(20);
  check('Back on another tab: goes to Today', !app.doc.getElementById('screen-home').hidden && minimized===1);
  app.doc.getElementById('recordBtn').click();
  await wait(300);
  app.doc.getElementById('discardWorkoutBtn').click();
  back();
  await wait(20);
  check('Back with Discard being asked: the sheet closes, nothing is discarded', !app.sheetOpen() && /^Resume workout/.test(app.label()), app.label());

  // ---- In Spanish ----
  app.w.close();
  app = await openApp({altiro_workout_start: JSON.stringify({key:'2026-09-18|primary|', at: Date.now() - 3*60000})}, 'es');
  check('In Spanish: it reopens, with Descartar', app.sheetOpen() && /Descartar este entrenamiento/.test(app.doc.getElementById('discardWorkoutBtn').textContent), app.doc.getElementById('discardWorkoutBtn').textContent);
  app.doc.getElementById('closeLogPerf').click();
  await wait(20);
  check('...and Continuar entrenamiento on Today', /^Continuar entrenamiento · 3:\d\d$/.test(app.label()), app.label());

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
