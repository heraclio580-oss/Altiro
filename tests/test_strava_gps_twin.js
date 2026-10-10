const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// One run, recorded twice -- tracked with GPS in Altiro while a watch recorded it too, and the watch's
// copy coming in through Strava. The phone and the watch rarely agree on the distance (3.62 vs 4.03 mi
// on a real run), so it's the time that says they're the same run: it counts once, whichever arrives
// first. A second run at another time that day is still its own run.
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
      if(op==='delete'){ Object.values(rows).filter(matches).forEach(r=> delete rows[r.id]); return {data:null, error:null}; }
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
      upsert(){ op='noop'; return api; }, delete(){ op='delete'; return api; },
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

const T0 = new Date(2026, 8, 18, 8, 0).getTime(); // today (Fri 18th), 8:00
(async () => {
  // ---- Tracked with GPS first; the watch's copy comes in from Strava afterwards ----
  {
    const backend = makeBackend({connected:true});
    backend.addLog('2026-09-18', {planned_type:'run', planned_title:'4.5 mile easy run', planned_detail:'4.5 mi', completed_override:true, actual_run_distance:3.62,
      performance:{distance:3.62, time:45, source:'gps', route:['_p~iF~ps|U_ulLnnqC'], startedAt:T0, finishedAt:T0+45*60000}});
    backend.addStrava(201, '2026-09-18', 'Morning Run', 6486, 2690);          // 4.03 mi, the same 45 minutes
    backend.db.strava_activities[201].start_date = new Date(T0+40000).toISOString();
    backend.db.strava_activities[201].elapsed_time_s = 2699;
    backend.addStrava(202, '2026-09-18', 'Evening Run', 6437, 2400);          // 4.0 mi, at 6 pm: another run
    backend.db.strava_activities[202].start_date = new Date(T0+10*3600000).toISOString();
    backend.db.strava_activities[202].elapsed_time_s = 2400;
    const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
      beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; }});
    await wait(300);
    const entries = Object.values(backend.db.manual_entries);
    check('The watch\'s copy of the GPS run is not added again, though it measured 4.03 mi to the phone\'s 3.62', !entries.some(e=> e.name==='Morning Run'), JSON.stringify(entries.map(e=>e.name)));
    check('...while a run at another time that day still comes in', entries.some(e=> e.name==='Evening Run'), JSON.stringify(entries.map(e=>e.name)));
    check('Both are marked filed', backend.db.strava_activities[201].applied_at && backend.db.strava_activities[202].applied_at);
    const day = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-18');
    check('The GPS run takes the watch\'s distance: 4.03 mi', day.actual_run_distance===4.03, day.actual_run_distance);
    dom.window.close();
  }

  // ---- The watch's copy came in first; then the GPS run is saved ----
  {
    const backend = makeBackend({connected:true});
    const logId = backend.addLog('2026-09-18', {planned_type:'run', planned_title:'4.5 mile easy run', planned_detail:'4.5 mi'});
    backend.db.manual_entries.e9 = {id:'e9', workout_log_id: logId, name:'Morning Run', type:'run', volume:'4.03 mi', notes:'', distance:4.03, duration_min:44.98,
      performance:{distance:4.03, time:44.98, source:'strava', stravaId:301, startedAt:T0, finishedAt:T0+2699000}};
    backend.db.manual_entries.e8 = {id:'e8', workout_log_id: logId, name:'Lunch Run', type:'run', volume:'2 mi', notes:'', distance:2, duration_min:18,
      performance:{distance:2, time:18, source:'strava', stravaId:302, startedAt:T0+4*3600000, finishedAt:T0+4*3600000+18*60000}};
    const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
      beforeParse(w){
        w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
        // A GPS run just finished on today's planned run, waiting to be saved.
        w.localStorage.setItem('altiro_gps_done', JSON.stringify({target:{dayKey:'2026-09-18', kind:'primary', id:null},
          result:{distance:3.62, time:45, route:['_p~iF~ps|U_ulLnnqC'], splits:[], splitUnit:'mi', startedAt:T0+20000, finishedAt:T0+20000+45*60000}}));
      }});
    await wait(300);
    const doc = dom.window.document;
    doc.getElementById('recordBtn').click();
    await wait(1000);
    check('(set-up) Log Performance has the GPS run', !doc.getElementById('logPerfOverlay').hidden && doc.getElementById('logPerfDistanceInput').value==='3.62', doc.getElementById('logPerfDistanceInput').value);
    doc.getElementById('saveLogPerf').click();
    await wait(300);
    check('Saving the GPS run removes the watch\'s copy of it, so it counts once', !backend.db.manual_entries.e9, JSON.stringify(Object.keys(backend.db.manual_entries)));
    check('...but not the other run that day', !!backend.db.manual_entries.e8);
    const day = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-18');
    check('...and the run keeps the watch\'s distance: 4.03 mi', day.actual_run_distance===4.03, day.actual_run_distance);
    check('...saying so', /watch recorded this run too: using its 4\.03 mi/.test(doc.getElementById('toastMsg').textContent), doc.getElementById('toastMsg').textContent);
    dom.window.close();
  }
  // ---- Already counted twice (from before runs kept their start time): merged on the next sign-in ----
  {
    const backend = makeBackend({connected:true});
    const logId = backend.addLog('2026-09-18', {planned_type:'run', planned_title:'4.5 mile easy run', planned_detail:'4.5 mi', completed_override:true, actual_run_distance:3.62,
      performance:{distance:3.62, time:45, source:'gps', route:['_p~iF~ps|U_ulLnnqC'], splits:[700, 690, 680]}});
    backend.db.manual_entries.e7 = {id:'e7', workout_log_id: logId, name:'Morning Run', type:'run', volume:'4.03 mi · 44:59', notes:'', distance:4.03, duration_min:44.98,
      performance:{distance:4.03, time:44.98, source:'strava', stravaId:401}};
    backend.db.manual_entries.e6 = {id:'e6', workout_log_id: logId, name:'Afternoon Run', type:'run', volume:'3 mi · 27:00', notes:'', distance:3, duration_min:27,
      performance:{distance:3, time:27, source:'strava', stravaId:402}};
    const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
      beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; }});
    await wait(300);
    const day = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-09-18');
    check('A GPS run and its watch copy (same day, same 45 minutes) are merged: the copy goes', !backend.db.manual_entries.e7, JSON.stringify(Object.keys(backend.db.manual_entries)));
    check('...and the GPS run now has the watch\'s 4.03 mi', day.actual_run_distance===4.03, day.actual_run_distance);
    check('...while a different run that day (27 minutes) stays', !!backend.db.manual_entries.e6);
    dom.window.close();
  }
  // ---- The Today card: one completed run, one card ----
  {
    // A rest day where the only workout is an added run, done (tracked, then matched with the watch).
    const backend = makeBackend({connected:false});
    backend.addLog('2026-09-18', {planned_type:'rest', planned_title:'Rest Day', planned_detail:''});
    backend.db.planned_workouts = {pw1: {id:'pw1', user_id:'u1', log_date:'2026-09-18', session_type:'run', title:'4.5 mile easy run', detail:'4.5 mi',
      completed:true, actual_distance:4.03, performance:{distance:4.03, time:44.98, source:'gps', stravaId:401, route:['_p~iF~ps|U_ulLnnqC']}}};
    const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
      beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; }});
    await wait(300);
    const doc = dom.window.document;
    const title = doc.querySelector('#sessionCard .title').textContent;
    check('The main card shows the done run with what was actually run', /4\.5 mile easy run, 4\.03 mi · 44:5\d/.test(title), title);
    check('...and it isn\'t listed again under "Also today"', doc.getElementById('homeAlsoToday').hidden && !doc.querySelector('#homeAlsoToday [data-extra-id]'), doc.getElementById('homeAlsoToday').textContent.replace(/\s+/g,' ').trim());
    dom.window.close();
  }
  {
    // A run that came in from the watch on a day with nothing planned becomes the day's workout.
    const backend = makeBackend({connected:false});
    const logId = backend.addLog('2026-09-18', {planned_type:'run', planned_title:'Morning Run', planned_detail:'4.03 mi · 44:59'});
    backend.db.manual_entries.e5 = {id:'e5', workout_log_id: logId, name:'Morning Run', type:'run', volume:'4.03 mi · 44:59', notes:'', distance:4.03, duration_min:44.98,
      performance:{distance:4.03, time:44.98, source:'strava', stravaId:501}};
    const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
      beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; }});
    await wait(300);
    const doc = dom.window.document;
    check('A watch run that became the day\'s workout is the main card only (not repeated below)', /Morning Run, 4\.03 mi/.test(doc.querySelector('#sessionCard .title').textContent)
      && !doc.querySelector('#homeAlsoToday [data-entry-id]'), doc.getElementById('homeAlsoToday').textContent.replace(/\s+/g,' ').trim());
    dom.window.close();
  }
  {
    // Exactly as it was on a real phone: the watch's copy took over the rest day as "Morning Run", and the
    // GPS run (3.62 mi) sits on an added "4.5 mile easy run" (a run that day with nothing planned: the
    // watch's run only takes over a day with nothing, or no run, planned). On the next sign-in: one run,
    // one card.
    const backend = makeBackend({connected:true});
    backend.db.profiles.u1 = {id:'u1', training_days:[0,2], focus_ratio:2, level:'intermediate', equipment:'gym'}; // Fridays are rest days
    const logId = backend.addLog('2026-09-18', {planned_type:'run', planned_title:'Morning Run', planned_detail:'4.03 mi · 44:59'});
    backend.db.manual_entries.e4 = {id:'e4', workout_log_id: logId, name:'Morning Run', type:'run', volume:'4.03 mi · 44:59', notes:'', distance:4.03, duration_min:44.98,
      performance:{distance:4.03, time:44.98, source:'strava', stravaId:601}};
    backend.db.planned_workouts = {pw2: {id:'pw2', user_id:'u1', log_date:'2026-09-18', session_type:'run', title:'4.5 mile easy run', detail:'4.5 mi',
      completed:true, actual_distance:3.62, performance:{distance:3.62, time:45, source:'gps', route:['_p~iF~ps|U_ulLnnqC'], splits:[795, 788, 674]}}};
    const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
      beforeParse(w){ w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; }});
    await wait(400);
    const doc = dom.window.document;
    const title = doc.querySelector('#sessionCard .title').textContent;
    const also = doc.getElementById('homeAlsoToday');
    check('The real-phone case: merged into one run with the watch\'s numbers, on one card', !backend.db.manual_entries.e4 && backend.db.planned_workouts.pw2.actual_distance===4.03
      && /4\.5 mile easy run, 4\.03 mi · 44:5\d/.test(title) && also.hidden, `${title} | also: ${also.hidden ? '-' : also.textContent.replace(/\s+/g,' ').trim()} | ${backend.db.planned_workouts.pw2.actual_distance}`);
    check('...and the week\'s distance counts it once', /^4\.0\//.test(doc.getElementById('ovDistanceVal').textContent), doc.getElementById('ovDistanceVal').textContent);
    dom.window.close();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
