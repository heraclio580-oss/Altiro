const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Apple Health / Health Connect (store app only): Settings -> Connected apps -> Connect; runs from the watch
// come in like runs from Strava, once each (the same run arriving twice counts once, a deleted one stays
// deleted), today's steps show on Home, and Turn off stops it. Not shown on the website.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const TODAY = '2026-10-14'; // a Wednesday: the demo plan lifts today, rests yesterday
const at = (day, h, m) => new Date(`${day}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`).toISOString();
function run(id, day, h, miles, mins, type){
  const start = at(day, h, 0);
  return {platformId: id, workoutType: type || 'running', startDate: start, endDate: new Date(Date.parse(start) + mins*60000).toISOString(),
    duration: mins*60, totalDistance: miles*1609.344, totalEnergyBurned: mins*11, sourceName: 'com.garmin.android.apps.connectmobile'};
}

function makeHealth(){
  const h = {workouts: [], steps: 4321, calls: {query: 0, auth: null}};
  h.plugin = {
    isAvailable: async()=> ({available: true, platform: 'android'}),
    requestAuthorization: async(o)=>{ h.calls.auth = o; return {readAuthorized: o.read, readDenied: [], writeAuthorized: [], writeDenied: []}; },
    queryWorkouts: async()=>{ h.calls.query++; return {workouts: h.workouts.slice()}; },
    queryAggregated: async()=> ({samples: [{startDate: at(TODAY, 0, 0), value: h.steps, unit: 'count'}]}),
  };
  return h;
}

(async () => {
  // ---- the website: no Health row ----
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
      beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = TODAY; } });
    await wait(50);
    const go = id => [...dom.window.document.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    go('settings'); await wait(20);
    check('Website: no Apple Health / Health Connect row', dom.window.document.getElementById('healthRow').hidden);
  }

  // ---- the Android app ----
  const H = makeHealth();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){
      w.__ALTIRO_TEST_TODAY__ = TODAY;
      w.Capacitor = {isNativePlatform: ()=> true, getPlatform: ()=> 'android', Plugins: {Health: H.plugin}};
    } });
  const { window } = dom;
  await wait(60);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const dayText = async key => {
    go('home'); await wait(10);
    doc.querySelector(`#weekStrip .day-cell[data-date="${key}"]`).click(); await wait(20);
    const t = doc.getElementById('dayDetailEntries').textContent.replace(/\s+/g,' ') + ' | ' + doc.getElementById('dayDetailPlanRow').textContent.replace(/\s+/g,' ');
    doc.getElementById('closeDayDetail').click(); await wait(10);
    return t;
  };

  go('settings'); await wait(20);
  check('App (Android): Settings shows Health Connect with a Connect button', !doc.getElementById('healthRow').hidden
    && doc.getElementById('healthTitle').textContent==='Health Connect' && /Connect Health Connect/.test(doc.getElementById('healthConnectBtn').textContent));

  // Last week's runs from the watch, plus a lifting session (not a run: left alone).
  H.workouts = [run('hc-tue', '2026-10-13', 7, 4.02, 38), run('hc-today', TODAY, 6, 3.1, 29), run('hc-lift', TODAY, 18, 0.2, 45, 'strengthTraining')];
  doc.getElementById('healthConnectBtn').click(); await wait(80);
  check('Connect asks only to read workouts, steps, distance and calories', H.calls.auth && H.calls.auth.read.join(',')==='workouts,steps,distance,calories,totalCalories' && !(H.calls.auth.write||[]).length, JSON.stringify(H.calls.auth));
  check('...then shows it on, with today\'s steps', doc.getElementById('healthConnectBtn').hidden && /4,321 steps/.test(doc.getElementById('healthStatusText').textContent), doc.getElementById('healthStatusText').textContent);
  const tue = await dayText('2026-10-13'), wed = await dayText(TODAY);
  check('Yesterday\'s run from the watch is logged (4.02 mi)', /4\.02 mi/.test(tue), tue);
  check('Today\'s run is logged too (3.1 mi)', /3\.1 mi/.test(wed), wed);
  check('The lifting session from the watch isn\'t made into a run', !/0\.2 mi/.test(wed), wed);
  // Its summary: the watch's distance and time, and its calories.
  go('home'); await wait(10);
  doc.querySelector(`#weekStrip .day-cell[data-date="${TODAY}"]`).click(); await wait(20);
  const entry = [...doc.querySelectorAll('#dayDetailEntries [data-entry-id]')].find(e=> /3\.1 mi/.test(e.textContent));
  if(entry) entry.click();
  await wait(30);
  const stats = doc.getElementById('summaryStats').textContent.replace(/\s+/g,' ');
  check('Its summary shows the calories from the watch', !doc.getElementById('screen-summary').hidden && /319 kcal/.test(stats), stats);
  go('home'); await wait(20);
  check('Home: today\'s steps next to the streak', !doc.getElementById('stepsChip').hidden && /4,321 steps/.test(doc.getElementById('stepsChip').textContent), doc.getElementById('stepsChip').textContent);

  // Again: nothing new. The same run arriving a second way (another app's copy of it at the same time): once.
  H.workouts.push(run('strava-copy-of-today', TODAY, 6, 3.08, 29));
  const syncNow = async ()=>{ go('settings'); await wait(10); doc.getElementById('healthSyncBtn').click(); await wait(80); };
  await syncNow();
  const wed2 = await dayText(TODAY);
  check('Syncing again adds nothing twice', (wed2.match(/3\.1 mi/g) || []).length===1 && !/3\.08 mi/.test(wed2), wed2);

  // A run deleted in Altiro doesn't come back on the next sync.
  go('home'); await wait(10);
  doc.querySelector('#weekStrip .day-cell[data-date="2026-10-13"]').click(); await wait(20);
  const del = doc.querySelector('#dayDetailEntries [data-del]');
  if(del) del.click();
  await wait(20);
  window.dispatchEvent(new window.Event('pagehide')); // (the Undo window closes: the delete is final)
  doc.getElementById('closeDayDetail').click(); await wait(10);
  await syncNow();
  check('A deleted run stays deleted', !/4\.02 mi/.test(await dayText('2026-10-13')));

  // Turn off: no more syncing, no steps chip.
  go('settings'); await wait(20);
  doc.getElementById('healthOffBtn').click(); await wait(20);
  const q = H.calls.query;
  doc.dispatchEvent(new window.Event('visibilitychange')); await wait(50);
  check('Turn off stops it', H.calls.query===q && !doc.getElementById('healthConnectBtn').hidden && doc.getElementById('healthSyncBtn').hidden);
  go('home'); await wait(20);
  check('...and the steps chip goes', doc.getElementById('stepsChip').hidden);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
