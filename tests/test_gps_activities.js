const fs = require('fs');
const path = require('path');
const http = require('http');

// The GPS tracker for walks, hikes and bike rides, in a real browser with a pretend GPS and a fake clock:
// before Start it asks what's being tracked (Run, Walk, Hike, Bike ride). A ride reads in speed (mph), keeps
// a pace no runner could (30 mph), and splits every 5 miles; it's saved as a Bike ride. A walk reads in
// pace, is saved as a Walk, and isn't running miles. Skipped without Playwright.
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
  // On a day that isn't a run, the GPS button is under the Today card's More.
  const tapTrack = async (page)=>{ if(!(await page.evaluate(()=>{ const e = document.getElementById('trackRunBtn'); return !!e && !e.closest('[hidden]'); }))) await page.tap('#homeMoreBtn'); await page.tap('#trackRunBtn'); };


  // ---- A bike ride nobody planned, from Today ----
  {
    const {page, errors} = await openApp();
    await tapTrack(page);
    await sleep(100);
    const acts = await page.evaluate(()=> [...document.querySelectorAll('#gpsActRow [data-gps-act]')].map(b=> b.textContent.trim()));
    check('The tracker asks what it is before Start: Run, Walk, Hike, Bike ride', acts.join('|')==='Run|Walk|Hike|Bike ride', acts.join('|'));
    check('...a run to begin with', await page.evaluate(()=> document.querySelector('#gpsActRow [data-gps-act="run"]').getAttribute('aria-checked'))==='true');
    await page.tap('#gpsActRow [data-gps-act="ride"]');
    check('Bike ride picked: the header says so', /Bike ride · GPS/.test(await txt(page, '#gpsTitleEl')), await txt(page, '#gpsTitleEl'));
    check('Bike ride picked: speed (mph) instead of pace', /Speed \(mph\)/.test(await txt(page, '#gpsPaceLabel')) && /Avg speed/i.test(await txt(page, '#gpsAvgPaceLabel')), await txt(page, '#gpsPaceLabel'));
    await fix(page, 0, 8);
    await page.tap('#gpsStartBtn');
    check('Started: the choice is put away', !(await shown(page, '#gpsActRow')));
    // About 13.5 m/s (30 mph, faster than any runner: kept for a ride), a fix every second, 5.6 miles.
    for(let i=1; i<=670; i++){ await page.clock.fastForward(1000); await fix(page, i*13.5); }
    const sp = await txt(page, '#gpsPace'), avg = await txt(page, '#gpsAvgPace'), d = await txt(page, '#gpsDist');
    check('Riding: 5.6 mi, 30 mph now and on average', /^5\.6\d$/.test(d) && /^30\.\d$/.test(sp) && /^30\.\d$/.test(avg), `${d} ${sp} ${avg}`);
    await page.evaluate(()=> document.getElementById('gpsHoldFinish').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
    await page.clock.fastForward(1300);
    await sleep(100);
    check('Finished: Log Performance for it', await shown(page, '#logPerfOverlay'));
    await page.tap('#saveLogPerf');
    await sleep(300);
    const stats = await txt(page, '#summaryStats'), splits = await txt(page, '#summarySplits');
    check('Its summary: average speed, 30 mph', /Avg speed/i.test(stats) && /30\.\d mph/.test(stats), stats);
    check('...splits every 5 miles, in mph: "Mile 5  30.x mph"', /Mile 5\s*30\.\d mph/.test(splits) && !/Mile 1\b/.test(splits), splits);
    const saved = await page.evaluate(()=> document.getElementById('summarySessTitle') ? document.getElementById('summarySessTitle').textContent : document.getElementById('screen-summary').textContent.slice(0, 200));
    check('...saved as a Bike ride', /Bike ride/.test(saved), saved);
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- A walk ----
  {
    const {page, errors} = await openApp();
    await tapTrack(page);
    await sleep(100);
    await page.tap('#gpsActRow [data-gps-act="walk"]');
    check('Walk picked: pace, as for a run', /Pace/.test(await txt(page, '#gpsPaceLabel')));
    await fix(page, 0, 8);
    await page.tap('#gpsStartBtn');
    for(let i=1; i<=120; i++){ await page.clock.fastForward(7000); await fix(page, i*10); } // about 1.4 m/s
    await page.evaluate(()=> document.getElementById('gpsHoldFinish').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
    await page.clock.fastForward(1300);
    await sleep(100);
    await page.tap('#saveLogPerf');
    await sleep(300);
    const stats = await txt(page, '#summaryStats');
    check('Saved as a Walk, with its pace (about 19 min/mi)', /Walk/.test(await page.evaluate(()=> document.getElementById('screen-summary').textContent)) && /1[89]:\d\d\/mi/.test(stats), stats);
    await page.clock.resume();
    await page.evaluate(()=> [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click());
    await sleep(200);
    const dist = await txt(page, '#ovDistanceVal');
    check('...and it doesn\'t count as running miles', /^0(\.0)?\//.test(dist || '0/'), dist);
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
