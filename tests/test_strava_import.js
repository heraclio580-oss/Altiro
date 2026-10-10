const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Runs recorded on a watch reach the app through Strava: the `strava` Edge Function (faked here) pulls
// them into strava_activities, and the app files each one onto its day -- onto that day's planned run,
// or as a Logged Workout when nothing was planned -- skipping one already logged by hand, and never
// importing the same run twice.
function makeBackend(opts){
  const db = {
    profiles: {u1: {id:'u1'}},
    workout_logs: {},
    manual_entries: {},
    strava_activities: {},
  };
  const invokes = [];
  let connected = !!opts.connected;
  let nextId = 1;
  const newId = () => 'id' + (nextId++);
  const addLog = (log_date, fields) => { const id = newId(); db.workout_logs[id] = {id, user_id:'u1', log_date, completed_override:null, ...fields}; return id; };
  const addStrava = (id, local_date, name, distance_m, moving_time_s) => {
    db.strava_activities[id] = {id, user_id:'u1', name, local_date, start_date: local_date+'T12:00:00Z', distance_m, moving_time_s, applied_at:null};
  };
  function from(table){
    let filters = [], op = 'select', payload = null, wantRows = false;
    const matches = row => filters.every(([c,v,kind]) => kind==='is' ? row[c]==null : kind==='notnull' ? row[c]!=null : kind==='gte' ? row[c]>=v : row[c]===v);
    async function run(single){
      const rows = db[table];
      if(!rows) return {data: [], error:null}; // planned_workouts, progression_targets, personal_records, ...
      if(op==='insert'){
        const id = newId(); rows[id] = {id, ...payload};
        return {data: rows[id], error:null};
      }
      if(op==='update'){
        const hit = Object.values(rows).filter(matches);
        hit.forEach(r => Object.assign(r, payload));
        return {data: wantRows ? hit.map(r=>({id:r.id})) : null, error:null};
      }
      const hit = Object.values(rows).filter(matches);
      if(single) return {data: hit[0] || null, error:null};
      if(table==='workout_logs'){
        return {data: hit.map(r => ({...r, manual_entries: Object.values(db.manual_entries).filter(e=>e.workout_log_id===r.id)})), error:null};
      }
      return {data: hit, error:null};
    }
    const api = {
      select(){ wantRows = true; return api; },
      eq(c,v){ filters.push([c,v,'eq']); return api; },
      is(c){ filters.push([c,null,'is']); return api; },
      not(c){ filters.push([c,null,'notnull']); return api; },
      gte(c,v){ filters.push([c,v,'gte']); return api; },
      order(){ return api; },
      insert(p){ op='insert'; payload=p; return api; },
      update(p){ op='update'; payload=p; wantRows=false; return api; },
      upsert(){ op='noop'; return api; }, delete(){ op='noop'; return api; },
      maybeSingle(){ return run(true); },
      then(res, rej){ return run(false).then(res, rej); },
    };
    return api;
  }
  function createClient(){
    const user = {id:'u1', email:'runner@example.com'};
    return {
      auth: {
        async getSession(){ return {data:{session:{user}}}; },
        onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
        async signOut(){ return {error:null}; },
      },
      from,
      functions: {
        async invoke(name, {body}){
          invokes.push(body);
          if(opts.notDeployed){
            return {data:null, error:{message:'Edge Function returned a non-2xx status code', context:{status:404, json: async()=>({})}}};
          }
          if(body.action==='connect'){ connected = true; return {data:{connected:true, athlete_name:'Sam Runner', fetched:0}, error:null}; }
          if(body.action==='sync') return {data: connected ? {connected:true, athlete_name:'Sam Runner', fetched:0} : {connected:false}, error:null};
          if(body.action==='disconnect'){ connected = false; return {data:{connected:false}, error:null}; }
          if(body.action==='authorize_url') return {data:{url:'https://www.strava.com/oauth/authorize?x=1'}, error:null};
          return {data:null, error:{message:'?', context:{status:400, json: async()=>({error:'unknown_action'})}}};
        },
      },
    };
  }
  return { db, invokes, addLog, addStrava, createClient };
}
function openSession(backend, callbackSearch){
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/Altiro/',
    beforeParse(window){
      window.supabase = { createClient: () => backend.createClient() };
      window.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      // The app's "while open" Strava check runs every 2 minutes -- kept here to be run by hand.
      window.__stravaChecks = [];
      const realSetInterval = window.setInterval.bind(window);
      window.setInterval = (fn, ms, ...a) => { if(ms===120000){ window.__stravaChecks.push(fn); return 0; } return realSetInterval(fn, ms, ...a); };
      if(callbackSearch!=null) window.localStorage.setItem('altiro_strava_callback', JSON.stringify({search: callbackSearch, at: Date.now()}));
    },
  });
}
const text = (doc, id) => doc.getElementById(id).textContent;

