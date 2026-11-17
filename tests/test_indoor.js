const fs = require('fs');
const path = require('path');
const http = require('http');

// Indoors -- a treadmill run or walk, a spin bike -- in a real browser with a fake clock:
// - the tracker's Indoor switch (a run, walk or ride; not a hike): no GPS (none is asked for, a fix that
//   comes in anyway counts nothing), no map or distance -- just the timer -- and "Treadmill run" /
//   "Indoor ride" at the top;
// - finished, Log Performance has its time, and asks for the distance from the machine (it won't save
//   without one); saved, it's "Treadmill run" with no route or splits, counted in the week's miles.
// (From a watch: see test_indoor_watch.js.) Skipped without Playwright.
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

  async function openApp(lang){
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e=> errors.push(e.message));
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    await page.route(/maplibre-gl\.js$/, r=> r.abort());
    await page.clock.install({time: new Date('2026-09-19T08:00:00')});
    await page.addInitScript(lang=>{
      window.__ALTIRO_TEST_TODAY__ = '2026-09-19';
      if(lang) localStorage.setItem('altiro_lang', lang);
      window.__geo = {cb:null, watches:0, cleared:0};
      navigator.geolocation.watchPosition = (cb)=>{ window.__geo.cb = cb; window.__geo.watches++; return 7; };
      navigator.geolocation.clearWatch = ()=>{ window.__geo.cb = null; window.__geo.cleared++; };
      navigator.geolocation.getCurrentPosition = cb=> setTimeout(()=> cb({coords:{latitude:37.7749, longitude:-122.4194, accuracy:12}, timestamp: Date.now()}), 10);
      window.__fix = (lat, lng)=>{ if(window.__geo.cb) window.__geo.cb({coords:{latitude:lat, longitude:lng, accuracy:5}, timestamp: Date.now()}); };
      window.__said = [];
      try{ window.speechSynthesis.speak = u=> window.__said.push(u.text); }catch(e){}
    }, lang || null);
    await page.goto(base + 'index.html?proto');
    await sleep(400);
    await page.clock.pauseAt(new Date('2026-09-19T08:05:00'));
    await page.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); document.documentElement.classList.remove('proto-on'); });
    await sleep(200);
    return {ctx, page, errors};
  }
  const txt = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g,' ').trim() : null; }, sel);
  const shown = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); if(!e || e.hidden || e.closest('[hidden]')) return false; return getComputedStyle(e).display!=='none'; }, sel);
  const openTracker = async page=>{
    await page.evaluate(()=>{ const b = document.getElementById('trackRunBtn'); if(b.closest('[hidden]')) document.getElementById('homeMoreBtn').click(); });
    await page.evaluate(()=> document.getElementById('trackRunBtn').click());
    await sleep(150);
  };
  const finish = async page=>{
    await page.evaluate(()=> document.getElementById('gpsHoldFinish').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
    await page.clock.fastForward(1300);
    await sleep(150);
  };

  // ---- A treadmill run, timed ----
  {
    const {ctx, page, errors} = await openApp();
    await openTracker(page);
    check('The tracker has an "Indoor (treadmill)" switch, off', await shown(page, '#gpsIndoorRow') && (await txt(page, '#gpsIndoorLabel'))==='Indoor (treadmill)' && await page.evaluate(()=> document.getElementById('gpsIndoorToggle').getAttribute('aria-checked'))==='false');
    const watchesBefore = await page.evaluate(()=> window.__geo.watches);
    check('...GPS is looked for, as before', watchesBefore>=1 && /Finding GPS|GPS ready/.test(await txt(page, '#gpsSignal')));
    await page.tap('#gpsIndoorToggle');
    check('Indoor on: GPS stopped', await page.evaluate(()=> window.__geo.cleared>=1 && !window.__geo.cb));
    check('..."Treadmill run" at the top, and "Indoor" where the GPS signal was', (await txt(page, '#gpsTitleEl'))==='Treadmill run' && (await txt(page, '#gpsSignal'))==='Indoor');
    check('...no map: a note to add the treadmill\'s distance at the end', !(await shown(page, '#gpsMap')) && await shown(page, '#gpsIndoorBox') && /add the distance from the treadmill's screen/.test(await txt(page, '#gpsIndoorNote')));
    check('...no distance or pace while it runs (just the timer)', !(await shown(page, '#gpsDist')) && await shown(page, '#gpsTime'));
    check('...and no keep-the-screen-on note (that\'s about GPS)', !(await shown(page, '#gpsNote')));
    // Bike ride: the spin bike; a hike can't be indoors.
    await page.evaluate(()=> document.querySelector('[data-gps-act="ride"]').click());
    check('A bike ride: "Indoor (spin bike)", "Indoor ride"', (await txt(page, '#gpsIndoorLabel'))==='Indoor (spin bike)' && (await txt(page, '#gpsTitleEl'))==='Indoor ride' && /bike's screen/.test(await txt(page, '#gpsIndoorNote')));
    await page.evaluate(()=> document.querySelector('[data-gps-act="hike"]').click());
    const hk = {row: await shown(page, '#gpsIndoorRow'), map: await shown(page, '#gpsMap'), gps: await page.evaluate(()=> !!window.__geo.cb)};
    check('A hike: no Indoor switch, and back to GPS', !hk.row && hk.map && hk.gps, JSON.stringify(hk));
    await page.evaluate(()=> document.querySelector('[data-gps-act="run"]').click());
    await page.tap('#gpsIndoorToggle');
    const w0 = await page.evaluate(()=> window.__geo.watches);
    await page.tap('#gpsStartBtn');
    check('Start: the timer runs, GPS still off', (await txt(page, '#gpsStartBtn'))==='Pause' && await page.evaluate(()=> window.__geo.watches)===w0);
    check('...the switch is gone once started', !(await shown(page, '#gpsIndoorRow')));
    await page.clock.fastForward(32*60000 + 15000);
    await page.evaluate(()=> window.__fix(37.80, -122.40)); // (a stray fix: counts nothing)
    check('32:15 on the clock', (await txt(page, '#gpsTime'))==='32:15', await txt(page, '#gpsTime'));
    check('...and the pocket lock isn\'t offered (no GPS to keep going)', !(await shown(page, '#gpsLockBtn')));
    await finish(page);
    check('Finished: Log Performance, with the time', await shown(page, '#logPerfOverlay') && Number(await page.evaluate(()=> document.getElementById('logPerfTimeMInput').value))===32 && Number(await page.evaluate(()=> document.getElementById('logPerfTimeSInput').value))===15);
    check('...the distance empty, asking for the treadmill\'s', (await page.evaluate(()=> document.getElementById('logPerfDistanceInput').value))==='' && await shown(page, '#logPerfIndoorNote') && /treadmill's screen/.test(await txt(page, '#logPerfIndoorNote')));
    check('...no route', !(await shown(page, '#logPerfRoute')));
    await page.tap('#saveLogPerf');
    await sleep(150);
    check('Save with no distance: it asks for it, and stays open', await shown(page, '#logPerfOverlay'));
    await page.fill('#logPerfDistanceInput', '3.6');
    await page.tap('#saveLogPerf');
    await sleep(300);
    check('With the distance: saved -- Summary, "Treadmill run"', await shown(page, '#screen-summary') && /^Treadmill run/.test(await txt(page, '#summarySessTitle')), await txt(page, '#summarySessTitle'));
    check('...3.6 mi at about 8:58/mi, no route or splits', /3\.6/.test(await txt(page, '#summaryStats')) && /8:5[678]/.test(await txt(page, '#summaryStats')) && !(await shown(page, '#summaryRouteCard')), await txt(page, '#summaryStats'));
    await page.evaluate(()=> [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='calendar').click());
    await sleep(100);
    await page.evaluate(()=> document.querySelector('#screen-calendar .mo-cell[data-date="2026-09-19"]').click());
    await sleep(150);
    const day = await txt(page, '#dayDetailOverlay');
    check('Calendar: today has "Treadmill run", done', /Treadmill run/.test(day) && /Done/.test(day), day);
    await page.evaluate(()=> document.getElementById('closeDayDetail').click());
    await page.evaluate(()=> [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='progress').click());
    await sleep(150);
    check('It counts in the week\'s miles (Progress)', /3\.6 mi/.test(await txt(page, '#screen-progress')));
    check('No page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }

  // ---- Too short, and Spanish ----
  {
    const {ctx, page} = await openApp('es');
    await openTracker(page);
    check('In Spanish: "Interior (caminadora)"', (await txt(page, '#gpsIndoorLabel'))==='Interior (caminadora)');
    await page.tap('#gpsIndoorToggle');
    check('...and "Carrera en caminadora", "Interior"', (await txt(page, '#gpsTitleEl'))==='Carrera en caminadora' && (await txt(page, '#gpsSignal'))==='Interior');
    await page.evaluate(()=> document.querySelector('[data-gps-act="ride"]').click());
    check('...a ride: "Interior (bici estática)", "Bici estática"', (await txt(page, '#gpsIndoorLabel'))==='Interior (bici estática)' && (await txt(page, '#gpsTitleEl'))==='Bici estática');
    await page.tap('#gpsStartBtn');
    await page.clock.fastForward(20000);
    await finish(page);
    check('Finished after 20 seconds: too short, still tracking', await shown(page, '#gpsOverlay') && /Sigue un poco más/.test(await txt(page, '#toastMsg') || ''), await txt(page, '#toastMsg'));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
