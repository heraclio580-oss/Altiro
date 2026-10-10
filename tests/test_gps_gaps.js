const fs = require('fs');
const path = require('path');
const http = require('http');

// GPS dropouts: in a browser, GPS stops while the screen is off (or another app is open), and that
// stretch of the run becomes a straight line -- a 4-mile run next to a Garmin came out 10% short. The
// run keeps a record of the dropouts: coming back to the screen mid-run says GPS stopped, and the
// Summary says the distance may read short and why. A run with steady GPS says nothing. Skipped without
// Playwright.
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
  const tapTrack = async (page)=>{ if(!(await page.evaluate(()=>{ const e = document.getElementById('trackRunBtn'); return !!e && !e.closest('[hidden]'); }))) await page.tap('#homeMoreBtn'); await page.tap('#trackRunBtn'); };
  const setVisible = (page, visible)=> page.evaluate(v=>{
    Object.defineProperty(document, 'visibilityState', {configurable:true, get: ()=> v ? 'visible' : 'hidden'});
    Object.defineProperty(document, 'hidden', {configurable:true, get: ()=> !v});
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
  async function finishAndSave(page){
    await page.evaluate(()=> document.getElementById('gpsHoldFinish').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
    await page.clock.fastForward(1300);
    await sleep(100);
    await page.tap('#saveLogPerf');
    await sleep(300);
  }

  // A run north at 3 m/s with a fix every second; the screen goes off for a minute and a half partway.
  {
    const {page, errors} = await openApp();
    await tapTrack(page);
    await sleep(100);
    await fix(page, 0);
    await page.tap('#gpsStartBtn');
    let m = 0;
    for(let i=0; i<120; i++){ await page.clock.fastForward(1000); m += 3; await fix(page, m); }
    check('(set-up) no warning while GPS keeps coming in', !(await page.evaluate(()=> document.getElementById('gpsNote').classList.contains('alert'))));
    await setVisible(page, false);
    await page.clock.fastForward(90000); m += 270;    // no fixes while the screen is off
    await setVisible(page, true);
    check('Back on screen after GPS stopped: the tracker says so', await shown(page, '#gpsNote') && /stopped while the screen was off/.test(await txt(page, '#gpsNote')), await txt(page, '#gpsNote'));
    for(let i=0; i<60; i++){ await page.clock.fastForward(1000); m += 3; await fix(page, m); }
    await finishAndSave(page);
    check('The Summary says GPS stopped while the screen was off, and for how long', await shown(page, '#summaryGpsNote') && /stopped for 1:3\d in all while the screen was off/.test(await txt(page, '#summaryGpsNote')), await txt(page, '#summaryGpsNote'));
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.close();
  }
  // Pocket lock: the screen stays on but goes dark and ignores touches; GPS keeps coming in.
  {
    const {page, errors} = await openApp();
    await tapTrack(page);
    await sleep(100);
    await fix(page, 0);
    check('No pocket lock before the run starts', !(await shown(page, '#gpsLockBtn')));
    await page.tap('#gpsStartBtn');
    for(let i=1; i<=20; i++){ await page.clock.fastForward(1000); await fix(page, i*3); }
    check('Once running, the pocket lock is offered', await shown(page, '#gpsLockBtn'));
    await page.tap('#gpsLockBtn');
    check('Tapping it darkens the screen, with the time and distance dimly shown', await shown(page, '#gpsPocket') && /^0:2\d$/.test(await txt(page, '#gpsPocketTime')) && /0\.04 mi/.test(await txt(page, '#gpsPocketDist')), (await txt(page, '#gpsPocketTime'))+' / '+(await txt(page, '#gpsPocketDist')));
    check('...and keeps the screen awake', await page.evaluate(()=> window.__wake)>=1);
    await page.mouse.click(195, 760); // where Pause is, under the dark screen
    await page.mouse.click(40, 40);   // where Close is
    for(let i=21; i<=40; i++){ await page.clock.fastForward(1000); await fix(page, i*3); }
    check('Touches on the dark screen do nothing: still running, still locked, distance still counting', await shown(page, '#gpsPocket') && /0\.07 mi/.test(await txt(page, '#gpsPocketDist')), await txt(page, '#gpsPocketDist'));
    const box = await page.locator('#gpsPocketUnlock').boundingBox();
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.mouse.down(); await page.clock.fastForward(500); await page.mouse.up();
    check('A short press on Unlock doesn\'t unlock', await shown(page, '#gpsPocket'));
    await page.mouse.down(); await page.clock.fastForward(1600); await page.mouse.up();
    await sleep(50);
    check('Holding Unlock brings the tracker back, still running', !(await shown(page, '#gpsPocket')) && /Pause/i.test(await txt(page, '#gpsStartBtn')), await txt(page, '#gpsStartBtn'));
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.close();
  }
  // Steady GPS all the way: no note.
  {
    const {page, errors} = await openApp();
    await tapTrack(page);
    await sleep(100);
    await fix(page, 0);
    await page.tap('#gpsStartBtn');
    for(let i=1; i<=150; i++){ await page.clock.fastForward(1000); await fix(page, i*3); }
    await finishAndSave(page);
    check('Steady GPS: the Summary has no dropout note', await shown(page, '#screen-summary') && !(await shown(page, '#summaryGpsNote')));
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.close();
  }
  // A dropout with the screen on (no signal): the Summary still notes it, without blaming the screen.
  {
    const {page} = await openApp();
    await tapTrack(page);
    await sleep(100);
    await fix(page, 0);
    await page.tap('#gpsStartBtn');
    let m = 0;
    for(let i=0; i<60; i++){ await page.clock.fastForward(1000); m += 3; await fix(page, m); }
    await page.clock.fastForward(45000); m += 135;
    for(let i=0; i<60; i++){ await page.clock.fastForward(1000); m += 3; await fix(page, m); }
    await finishAndSave(page);
    check('A dropout with the screen on: "GPS dropped out for 0:45", without blaming the screen', /^GPS dropped out for 0:4\d during this run/.test(await txt(page, '#summaryGpsNote')), await txt(page, '#summaryGpsNote'));
    await page.close();
  }
  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