(async () => {
  // ---- Already connected: runs waiting to be filed ----
  const backend = makeBackend({connected:true});
  // Today (Fri 18th): a planned 16 mile long run. Tuesday: 4.5 miles already logged by hand.
  backend.addLog('2026-09-18', {planned_type:'run', planned_title:'16 mile long run', planned_detail:'16 mi'});
  const tueId = backend.addLog('2026-09-15', {planned_type:'run', planned_title:'Tempo 4.5 miles', planned_detail:'4.5 mi', actual_run_distance:4.5});
  // Last Thursday: 2 miles logged by hand, with no Strava run that day.
  backend.addLog('2026-09-10', {planned_type:'run', planned_title:'Easy 2 miles', planned_detail:'2 mi', actual_run_distance:2});
  backend.db.manual_entries.e1 = {id:'e1', workout_log_id: tueId, name:'Tempo 4.5 miles', type:'run', volume:'4.5 mi', notes:'', distance:4.5, duration_min:36};
  backend.addStrava(101, '2026-09-18', 'Morning Run', 25782, 8400);    // 16.02 mi -> today's planned run
  backend.addStrava(102, '2026-09-15', 'Tempo', 7274, 2150);           // 4.52 mi -> same as Tuesday's hand-logged run
  backend.addStrava(103, '2026-09-13', 'Evening Shakeout', 4989, 1800); // 3.1 mi on a rest day

  const dom = openSession(backend, null);
  await wait(250);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  console.log('Signing in syncs with Strava:', backend.invokes.some(b=>b.action==='sync') ? 'OK' : `FAIL (${JSON.stringify(backend.invokes)})`);
  const s = backend.db.strava_activities;
  console.log('Every waiting run is marked filed:', [101,102,103].every(id=>s[id].applied_at) ? 'OK' : `FAIL (${[101,102,103].map(id=>s[id].applied_at)})`);
  console.log('Toast counts the two new runs (not the duplicate):', text(doc,'toastMsg')==='Imported 2 runs from Strava' ? 'OK' : `FAIL (${text(doc,'toastMsg')})`);

  const today = Object.values(backend.db.workout_logs).find(r=>r.log_date==='2026-09-18');
  console.log("Today's planned run gets the watch's distance:", today.actual_run_distance===16.02 ? 'OK' : `FAIL (${today.actual_run_distance})`);
  console.log("...and the watch's time, as its logged performance:", today.performance && today.performance.time===140 && today.performance.source==='strava' ? 'OK' : `FAIL (${JSON.stringify(today.performance)})`);
  // Runs this week (today's, Tuesday's) and last week (Sunday's shakeout): a 2-week streak.
  console.log("Today's run counts toward the streak:", backend.db.profiles.u1.streak===2 ? 'OK' : `FAIL (${backend.db.profiles.u1.streak})`);
  console.log('No extra Logged Workout is added for the planned run:', !Object.values(backend.db.manual_entries).some(e=>e.name==='Morning Run') ? 'OK' : 'FAIL');

  const tueEntries = Object.values(backend.db.manual_entries).filter(e=>e.workout_log_id===tueId);
  console.log("Tuesday's hand-logged run isn't duplicated:", tueEntries.length===1 ? 'OK' : `FAIL (${tueEntries.length})`);

  const shakeout = Object.values(backend.db.manual_entries).find(e=>e.name==='Evening Shakeout');
  console.log('A run on a rest day becomes a Logged Workout:', shakeout && shakeout.distance===3.1 && shakeout.volume==='3.1 mi · 30:00' ? 'OK' : `FAIL (${JSON.stringify(shakeout)})`);

  go('calendar');
  await wait(20);
  doc.querySelector('.mo-cell[data-date="2026-09-13"]').click();
  await wait(20);
  console.log("...and shows as that day's workout, not Rest Day:", text(doc,'dayDetailPlanRow').includes('Evening Shakeout') ? 'OK' : `FAIL (${text(doc,'dayDetailPlanRow')})`);
  const shakeoutRow = Object.values(backend.db.manual_entries).find(e=>e.name==='Evening Shakeout');
  console.log('...saved with its Strava id:', shakeoutRow.performance && shakeoutRow.performance.stravaId===103 ? 'OK' : `FAIL (${JSON.stringify(shakeoutRow.performance)})`);
  const shakeoutEntry = doc.querySelector('#dayDetailOverlay [data-entry-id]');
  if(shakeoutEntry){ shakeoutEntry.click(); await wait(20); }
  const shakeLink = doc.getElementById('logPerfStravaLink');
  console.log('...and opening it links back to that run on Strava:', !shakeLink.hidden && shakeLink.href==='https://www.strava.com/activities/103' ? 'OK' : `FAIL (${shakeLink.hidden} ${shakeLink.href})`);
  if(!doc.getElementById('logPerfOverlay').hidden) doc.getElementById('closeLogPerf').click();
  await wait(10);
  doc.getElementById('closeDayDetail').click();
  await wait(10);
  doc.querySelector('.mo-cell[data-date="2026-09-18"]').click();
  await wait(20);
  console.log("Today's plan keeps its own name:", text(doc,'dayDetailPlanRow').includes('16 mile long run') ? 'OK' : `FAIL (${text(doc,'dayDetailPlanRow')})`);
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  const viewLink = doc.getElementById('logPerfStravaLink');
  console.log('The imported run links back to it on Strava:', !viewLink.hidden && viewLink.textContent==='View on Strava' && viewLink.href==='https://www.strava.com/activities/101' ? 'OK' : `FAIL (${viewLink.hidden} ${viewLink.href})`);
  doc.getElementById('closeLogPerf').click();
  await wait(10);
  doc.getElementById('closeDayDetail').click();
  await wait(10);
  // A run logged by hand, with no Strava run to match, has no "View on Strava" -- the link is really
  // hidden, not just marked hidden.
  doc.querySelector('.mo-cell[data-date="2026-09-10"]').click();
  await wait(20);
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  const handLink = doc.getElementById('logPerfStravaLink');
  console.log('A hand-logged run with no Strava match shows no "View on Strava":', !doc.getElementById('logPerfOverlay').hidden && handLink.hidden && dom.window.getComputedStyle(handLink).display==='none' ? 'OK' : `FAIL (${handLink.hidden} ${dom.window.getComputedStyle(handLink).display})`);
  doc.getElementById('closeLogPerf').click();
  await wait(10);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  go('home');
  await wait(20);
  // The week's planned miles include its earlier runs, done or not (one of them wasn't).
  console.log("Home's distance card includes the imported run:", text(doc,'ovDistanceVal')==='20.5/23.5 mi' ? 'OK' : `FAIL (${text(doc,'ovDistanceVal')})`);
  console.log("Today's Record button shows done:", doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : `FAIL (${doc.getElementById('recordBtn').className})`);

  go('settings');
  await wait(20);
  console.log('Settings shows the connection:', text(doc,'stravaStatusText')==='Connected as Sam Runner · runs import automatically' ? 'OK' : `FAIL (${text(doc,'stravaStatusText')})`);
  console.log('...with Sync now and Disconnect (no Connect button):', text(doc,'stravaSyncBtn')==='Sync now' && !doc.getElementById('stravaSyncBtn').hidden && doc.getElementById('stravaConnectBtn').hidden && !doc.getElementById('stravaDisconnectBtn').hidden ? 'OK' : `FAIL (${text(doc,'stravaSyncBtn')})`);
  console.log('...a "Powered by Strava" logo:', /Powered by/.test(doc.querySelector('.strava-powered').textContent) || doc.querySelector('.strava-powered img[alt="Powered by Strava"]') ? 'OK' : 'FAIL');
  console.log('...and a link to how Altiro uses Strava data:', (doc.querySelector('a[href="privacy.html#strava"]')||{}).textContent==='How Altiro uses your Strava data' ? 'OK' : 'FAIL');

  // A second run today arrives later -- it's a separate run, so it's added alongside.
  backend.addStrava(105, '2026-09-18', 'Evening Run', 4828, 1500); // 3.0 mi
  backend.db.strava_activities[105].start_date = '2026-09-18T23:30:00Z'; // in the evening, hours after the morning's run
  doc.getElementById('stravaSyncBtn').click();
  await wait(80);
  console.log('Sync now files the new run:', text(doc,'toastMsg')==='From Strava: Evening Run · 3.0 mi' ? 'OK' : `FAIL (${text(doc,'toastMsg')})`);
  const eveningRuns = Object.values(backend.db.manual_entries).filter(e=>e.name==='Evening Run');
  console.log('...as its own Logged Workout today:', eveningRuns.length===1 && eveningRuns[0].distance===3 ? 'OK' : `FAIL (${JSON.stringify(eveningRuns)})`);
  go('home');
  await wait(20);
  console.log("...counted on Home's distance card:", text(doc,'ovDistanceVal')==='23.5/26.5 mi' ? 'OK' : `FAIL (${text(doc,'ovDistanceVal')})`);
  const todayAfter = Object.values(backend.db.workout_logs).find(r=>r.log_date==='2026-09-18');
  console.log("...without touching today's planned run:", todayAfter.planned_title==='16 mile long run' && todayAfter.actual_run_distance===16.02 ? 'OK' : `FAIL (${todayAfter.planned_title}, ${todayAfter.actual_run_distance})`);

  go('settings');
  await wait(20);
  doc.getElementById('stravaSyncBtn').click();
  await wait(80);
  console.log('Syncing again imports nothing twice:', text(doc,'toastMsg')==='Already up to date' && Object.values(backend.db.manual_entries).filter(e=>e.name==='Evening Run').length===1 ? 'OK' : `FAIL (${text(doc,'toastMsg')})`);

  // ---- While the app is open, a run Strava sends (its webhook stores it) is filed within 2 minutes ----
  go('home'); await wait(20);
  backend.addStrava(106, '2026-09-17', 'Thursday Jog', 6437, 2100); // 4.0 mi, stored by the webhook
  const checks = dom.window.__stravaChecks;
  console.log('The app checks for new runs every 2 minutes while it\'s open:', checks.length===1 ? 'OK' : `FAIL (${checks.length})`);
  const invokesBefore = backend.invokes.length;
  checks[0](); await wait(80);
  console.log('...and files a run Strava already sent, without asking Strava again:', text(doc,'toastMsg')==='From Strava: Thursday Jog · 4.0 mi' && backend.invokes.length===invokesBefore ? 'OK' : `FAIL (${text(doc,'toastMsg')}, ${backend.invokes.length-invokesBefore} calls)`);

  go('settings'); await wait(20);
  doc.getElementById('stravaDisconnectBtn').click();
  await wait(40);
  console.log('Disconnect goes back to the Connect with Strava button:', !doc.getElementById('stravaConnectBtn').hidden && /Connect with Strava/.test(doc.getElementById('stravaConnectBtn').textContent + (doc.querySelector('#stravaConnectBtn img')||{}).alt) && doc.getElementById('stravaSyncBtn').hidden && doc.getElementById('stravaDisconnectBtn').hidden ? 'OK' : 'FAIL');

  // ---- Coming back from Strava's Authorize page ----
  const b2 = makeBackend({connected:false});
  const dom2 = openSession(b2, '?state=&code=abc123&scope=read,activity:read_all');
  await wait(250);
  const doc2 = dom2.window.document;
  const connectCall = b2.invokes.find(b=>b.action==='connect');
  console.log('Returning from Strava finishes the connection with its code:', connectCall && connectCall.code==='abc123' && connectCall.scope==='read,activity:read_all' ? 'OK' : `FAIL (${JSON.stringify(b2.invokes)})`);
  console.log('...opens Settings showing it connected:', !doc2.getElementById('screen-settings').hidden && text(doc2,'stravaStatusText').startsWith('Connected as Sam Runner') ? 'OK' : `FAIL (${text(doc2,'stravaStatusText')})`);
  console.log('...and says so:', text(doc2,'toastMsg')==='Strava connected' ? 'OK' : `FAIL (${text(doc2,'toastMsg')})`);
  console.log('The hand-off is used up:', dom2.window.localStorage.getItem('altiro_strava_callback')===null ? 'OK' : 'FAIL');

  // ---- Cancelling on Strava's Authorize page ----
  const b3 = makeBackend({connected:false});
  const dom3 = openSession(b3, '?state=&error=access_denied');
  await wait(250);
  console.log('Cancelling on Strava connects nothing:', !b3.invokes.some(b=>b.action==='connect') && text(dom3.window.document,'toastMsg')==='Strava connection cancelled' ? 'OK' : `FAIL (${JSON.stringify(b3.invokes)})`);

  // ---- Function not deployed yet ----
  const b4 = makeBackend({notDeployed:true});
  const dom4 = openSession(b4, null);
  await wait(250);
  const doc4 = dom4.window.document;
  [...doc4.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click();
  await wait(20);
  console.log('Settings says when Strava isn\'t set up on the server yet:', text(doc4,'stravaStatusText')==="Strava isn't set up on the server yet" ? 'OK' : `FAIL (${text(doc4,'stravaStatusText')})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
