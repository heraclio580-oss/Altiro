const fs = require('fs');
const path = require('path');
const http = require('http');

// Tracking a run with the phone's GPS, in a real browser with a pretend GPS and a fake clock: a run is
// started from Today, fed a route (with a bad reading and a GPS jump that must be ignored, and a pause
// that must not count), finished with a hold, filled into Log Performance, and saved -- then the
// Summary shows its route and mile splits, and the share card has the route. Also: a run left mid-way
// comes back after the app reopens, a planned run offers GPS in Log Performance, and the one-time
// location prompt. Set GPS_OUT=<folder> to keep the share card picture. Skipped without Playwright.
let chromium;
for(const p of ['playwright', '/opt/node22/lib/node_modules/playwright']){ try{ ({ chromium } = require(p)); break; }catch(e){} }
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f=> fs.existsSync(f));
if(!chromium){ console.log('(Playwright not installed -- skipped)'); process.exit(0); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const www = path.join(__dirname, '..', 'www');
const LAT0 = 37.7749, LNG0 = -122.4194, M_LAT = 1/111195; // metres to degrees of latitude, on the same sphere the app measures with

(async () => {
  const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.wav':'audio/wav', '.png':'image/png'};
  const server = http.createServer((req, res)=>{
    const f = path.join(www, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if(!f.startsWith(www) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, {'Content-Type': types[path.extname(f)] || 'application/octet-stream'});
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=> server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});

  async function openApp(opts){
    opts = opts || {};
    const ctx = opts.ctx || await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e=> errors.push(e.message));
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    if(!opts.withMapLib) await page.route(/maplibre-gl\.js$/, r=> r.abort()); // no map: the route is drawn by itself
    await page.clock.install({time: new Date('2026-09-19T08:00:00')});
    await page.addInitScript(o=>{
      window.__ALTIRO_TEST_TODAY__ = '2026-09-19'; // a Saturday: a rest day on the default plan
      if(o.askLocation) window.__ALTIRO_ASK_LOCATION__ = true;
      window.__geo = {cb:null};
      navigator.geolocation.watchPosition = (cb)=>{ window.__geo.cb = cb; return 7; };
      navigator.geolocation.clearWatch = ()=>{ window.__geo.cb = null; };
      navigator.geolocation.getCurrentPosition = cb=> setTimeout(()=> cb({coords:{latitude:37.7749, longitude:-122.4194, accuracy:12}, timestamp: Date.now()}), 10);
      window.__fix = (lat, lng, acc)=>{ if(window.__geo.cb) window.__geo.cb({coords:{latitude:lat, longitude:lng, accuracy:acc}, timestamp: Date.now()}); };
      window.__wake = 0;
      Object.defineProperty(navigator, 'wakeLock', {configurable:true, value:{request: async()=>{ window.__wake++; return {release: async()=>{ window.__wake--; }}; }}});
    }, {askLocation: !!opts.askLocation});
    await page.goto(base + 'index.html?proto');
    await sleep(400);
    await page.clock.pauseAt(new Date('2026-09-19T08:05:00')); // from here, time only moves when the test moves it
    await page.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); document.documentElement.classList.remove('proto-on'); });
    await sleep(200);
    return {page, errors, ctx};
  }
  const txt = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g,' ').trim() : null; }, sel);
  const shown = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]'); }, sel);
  const fix = (page, metres, acc, eastM)=> page.evaluate(([la, ln, a])=> window.__fix(la, ln, a), [LAT0 + metres*M_LAT, LNG0 + (eastM||0)*M_LAT/Math.cos(LAT0*Math.PI/180), acc==null ? 6 : acc]);

  // ---- A run nobody planned, from Today ----
  {
    const {page, errors} = await openApp();
    check('Today has a "Track a run with GPS" button', await shown(page, '#trackRunBtn') && /Track a run with GPS/.test(await txt(page, '#trackRunBtn')));
    await page.tap('#trackRunBtn');
    await sleep(100);
    check('It opens the run tracker', await shown(page, '#gpsOverlay'));
    check('...looking for GPS at first', /Finding GPS/.test(await txt(page, '#gpsSignal')));
    check('...with a note (in a browser) to keep the screen on', await shown(page, '#gpsNote') && /screen on/.test(await txt(page, '#gpsNote')));
    await fix(page, 0, 8);
    check('A good fix: GPS ready', /GPS ready/.test(await txt(page, '#gpsSignal')));
    check('Nothing counts before Start', (await txt(page, '#gpsDist'))==='0.00' && (await txt(page, '#gpsTime'))==='0:00');
    await page.tap('#gpsStartBtn');
    check('Start: running, with Pause to hand', (await txt(page, '#gpsStartBtn'))==='Pause' && await page.evaluate(()=> window.__wake)===1);
    // About 5 m/s (a 5:22 mile), a fix every 2 seconds.
    for(let i=1; i<=100; i++){
      await page.clock.fastForward(2000);
      await fix(page, i*10);
      if(i===50){ await fix(page, i*10 + 300, 90); await fix(page, i*10, 5, 500); } // a poor reading, then a 500 m jump
    }
    const d1 = await txt(page, '#gpsDist');
    check('990 m (100 fixes, 10 m apart) shows as 0.62 mi; the bad reading and the jump are ignored', d1==='0.62', d1);
    check('...time 3:20', (await txt(page, '#gpsTime'))==='3:20', await txt(page, '#gpsTime'));
    check('...current pace about 5:22 /mi', /^5:2\d$/.test(await txt(page, '#gpsPace')), await txt(page, '#gpsPace'));
    await page.tap('#gpsStartBtn');
    check('Pause: Resume to hand, marked paused, screen allowed to sleep', (await txt(page, '#gpsStartBtn'))==='Resume' && /Paused/.test(await txt(page, '#gpsStatus')) && await page.evaluate(()=> window.__wake)===0);
    await page.clock.fastForward(60000);
    await fix(page, 1005);
    check('A minute paused (and moving) adds no time or distance', (await txt(page, '#gpsTime'))==='3:20' && (await txt(page, '#gpsDist'))==='0.62');
    await page.tap('#gpsStartBtn');
    for(let i=101; i<=194; i++){ await page.clock.fastForward(2000); await fix(page, i*10); }
    const dist = await txt(page, '#gpsDist'), time = await txt(page, '#gpsTime');
    check('Resumed: 1920 m in all (the gap while paused not counted) = 1.19 mi', dist==='1.19', dist);
    check('...in 6:28 of running', time==='6:28', time);
    check('...average pace about 5:25 /mi', /^5:2\d$/.test(await txt(page, '#gpsAvgPace')), await txt(page, '#gpsAvgPace'));
    check('The route is drawn (no map here: just the line)', await page.evaluate(()=> document.querySelectorAll('#gpsMap svg.route-svg polyline').length)===4);
    check('Close isn\'t offered mid-run', !(await shown(page, '#gpsClose')));

    // Finish with a press-and-hold.
    await page.evaluate(()=> document.getElementById('gpsHoldFinish').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
    await page.clock.fastForward(1300);
    await sleep(100);
    check('Holding Finish ends the run and opens Log Performance', !(await shown(page, '#gpsOverlay')) && await shown(page, '#logPerfOverlay'));
    const lp = await page.evaluate(()=> ({d: document.getElementById('logPerfDistanceInput').value, h: document.getElementById('logPerfTimeHInput').value, m: document.getElementById('logPerfTimeMInput').value, s: document.getElementById('logPerfTimeSInput').value}));
    check('...filled in: 1.19 mi in 6:28', lp.d==='1.19' && Number(lp.h||0)===0 && Number(lp.m)===6 && Number(lp.s)===28, JSON.stringify(lp));
    check('...with the route and a note to check it', await shown(page, '#logPerfRoute') && await page.evaluate(()=> !!document.querySelector('#logPerfRouteMap svg polyline')) && /GPS run/.test(await txt(page, '#logPerfRouteNote')));
    check('...and no "Track with GPS" button (it\'s been tracked)', !(await shown(page, '#logPerfGpsBtn')));
    check('The run in progress is cleared from the phone', await page.evaluate(()=> !localStorage.getItem('altiro_gps_run')));
    await page.tap('#saveLogPerf');
    await sleep(300);
    check('Saving shows the Summary', await shown(page, '#screen-summary'));
    check('...with the route', await shown(page, '#summaryRouteCard') && await page.evaluate(()=> !!document.querySelector('#summaryRouteMap svg polyline')));
    const splits = await txt(page, '#summarySplits');
    check('...and splits: mile 1 about 5:26, then the last 0.19 mi', /Mile 1\s*5:2\d\/mi/.test(splits) && /0\.19 mi\s*\d:\d\d\/mi/.test(splits), splits);
    check('...and the stats: 1.19 mi', /1\.19 mi|1\.2 mi/.test(await txt(page, '#summaryStats')), await txt(page, '#summaryStats'));
    check('The finished run is no longer waiting to be saved', await page.evaluate(()=> !localStorage.getItem('altiro_gps_done')));

    await page.clock.resume();
    await page.tap('#shareWorkoutBtn');
    let pv = null;
    for(let i=0; i<60; i++){ pv = await page.evaluate(()=>{ const i = document.getElementById('shareCardPreview'); return {h: i.naturalHeight, alt: i.alt, ok: i.complete}; }); if(pv.ok && pv.h===1350) break; await sleep(100); }
    check('The share card is made, with the run\'s numbers', pv.h===1350 && /Distance: 1\.19 mi/.test(pv.alt) && /Pace: 5:2\d\/mi/.test(pv.alt), JSON.stringify(pv));
    if(process.env.GPS_OUT){
      fs.mkdirSync(process.env.GPS_OUT, {recursive:true});
      const b64 = await page.evaluate(async ()=>{ const r = await fetch(document.getElementById('shareCardPreview').src); const b = await r.blob(); return await new Promise(res=>{ const fr = new FileReader(); fr.onload = ()=> res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }); });
      fs.writeFileSync(path.join(process.env.GPS_OUT, 'gps-share.jpg'), Buffer.from(b64, 'base64'));
      await page.tap('#closeShareCard');
      await page.screenshot({path: path.join(process.env.GPS_OUT, 'gps-summary.png')});
    }
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- A run left half-way comes back when the app is opened again ----
  {
    const {page, errors, ctx} = await openApp();
    await page.tap('#trackRunBtn');
    await fix(page, 0);
    await page.tap('#gpsStartBtn');
    for(let i=1; i<=40; i++){ await page.clock.fastForward(2000); await fix(page, i*10); }
    await page.clock.fastForward(5000);
    await fix(page, 405);
    const before = await txt(page, '#gpsDist');
    await page.close();
    const again = await ctx.newPage();
    again.on('pageerror', e=> errors.push(e.message));
    await again.route(u=> !u.href.startsWith(base), r=> r.abort());
    await again.route(/maplibre-gl\.js$/, r=> r.abort());
    await again.goto(base + 'index.html?proto');
    await sleep(400);
    await again.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); });
    await sleep(300);
    check('Reopened mid-run: the tracker is back, paused, with the distance so far', await shown(again, '#gpsOverlay') && (await txt(again, '#gpsStartBtn'))==='Resume' && (await txt(again, '#gpsDist'))===before, `${before} -> ${await txt(again, '#gpsDist')}`);
    check('...and its route', await again.evaluate(()=> !!document.querySelector('#gpsMap svg.route-svg polyline')));
    await again.tap('#gpsClose');
    check('Closing a run with distance asks first', await shown(again, '#gpsDiscardConfirm'));
    await again.tap('#gpsDiscardYes');
    check('...and Discard throws it away', !(await shown(again, '#gpsOverlay')) && await again.evaluate(()=> !localStorage.getItem('altiro_gps_run')));
    check('No page errors', errors.length===0, errors.join(' | '));
    await ctx.close();
  }

  // ---- A planned run: Log Performance offers GPS ----
  {
    const {page, errors} = await openApp();
    await page.evaluate(()=>{
      const doc = document;
      doc.getElementById('addTodayWorkoutBtn').click();
      doc.getElementById('manualNameInput').value = 'Easy run';
      doc.getElementById('manualNameInput').dispatchEvent(new Event('input', {bubbles:true}));
      [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
      doc.getElementById('saveManualEntry').click();
    });
    await sleep(100);
    await page.tap('#recordBtn');
    await page.clock.fastForward(500);
    await sleep(100);
    check('Recording a run: Log Performance offers "Track this run with GPS"', await shown(page, '#logPerfOverlay') && await shown(page, '#logPerfGpsBtn'));
    await page.tap('#logPerfGpsBtn');
    check('...which opens the tracker for that run', await shown(page, '#gpsOverlay') && !(await shown(page, '#logPerfOverlay')));
    await page.tap('#gpsClose');
    check('Closing an untouched tracker just closes it', !(await shown(page, '#gpsOverlay')));
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- The map itself loads (MapLibre) without errors ----
  {
    const {page, errors} = await openApp({withMapLib: true});
    await page.clock.resume();
    await page.tap('#trackRunBtn');
    let gl = false;
    for(let i=0; i<40 && !gl; i++){ gl = await page.evaluate(()=> !!window.maplibregl && !!document.querySelector('#gpsMap .maplibregl-canvas, #gpsMap .route-map-gl')); if(!gl) await sleep(100); }
    check('With the map library available, the tracker sets up a real map', gl);
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- Asking for location once, on getting into the app ----
  {
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true });
    const {page, errors} = await openApp({ctx, askLocation: true});
    await page.clock.fastForward(1200);
    await sleep(100);
    check('Getting into the app asks once to allow location, saying why', await shown(page, '#locPromptOverlay') && /map and measure your runs/.test(await txt(page, '#locPromptOverlay')));
    await page.tap('#locPromptAllow');
    await page.clock.fastForward(200);
    await sleep(100);
    check('Allow: the phone is asked, and it says location is on', !(await shown(page, '#locPromptOverlay')) && /Location is on/.test(await txt(page, '#toastMsg')));
    await page.reload();
    await sleep(400);
    await page.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); });
    await page.clock.fastForward(1500);
    await sleep(100);
    check('...and it isn\'t asked again', !(await shown(page, '#locPromptOverlay')));
    check('No page errors', errors.length===0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
