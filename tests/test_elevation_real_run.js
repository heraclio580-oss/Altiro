const fs = require('fs');
const path = require('path');
const http = require('http');

// The climb from terrain data on a real run: a tester's 4-mile hilly run (6,527 m) beside a Garmin, whose
// barometer said 236 ft up. The terrain heights the app was given along that run (every 20 m, as they came
// -- heights only, no places) are replayed on a straight pretend route of the same length. Smoothing them
// over 180 m and counting 3 m said 220 ft; it should come out close to the watch (within 225-245 ft),
// while flat routes still read flat (see test_elevation.js). Skipped where Playwright isn't installed.
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
const LAT0 = 37.7749, LNG0 = -122.4194, M_LAT = 1/111195;
// The run's terrain heights (m), one every 20 m from the start.
const HEIGHTS = [524, 524, 530, 530, 530, 530, 524, 530, 530, 530, 530, 530, 530, 530, 530, 530, 530, 532, 532, 532, 532, 532, 530, 530, 530, 530, 527, 527, 527, 527, 525, 525, 525, 525, 523, 523, 523, 523, 525, 525, 525, 525, 525, 527, 527, 527, 527, 527, 527, 527, 527, 527, 528, 528, 528, 528, 528, 530, 530, 530, 530, 530, 534, 534, 534, 534, 537, 537, 537, 540, 540, 540, 540, 546, 546, 546, 546, 542, 542, 542, 542, 549, 549, 549, 549, 544, 544, 544, 544, 536, 536, 536, 536, 533, 533, 533, 533, 533, 533, 533, 537, 537, 537, 537, 537, 537, 537, 537, 537, 537, 537, 537, 533, 533, 533, 533, 533, 533, 528, 528, 528, 528, 528, 526, 526, 526, 526, 525, 525, 525, 525, 525, 522, 522, 522, 522, 522, 519, 519, 519, 519, 517, 517, 517, 517, 517, 514, 514, 514, 514, 514, 514, 514, 514, 514, 512, 512, 512, 512, 512, 512, 514, 514, 514, 514, 513, 513, 513, 513, 512, 512, 512, 512, 511, 510, 510, 510, 510, 510, 512, 512, 512, 512, 512, 508, 508, 508, 508, 508, 505, 506, 506, 506, 506, 504, 504, 504, 504, 503, 503, 502, 502, 502, 502, 500, 500, 501, 501, 501, 501, 501, 501, 499, 499, 499, 499, 499, 501, 499, 499, 499, 499, 497, 497, 496, 496, 496, 496, 498, 498, 498, 498, 499, 499, 499, 499, 499, 505, 505, 505, 505, 504, 504, 504, 504, 508, 508, 508, 508, 508, 509, 509, 509, 509, 509, 512, 512, 516, 516, 516, 523, 523, 523, 517, 517, 517, 517, 513, 513, 513, 513, 513, 513, 511, 511, 513, 514, 510, 510, 510, 510, 509, 509, 509, 513, 509, 509, 509, 509, 509, 509, 507, 507, 510, 510, 510, 510, 508, 508, 513, 513, 513, 513, 513, 518, 518, 518, 518, 528, 528, 528, 528, 525, 525, 525, 525, 530, 530, 530, 530, 530, 543, 537, 537, 527, 527, 524, 524];
const terrainAt = d=>{ const x = Math.max(0, d)/20, i = Math.min(HEIGHTS.length-2, Math.floor(x)), f = Math.min(1, x-i); return HEIGHTS[i] + (HEIGHTS[i+1]-HEIGHTS[i])*f; };
const RUN_M = 6527;


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
  const page = await (await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true })).newPage();
  const errors = [];
  page.on('pageerror', e=> errors.push(e.message));
  await page.route(u=> !u.href.startsWith(base), r=> r.abort());
  await page.route(/maplibre-gl\.js$/, r=> r.abort());
  await page.route(/api\.open-meteo\.com\/v1\/elevation/, r=>{
    const lats = new URL(r.request().url()).searchParams.get('latitude').split(',').map(Number);
    r.fulfill({status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body: JSON.stringify({elevation: lats.map(la=> +terrainAt((la-LAT0)/M_LAT).toFixed(1))})});
  });
  await page.clock.install({time: new Date('2026-09-19T08:00:00')});
  await page.addInitScript(()=>{
    window.__ALTIRO_TEST_TODAY__ = '2026-09-19';
    window.speechSynthesis.speak = ()=>{};
    window.__geo = {cb:null};
    navigator.geolocation.watchPosition = cb=>{ window.__geo.cb = cb; return 7; };
    navigator.geolocation.clearWatch = ()=>{ window.__geo.cb = null; };
    window.__fix = (lat, lng)=>{ if(window.__geo.cb) window.__geo.cb({coords:{latitude:lat, longitude:lng, accuracy:5}, timestamp: Date.now()}); };
  });
  await page.goto(base + 'index.html?proto');
  await sleep(400);
  await page.clock.pauseAt(new Date('2026-09-19T08:05:00'));
  await page.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); document.documentElement.classList.remove('proto-on'); });
  await sleep(200);
  if(!(await page.evaluate(()=>{ const e = document.getElementById('trackRunBtn'); return !!e && !e.closest('[hidden]'); }))) await page.tap('#homeMoreBtn');
  await page.tap('#trackRunBtn');
  await page.evaluate(([la, ln])=> window.__fix(la, ln), [LAT0, LNG0]);
  await page.tap('#gpsStartBtn');
  // North in a straight line, 20 m every 6 s, the run's whole length.
  for(let m=20; m<=RUN_M; m+=20){ await page.clock.fastForward(6000); await page.evaluate(([la, ln])=> window.__fix(la, ln), [LAT0 + m*M_LAT, LNG0]); }
  await page.evaluate(()=> document.getElementById('gpsHoldFinish').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
  await page.clock.fastForward(1300);
  await page.clock.resume();
  let g = 0;
  for(let i=0; i<40 && !(g>0 && await page.evaluate(()=> !document.getElementById('logPerfElevNote').hidden)); i++){ await sleep(150); g = +(await page.evaluate(()=> document.getElementById('logPerfElevGainInput').value)); }
  check('A real hilly 4-mile run (Garmin: 236 ft up): the climb from terrain data comes out close (225-245 ft)', g>=225 && g<=245, `${g} ft`);
  check('No page errors', errors.length===0, errors.join(' | '));
  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
