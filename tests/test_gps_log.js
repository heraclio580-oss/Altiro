const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The GPS log, for tester accounts only: every raw fix of a run being tracked (with the phone's own speed
// and heading), when it was paused and picked up again, and what the tracker made of it -- kept on the
// phone, and sent from Settings, so the tracker can be tuned against a watch's recording of the same run.
// Fixes while paused aren't kept; a discarded run's log goes with it; an account that isn't a tester's
// keeps nothing.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

function makeBackend(tester){
  function from(table){
    let op = 'select';
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, in(){ return api; }, limit(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ op = 'delete'; return api; }, update(){ op = 'update'; return api; }, upsert(){ op = 'upsert'; return api; }, single(){ return api.maybeSingle(); },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-09-07', tester} : null, error:null}); },
      then(res, rej){ return Promise.resolve({data: op==='select' ? [] : null, error:null}).then(res, rej); },
    };
    return api;
  }
  return { createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'runner@example.com'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}
async function openApp(tester, lang){
  const backend = makeBackend(tester);
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){
      w.supabase = { createClient: () => backend.createClient() };
      w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      if(lang) w.localStorage.setItem('altiro_lang', lang);
      w.__geo = null;
      Object.defineProperty(w.navigator, 'geolocation', {configurable: true, value: {
        watchPosition(cb){ w.__geo = cb; return 1; }, clearWatch(){ w.__geo = null; }, getCurrentPosition(){},
      }});
      w.URL.createObjectURL = ()=> 'blob:altiro-test';
      w.URL.revokeObjectURL = ()=>{};
    } });
  await wait(300);
  const w = dom.window, doc = w.document;
  for(const id of ['badgeOverlay', 'locPromptOverlay']) doc.getElementById(id).hidden = true;
  return {w, doc};
}
// A fix every second, heading east at about 3 m/s.
const LAT0 = 37.7749, LNG0 = -122.4194, M_LNG = 1/(111195*Math.cos(LAT0*Math.PI/180));
let east = 0, t0 = Date.now();
function fix(w, i, extra){
  east += 3;
  w.__geo && w.__geo({coords: {latitude: LAT0 + (i%2 ? 0.000004 : -0.000004), longitude: LNG0 + east*M_LNG, accuracy: 6 + i%3, altitude: 120 + i*0.1, altitudeAccuracy: 4, speed: 3.05, heading: 90, ...(extra || {})}, timestamp: t0 + i*1000});
}
async function trackRun(app, opts){
  const {w, doc} = app;
  if(!doc.getElementById('trackRunBtn') || doc.getElementById('trackRunBtn').closest('[hidden]')) doc.getElementById('homeMoreBtn').click();
  doc.getElementById('trackRunBtn').click();
  await wait(50);
  let i = 0;
  fix(w, i++); // before Start: not part of the run
  doc.getElementById('gpsStartBtn').click();
  for(; i<=60; i++) fix(w, i);
  doc.getElementById('gpsStartBtn').click(); // pause
  for(let k=0; k<3; k++) fix(w, i++);       // standing at a light, paused
  doc.getElementById('gpsStartBtn').click(); // resume
  for(let k=0; k<20; k++) fix(w, i++);
  if(opts && opts.discard){
    doc.getElementById('gpsStartBtn').click();
    doc.getElementById('gpsClose').click();
    doc.getElementById('gpsDiscardYes').click();
    await wait(20);
    return;
  }
  doc.getElementById('gpsHoldFinish').dispatchEvent(new w.PointerEvent('pointerdown', {bubbles:true}));
  await wait(1400);
}
const stored = (w, k)=> JSON.parse(w.localStorage.getItem(k) || 'null');

