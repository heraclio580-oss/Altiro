const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Walks, hikes and bike rides, besides runs -- "the app to track all my activities in one place":
// - Create workout: Cardio is one button with a list under it (Run, Walk, Hike, Bike ride); a walk or hike
//   shows its pace, a ride its speed.
// - From Strava (a hike, a gravel ride) and Health Connect (a 30-minute walk, a ride -- not a 10-minute
//   walk): each filed on its own day as that kind of workout, never onto a planned run.
// - They count as workouts (and toward the streak), not as running miles; Progress shows their own miles.
// - Settings can turn them off (Strava is told which kinds this app takes in).
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
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
  const addStrava = (id, local_date, name, distance_m, moving_time_s, more) => {
    db.strava_activities[id] = {id, user_id:'u1', name, local_date, start_date: local_date+'T12:00:00Z', distance_m, moving_time_s, applied_at:null, ...(more || {})};
  };
  function from(table){
    let filters = [], op = 'select', payload = null, wantRows = false, cols = '';
    const matches = row => filters.every(([c,v,kind]) => kind==='is' ? row[c]==null : kind==='notnull' ? row[c]!=null : kind==='gte' ? row[c]>=v : row[c]===v);
    async function run(single){
      const rows = db[table];
      // (A database from before the best_efforts column: asking for it is an error.)
      if(opts.noBestsCol && table==='strava_activities' && /best_efforts/.test(cols)) return {data:null, error:{code:'42703', message:'column strava_activities.best_efforts does not exist'}};
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
      select(c){ wantRows = true; cols = String(c || ''); return api; },
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



function open(backend, today, before){
  return new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
    beforeParse(w){ if(backend) w.supabase = {createClient: ()=> backend.createClient()}; w.__ALTIRO_TEST_TODAY__ = today; if(before) before(w); }});
}
const at = (day, h, m)=> new Date(`${day}T${String(h).padStart(2,'0')}:${String(m||0).padStart(2,'0')}:00`).toISOString();
function hcWorkout(id, day, hour, miles, mins, type){
  return {platformId: id, workoutType: type, startDate: at(day, hour), endDate: new Date(Date.parse(at(day, hour)) + mins*60000).toISOString(),
    duration: mins*60, totalDistance: miles*1609.344, totalEnergyBurned: mins*6, sourceName: 'com.garmin.android.apps.connectmobile'};
}

