const fs = require('fs');
const path = require('path');
const http = require('http');

// Elevation on GPS runs, in a real browser with a pretend GPS (with altitude, and some wobble), a fake
// clock, and a stand-in for the terrain-data service: the tracker shows the climb and descent as it goes
// (wobble on the flat doesn't count), finishing checks the route against terrain data and uses that,
// Log Performance has the gain/loss fields (feet with miles, meters with km), and the Summary and the share
// card show them, with a profile. Offline, the phone's own numbers stay. A run without GPS can have its
// elevation typed in. Skipped where Playwright/Chromium isn't installed.
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
// The trail: 1 km climbing 100 m, then 600 m down 60 m.
const height = d => d<=1000 ? d*0.1 : 100 - (d-1000)*0.1;
const wobble = i => [0, 2.5, -2, 3, -3, 1, -2.5, 2, -1, 0][i%10];

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
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const errors = [], asked = [];
    page.on('pageerror', e=> errors.push(e.message));
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    await page.route(/maplibre-gl\.js$/, r=> r.abort());
    if(!opts.offline) await page.route(/api\.open-meteo\.com\/v1\/elevation/, r=>{
      const u = new URL(r.request().url());
      const lats = u.searchParams.get('latitude').split(',').map(Number);
      asked.push(lats.length);
      // Terrain data: the same trail, but its true climb is 120 m and descent 72 m.
      r.fulfill({status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*'},
        body: JSON.stringify({elevation: lats.map(la=> +((opts.terrain || (d=> 1.2*height(d)))((la-LAT0)/M_LAT)).toFixed(1))})});
    });
    await page.clock.install({time: new Date('2026-09-19T08:00:00')});
    await page.addInitScript(o=>{
      window.__ALTIRO_TEST_TODAY__ = '2026-09-19';
      if(o.unit) localStorage.setItem('altiro_dist_unit', o.unit);
      window.speechSynthesis.speak = ()=>{};
      window.__geo = {cb:null};
      navigator.geolocation.watchPosition = cb=>{ window.__geo.cb = cb; return 7; };
      navigator.geolocation.clearWatch = ()=>{ window.__geo.cb = null; };
      window.__fix = (lat, lng, alt)=>{ if(window.__geo.cb) window.__geo.cb({coords:{latitude:lat, longitude:lng, accuracy:6, altitude:alt, altitudeAccuracy:8}, timestamp: Date.now()}); };
    }, opts);
    await page.goto(base + 'index.html?proto');
    await sleep(400);
    await page.clock.pauseAt(new Date('2026-09-19T08:05:00'));
    await page.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); document.documentElement.classList.remove('proto-on'); });
    await sleep(200);
    return {page, errors, asked};
  }
  const txt = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g,' ').trim() : null; }, sel);
  const shown = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]'); }, sel);
  const val = (page, id)=> page.evaluate(i=> document.getElementById(i).value, id);
  // On a day that isn't a run, the GPS button is under the Today card's More.
  const tapTrack = async (page)=>{ if(!(await page.evaluate(()=>{ const e = document.getElementById('trackRunBtn'); return !!e && !e.closest('[hidden]'); }))) await page.tap('#homeMoreBtn'); await page.tap('#trackRunBtn'); };
  async function trailRun(page){
    await tapTrack(page);
    await page.evaluate(([la, ln, a])=> window.__fix(la, ln, a), [LAT0, LNG0, 0]);
    await page.tap('#gpsStartBtn');
    for(let i=1; i<=160; i++){
      await page.clock.fastForward(2000);
      await page.evaluate(([la, ln, a])=> window.__fix(la, ln, a), [LAT0 + i*10*M_LAT, LNG0, height(i*10) + wobble(i)]);
      if(i===40) for(let k=0; k<6; k++){ await page.clock.fastForward(1000); } // standing still a moment
    }
  }
  async function finish(page){
    await page.evaluate(()=> document.getElementById('gpsHoldFinish').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
    await page.clock.fastForward(1300);
    for(let i=0; i<20; i++){ await sleep(50); await page.clock.runFor(10); }
  }

  // ---- A trail run, in miles ----
  {
    const {page, errors, asked} = await openApp();
    await trailRun(page);
    const live = await txt(page, '#gpsElev');
    const m = live && live.match(/↑ ([\d,]+) ft · ↓ ([\d,]+) ft/);
    const up = m ? +m[1].replace(',', '') : 0, down = m ? +m[2].replace(',', '') : 0;
    check('While running: elevation climbed and descended, in feet (about 328 ft up, 197 down; GPS wobble not counted)', !!m && up>=270 && up<=360 && down>=150 && down<=220, live);
    await finish(page);
    check('Finishing checks the route against terrain data (a few hundred sample points)', asked.length>=1 && asked.reduce((a,b)=>a+b,0)>=80, JSON.stringify(asked));
    check('Log Performance has elevation gain / loss in ft', /Elevation gain \/ loss \(ft\)/.test(await txt(page, '#logPerfElevSection')));
    const g = +(await val(page, 'logPerfElevGainInput')), l = +(await val(page, 'logPerfElevLossInput'));
    // (The run starts at its first point after Start, 10 m along: terrain 1.2 m up -> 120 m, then down to 48 m.)
    // (Terrain is averaged over ~120 m of route, which rounds off the sharp top of this hill a little:
    // within about 7%.)
    check('...filled from the terrain data: about 118 m up = ~388 ft, 71 m down = ~234 ft', g>=360 && g<=393 && l>=210 && l<=238, `${g} / ${l}`);
    const G = g, Lo = l;
    check('...saying it was checked against terrain data', await shown(page, '#logPerfElevNote') && /terrain data/.test(await txt(page, '#logPerfElevNote')));
    await page.tap('#saveLogPerf'); await sleep(300);
    const stats = await txt(page, '#summaryStats');
    check('The Summary shows the same Elevation Gain and Loss', stats.includes(`Elevation Gain${G} ft`) && stats.includes(`Elevation Loss${Lo} ft`), stats);
    check('...with an elevation profile, low to high', await shown(page, '#summaryElevProfile') && /Low ([4-9]|1\d|2[0-5]) ft/.test(await txt(page, '#summaryElevProfile')) && /High 3[6-9]\d ft/.test(await txt(page, '#summaryElevProfile')), await txt(page, '#summaryElevProfile'));
    await page.clock.resume();
    await page.tap('#shareWorkoutBtn');
    let alt = '';
    for(let i=0; i<60; i++){ alt = await page.evaluate(()=>{ const i = document.getElementById('shareCardPreview'); return i.complete && i.naturalHeight===1350 ? i.alt : ''; }); if(alt) break; await sleep(100); }
    check('The share card shows the climb', alt.includes(`Elevation Gain: ↑ ${G} ft`), alt);
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- In km: meters ----
  {
    const {page, errors} = await openApp({unit: 'km'});
    await trailRun(page);
    check('In km, the tracker shows meters', /↑ \d+ m · ↓ \d+ m/.test(await txt(page, '#gpsElev')), await txt(page, '#gpsElev'));
    await finish(page);
    const gm = +(await val(page, 'logPerfElevGainInput')), lm = +(await val(page, 'logPerfElevLossInput'));
    check('...and Log Performance asks in meters: about 118 up, 71 down', /\(m\)/.test(await txt(page, '#logPerfElevSection')) && gm>=110 && gm<=120 && lm>=64 && lm<=72, `${gm} / ${lm}`);
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- Terrain data that steps up and down from square to square on a flat road ----
  // (Terrain data comes in 90 m squares, each a few metres off: counted as is, a flat run climbed
  // ~100 ft. A real 4-mile run came out at 482 ft against a Garmin's 236.)
  {
    const steps = [0, 3, -2, 4, -3, 1, -3, 2, -1, 3];
    const {page, errors} = await openApp({terrain: d=> 50 + steps[Math.floor(Math.max(0, d)/90) % 10]});
    await trailRun(page);
    await finish(page);
    const g = +(await val(page, 'logPerfElevGainInput'));
    check('Flat road, noisy terrain data: barely any climb counted (under 25 ft)', g < 25 && await shown(page, '#logPerfElevNote'), String(g));
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- A GPS dropout across a hill nobody ran over ----
  {
    // Flat ground, except a 40 m hill between 500 and 800 m -- where GPS dropped out (the route jumps
    // straight from 450 m to 850 m, as when the screen was off).
    const hill = d=> d>500 && d<800 ? 40*Math.sin(Math.PI*(d-500)/300) : 0;
    const {page, errors} = await openApp({terrain: d=> 30 + hill(d)});
    await tapTrack(page);
    await page.evaluate(([la, ln])=> window.__fix(la, ln, 30), [LAT0, LNG0]);
    await page.tap('#gpsStartBtn');
    for(let i=1; i<=45; i++){ await page.clock.fastForward(3000); await page.evaluate(([la, ln])=> window.__fix(la, ln, 30), [LAT0 + i*10*M_LAT, LNG0]); }
    await page.clock.fastForward(130000);
    for(let i=85; i<=130; i++){ await page.clock.fastForward(3000); await page.evaluate(([la, ln])=> window.__fix(la, ln, 30), [LAT0 + i*10*M_LAT, LNG0]); }
    await finish(page);
    const g = +(await val(page, 'logPerfElevGainInput'));
    check('A straight-line GPS gap doesn\'t count the hill under it (under 15 ft, not ~130)', g < 15 && await shown(page, '#logPerfElevNote'), String(g));
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- Offline: the phone's own numbers stay ----
  {
    const {page, errors} = await openApp({offline: true});
    await trailRun(page);
    await finish(page);
    const g = +(await val(page, 'logPerfElevGainInput'));
    check('No terrain data (offline): the GPS climb stays (about 328 ft)', g>=270 && g<=360 && !(await shown(page, '#logPerfElevNote')), String(g));
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- A run logged without GPS: elevation typed in ----
  {
    const {page, errors} = await openApp();
    await page.evaluate(()=>{
      const doc = document;
      doc.getElementById('addTodayWorkoutBtn').click();
      doc.getElementById('manualNameInput').value = 'Treadmill hills';
      doc.getElementById('manualNameInput').dispatchEvent(new Event('input', {bubbles:true}));
      [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
      doc.getElementById('saveManualEntry').click();
    });
    await sleep(100);
    await page.tap('#recordBtn'); await page.clock.fastForward(500); await sleep(100);
    check('A run\'s Log Performance has empty elevation fields', await shown(page, '#logPerfElevSection') && await val(page, 'logPerfElevGainInput')==='');
    await page.evaluate(()=>{ const e = document.getElementById('logPerfElevGainInput'); e.value = '500'; e.dispatchEvent(new Event('input', {bubbles:true})); });
    await page.tap('#saveLogPerf'); await sleep(300);
    const stats = await txt(page, '#summaryStats');
    check('Typing 500 ft: the Summary shows it (and no loss)', /Elevation Gain\s*500 ft/.test(stats) && !/Elevation Loss/.test(stats), stats);
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