(async () => {
  let app = await openApp(true);
  let {w, doc} = app;
  check('A tester\'s Settings has a GPS log, with nothing to send yet', !doc.getElementById('freePreviewSection').hidden && /GPS log/.test(doc.getElementById('freePreviewSection').textContent)
    && doc.getElementById('gpsLogSendBtn').disabled && /raw readings/.test(doc.getElementById('gpsLogSub').textContent), doc.getElementById('gpsLogSub').textContent);
  await trackRun(app);
  check('The run finished into Log Performance', !doc.getElementById('logPerfOverlay').hidden && doc.getElementById('gpsOverlay').hidden);
  const log = stored(w, 'altiro_gps_log');
  check('The run\'s GPS log is kept', !!log && Array.isArray(log.fixes));
  check('...every raw fix while running: 60 before the pause and 20 after (none from before Start or while paused)', log && log.fixes.length===80, log && log.fixes.length);
  check('...each with time, position, accuracy, altitude, the phone\'s speed and heading', log && log.fields.join()==='t,lat,lng,acc,alt,altAcc,speed,bearing' && log.fixes[0][6]===3.05 && log.fixes[0][7]===90 && log.fixes[0][3]===7 && log.fixes[0][4]!=null, log && JSON.stringify(log.fixes[0]));
  check('...when it was started, paused, picked up again and finished', log && log.events.map(e=> e[1]).join()==='start,pause,resume,finish', log && log.events.map(e=> e[1]).join());
  check('...what the tracker made of it, and the settings it used', log && log.app && log.app.distance===Number(doc.getElementById('logPerfDistanceInput').value) && log.app.settings && log.app.settings.minStepM>0 && Array.isArray(log.route) && log.route.length===2,
    log && JSON.stringify(log.app && {d: log.app.distance, s: log.app.settings}) + ' / ' + doc.getElementById('logPerfDistanceInput').value);
  check('...and the run-in-progress copy is cleared', !w.localStorage.getItem('altiro_gps_log_live'));
  doc.getElementById('closeLogPerf').click();
  await wait(20);
  [...doc.querySelectorAll('.nav-tab')].find(t=> t.dataset.tab==='settings').click();
  await wait(30);
  check('Settings: the last run\'s log, ready to send', !doc.getElementById('gpsLogSendBtn').disabled && /^Last run: [A-Z][a-z]{2} \d{1,2} · 0\.\d\d mi · 80 readings$/.test(doc.getElementById('gpsLogSub').textContent), doc.getElementById('gpsLogSub').textContent);
  let saved = null;
  w.HTMLAnchorElement.prototype.click = function(){ saved = {name: this.download, href: this.href}; };
  doc.getElementById('gpsLogSendBtn').click();
  await wait(30);
  check('Send: the log as a file (downloaded where there\'s no share sheet)', saved && /^altiro-gps-\d{4}-\d\d-\d\d-\d{4}\.json$/.test(saved.name), saved && saved.name);
  // The phone's share sheet, where there is one.
  let shared = null;
  w.navigator.canShare = ()=> true;
  w.navigator.share = async d=>{ shared = d; };
  doc.getElementById('gpsLogSendBtn').click();
  await wait(30);
  check('...or through the share sheet', shared && shared.files && shared.files[0].name.endsWith('.json') && shared.files[0].type==='application/json');

  // Discarded: its log goes too (the last finished one stays).
  doc.querySelector('.nav-tab[data-tab="home"]').click();
  await wait(30);
  await trackRun(app, {discard: true});
  check('A discarded run keeps no log of its own', !w.localStorage.getItem('altiro_gps_log_live') && stored(w, 'altiro_gps_log').fixes.length===80);
  w.close();

  // Not a tester: nothing kept, nothing shown.
  app = await openApp(false);
  ({w, doc} = app);
  check('Not a tester: no GPS log in Settings', doc.getElementById('freePreviewSection').hidden);
  await trackRun(app);
  check('...and nothing is kept from the run', !doc.getElementById('logPerfOverlay').hidden && !w.localStorage.getItem('altiro_gps_log') && !w.localStorage.getItem('altiro_gps_log_live'));
  w.close();

  // In Spanish.
  app = await openApp(true, 'es');
  ({w, doc} = app);
  check('In Spanish', /Registro GPS/.test(doc.getElementById('freePreviewSection').textContent) && /lecturas sin procesar/.test(doc.getElementById('gpsLogSub').textContent) && doc.getElementById('gpsLogSendBtn').textContent==='Enviar', doc.getElementById('gpsLogSub').textContent);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