(async () => {
  // ---- Create workout: the Cardio list ----
  {
    const dom = open(null, '2026-11-14');
    await wait(80);
    const w = dom.window, doc = w.document;
    const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    go('home'); await wait(20);
    doc.getElementById('addTodayWorkoutBtn') ? doc.getElementById('addTodayWorkoutBtn').click() : doc.getElementById('addWorkoutBtn').click();
    await wait(20);
    const cardio = ()=> doc.querySelector('#manualTypeRow .type-pick .type-btn');
    check('Create workout: one Cardio button, no separate walk/hike/ride buttons', !!cardio() && /Cardio/.test(cardio().textContent) && doc.querySelectorAll('#manualTypeRow > .type-btn').length===3);
    cardio().click(); await wait(10);
    const opts = [...doc.querySelectorAll('#manualTypeRow .type-menu [data-cardio]')].map(b=> b.textContent.trim());
    check('Tapping it opens the list: Run, Walk, Hike, Bike ride', opts.join('|')==='Run|Walk|Hike|Bike ride', opts.join('|'));
    doc.querySelector('#manualTypeRow [data-cardio="hike"]').click(); await wait(10);
    check('Picking Hike: the button says Hike, the list closes', /Hike/.test(cardio().textContent) && cardio().classList.contains('sel') && !doc.querySelector('#manualTypeRow .type-menu'));
    doc.getElementById('createCompletedToggle').click(); await wait(10); // (already done)
    check('...and, already done, it asks for a distance and a time (as a run does)', !doc.getElementById('cardioLogSection').hidden);
    doc.getElementById('manualNameInput').value = 'Sunset hike';
    doc.getElementById('manualDistanceInput').value = '4.2';
    doc.getElementById('manualDurationHInput').value = '1'; doc.getElementById('manualDurationMInput').value = '30'; doc.getElementById('manualDurationSInput').value = '0';
    doc.getElementById('manualDistanceInput').dispatchEvent(new w.Event('input', {bubbles:true}));
    check('...with its pace (21:26/mi)', doc.getElementById('manualPaceDisplay').textContent==='21:26/mi', doc.getElementById('manualPaceDisplay').textContent);
    cardio().click(); await wait(10);
    doc.querySelector('#manualTypeRow [data-cardio="ride"]').click(); await wait(10);
    doc.getElementById('manualDistanceInput').dispatchEvent(new w.Event('input', {bubbles:true}));
    check('A bike ride: its speed instead (2.8 mph for 4.2 mi in 1:30)', doc.getElementById('manualPaceDisplay').textContent==='2.8 mph' && /Speed/.test(doc.getElementById('manualPaceLabel').textContent), doc.getElementById('manualPaceDisplay').textContent);
    cardio().click(); await wait(10);
    doc.body.click(); await wait(10);
    check('A tap elsewhere closes the list', !doc.querySelector('#manualTypeRow .type-menu'));
    cardio().click(); await wait(10);
    doc.querySelector('#manualTypeRow [data-cardio="hike"]').click(); await wait(10);
    doc.getElementById('saveManualEntry').click(); await wait(30);
    const log = [...doc.querySelectorAll('#screen-home *')].map(e=> e.textContent).join(' ');
    check('Saved: the hike is today\'s workout (a rest day)', /Sunset hike/.test(doc.getElementById('screen-home').textContent));
    // Its summary.
    go('calendar'); await wait(20);
    doc.querySelector('.mo-cell[data-date="2026-11-14"]').click(); await wait(20);
    doc.getElementById('dayDetailPlanRow').click(); await wait(30);
    // (Logged by hand, it opens to its numbers; saved, its summary.)
    const lp = !doc.getElementById('logPerfOverlay').hidden;
    check('Opening it: its distance (4.2) and time, to check', lp && doc.getElementById('logPerfDistanceInput').value==='4.2' && !doc.getElementById('logPerfDistanceSection').hidden, lp && doc.getElementById('logPerfDistanceInput').value);
    if(lp){ doc.getElementById('saveLogPerf').click(); await wait(60); }
    // (Saved, it stays put; tapped again, its summary.)
    if(!doc.getElementById('dayDetailOverlay').hidden) doc.getElementById('closeDayDetail').click();
    doc.querySelector('.mo-cell[data-date="2026-11-14"]').click(); await wait(20);
    doc.getElementById('dayDetailPlanRow').click(); await wait(40);
    const stats = doc.getElementById('summaryStats') ? doc.getElementById('summaryStats').textContent.replace(/\s+/g,' ') : '';
    check('Its summary: 4.2 mi, 1:30:00, pace 21:26/mi', /4\.2 mi/.test(stats) && /1:30:00/.test(stats) && /21:26\/mi/.test(stats), stats);
    check('...not the old made-up hike numbers', !/410 ft|58 min/.test(stats), stats);
    go('progress'); await wait(30);
    check('Progress: "Walks, hikes and rides", 4.2 mi hiked', !doc.getElementById('otherActSection').hidden && /Hiked\s*4\.2 mi/.test(doc.getElementById('otherActTiles').textContent), doc.getElementById('otherActTiles').textContent);
    w.close();
  }

  // ---- From Strava: a run and a hike the same day, and a gravel ride ----
  {
    const backend = makeBackend({connected:true});
    backend.addLog('2026-11-14', {planned_type:'run', planned_title:'Long Run', planned_detail:'8 mi'});
    backend.addStrava(301, '2026-11-14', 'Morning Run', 14581, 5400, {sport_type:'Run'});              // 9.06 mi
    backend.addStrava(302, '2026-11-14', 'Afternoon Hike', 6759, 5400, {sport_type:'Hike', start_date:'2026-11-14T22:00:00Z', elev_gain_m: 180}); // 4.2 mi
    backend.addStrava(303, '2026-11-13', 'Gravel Grind', 40234, 5400, {sport_type:'GravelRide'});      // 25 mi
    const dom = open(backend, '2026-11-14');
    await wait(2500);
    const w = dom.window, doc = w.document;
    const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    const sync = backend.invokes.find(b=> b.action==='sync');
    check('The Strava sync asks for walks, hikes and rides too', !!sync && JSON.stringify(sync.kinds)==='["run","walk","hike","ride"]', JSON.stringify(sync));
    const today = Object.values(backend.db.workout_logs).find(r=> r.log_date==='2026-11-14');
    check('The run fills the planned Long Run (9.06 mi)', today && today.actual_run_distance===9.06, today && today.actual_run_distance);
    const hike = Object.values(backend.db.manual_entries).find(e=> e.name==='Afternoon Hike');
    check('The hike comes in as a hike of its own, not onto the run', !!hike && hike.type==='hike' && hike.distance===4.2, JSON.stringify(hike));
    check('...with Strava\'s climb and link', hike && hike.performance && hike.performance.stravaId===302 && hike.performance.elevGain===180, JSON.stringify(hike && hike.performance));
    const ride = Object.values(backend.db.manual_entries).find(e=> e.name==='Gravel Grind');
    check('The gravel ride comes in as a bike ride (25 mi)', !!ride && ride.type==='ride' && ride.distance===25, JSON.stringify(ride));
    check('Every one is marked filed', [301,302,303].every(id=> backend.db.strava_activities[id].applied_at));
    check('The toast: 3 activities', /Imported 3 activities from Strava/.test(doc.getElementById('toastMsg').textContent), doc.getElementById('toastMsg').textContent);
    go('home'); await wait(20);
    const dist = doc.getElementById('ovDistanceVal').textContent;
    check('Running miles this week: the run only (9.1 mi), not the hike or the ride', /^9\.1\//.test(dist), dist);
    go('progress'); await wait(30);
    const tiles = doc.getElementById('otherActTiles').textContent.replace(/\s+/g,' ');
    check('Progress: hiked 4.2 mi, ridden 25 mi', /Hiked\s*4\.2 mi/.test(tiles) && /Ridden\s*25 mi/.test(tiles), tiles);
    // The ride's summary: speed.
    go('calendar'); await wait(20);
    doc.querySelector('.mo-cell[data-date="2026-11-13"]').click(); await wait(20);
    const rideRow = doc.querySelector('#dayDetailEntries [data-entry-id]') || doc.getElementById('dayDetailPlanRow');
    rideRow.click(); await wait(30);
    const stats = doc.getElementById('summaryStats').textContent.replace(/\s+/g,' ');
    check('The ride\'s summary: 25.00 mi, 1:30:00, average speed 16.7 mph', /25\.00 mi/.test(stats) && /16\.7 mph/.test(stats) && /Avg speed/i.test(stats), stats);
    w.close();
  }

  // ---- Turned off in Settings: walks, hikes and rides stay out (and are left for later) ----
  {
    const backend = makeBackend({connected:true});
    backend.addStrava(302, '2026-11-14', 'Afternoon Hike', 6759, 5400, {sport_type:'Hike'});
    const dom = open(backend, '2026-11-14', w=> w.localStorage.setItem('altiro_import_other', '0'));
    await wait(2500);
    const doc = dom.window.document;
    const sync = backend.invokes.find(b=> b.action==='sync');
    check('Turned off: Strava is asked for runs only', !!sync && JSON.stringify(sync.kinds)==='["run"]', JSON.stringify(sync));
    check('...the hike isn\'t filed, or marked filed', !Object.values(backend.db.manual_entries).length && !backend.db.strava_activities[302].applied_at);
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click(); await new Promise(r=>setTimeout(r,20));
    check('Settings: "Walks, hikes and bike rides", off', /Walks, hikes and bike rides/.test(doc.getElementById('screen-settings').textContent) && !doc.getElementById('importOtherToggle').classList.contains('on'));
    doc.getElementById('importOtherToggle').click();
    await wait(400);
    check('Turned on: the hike comes in', Object.values(backend.db.manual_entries).some(e=> e.type==='hike'));
    dom.window.close();
  }

  // ---- Health Connect (the Android app): a 30-minute walk and a ride, not a 10-minute walk ----
  {
    const h = {workouts: [
      hcWorkout('hc-walk', '2026-11-13', 9, 1.6, 30, 'walking'),
      hcWorkout('hc-short', '2026-11-13', 12, 0.4, 10, 'walking'),
      hcWorkout('hc-ride', '2026-11-12', 7, 18.5, 65, 'cycling'),
      hcWorkout('hc-run', '2026-11-12', 18, 3.1, 29, 'running'),
    ]};
    const plugin = {
      isAvailable: async()=> ({available: true, platform: 'android'}),
      requestAuthorization: async(o)=> ({readAuthorized: o.read, readDenied: [], writeAuthorized: [], writeDenied: []}),
      queryWorkouts: async()=> ({workouts: h.workouts.slice()}),
      queryAggregated: async()=> ({samples: []}),
    };
    const dom = open(null, '2026-11-14', w=>{ w.Capacitor = {isNativePlatform: ()=> true, getPlatform: ()=> 'android', Plugins: {Health: plugin}}; });
    await wait(80);
    const w = dom.window, doc = w.document;
    const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    go('settings'); await wait(20);
    doc.getElementById('healthConnectBtn').click(); await wait(150);
    const day = async key=>{ go('calendar'); await wait(10); doc.querySelector(`.mo-cell[data-date="${key}"]`).click(); await wait(20);
      const t = doc.getElementById('dayDetailOverlay').textContent.replace(/\s+/g,' '); doc.getElementById('closeDayDetail').click(); await wait(10); return t; };
    const fri = await day('2026-11-13'), thu = await day('2026-11-12');
    check('Health Connect: the 30-minute walk comes in (1.6 mi)', /Walk/.test(fri) && /1\.6 mi/.test(fri), fri);
    check('...not the 10-minute one', !/0\.4 mi/.test(fri), fri);
    check('...the ride (18.5 mi) and the run (3.1 mi) both', /Bike ride/.test(thu) && /18\.5 mi/.test(thu) && /3\.1 mi/.test(thu), thu);
    w.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
