const fs = require('fs');
const path = require('path');
const http = require('http');

// GPS distance with a realistic, noisy signal: a walk out and a run back along a straight street (like
// the one compared against a Garmin: 0.27 mi on the watch, 0.31 in Altiro before smoothing), with the
// phone's readings wandering a few metres to each side -- more while running, with the phone bouncing.
// The distance should come out close to the real one, not inflated by the wobble. Skipped without Playwright.
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
  let seed = 3; const rnd = ()=>{ seed = (seed*16807) % 2147483647; return seed/2147483647; };
  const gauss = ()=> Math.sqrt(-2*Math.log(rnd()+1e-12))*Math.cos(2*Math.PI*rnd());
  const results = [];
  for(const trial of [1, 2, 3]){
    seed = 11 + trial*977;
    const {page} = await openApp();
    await tapTrack(page);
    await sleep(100);
    await fix(page, 0, 6);
    await page.tap('#gpsStartBtn');
    // 217 m out at a walk (1.35 m/s), 217 m back at a run (3.2 m/s), a reading every second. The error
    // drifts slowly (as GPS does) plus a jitter, bigger while running.
    let s = 0, ex = 0, ey = 0, back = false;
    while(true){
      const v = back ? 3.2 : 1.35;
      s += v;
      if(!back && s >= 217){ back = true; }
      if(s >= 434) break;
      ex = 0.95*ex + 0.31*2.5*gauss(); ey = 0.95*ey + 0.31*2.5*gauss();
      const j = back ? 1.5 : 0.6;
      const along = back ? 434 - s : s;
      await page.clock.fastForward(1000);
      await fix(page, along + ey + j*gauss(), 6, ex + j*gauss());
    }
    await page.clock.fastForward(1000);
    await fix(page, 0, 6);
    await page.tap('#gpsStartBtn'); // pause
    const d = parseFloat(await txt(page, '#gpsDist'));
    results.push(d);
    await page.close();
  }
  const real = 434/1609.344;
  const worst = Math.max(...results.map(d=> Math.abs(d-real)/real));
  check(`A noisy walk out and run back of ${real.toFixed(2)} mi comes out within 7% each time`, worst <= 0.07, results.join(', '));
  check('...and isn\'t inflated by the wobble on average', results.reduce((a,b)=>a+b,0)/results.length <= real*1.05, results.join(', '));
  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
