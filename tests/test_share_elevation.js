const fs = require('fs');
const path = require('path');
const http = require('http');

// A tracked run's elevation on its share card: a soft grey hill behind the route (so the route keeps its
// room), with its low and high points under it, on the post and the story, with every split still on the card (a 4.5-mile hilly run, five splits). The
// climb's tile says "Climb" (it fits); the Elevation chip turns the strip off and on, and is remembered.
// Set SHARE_ELEV_OUT=<folder> to keep the pictures. Skipped without Playwright.
let chromium;
for(const p of ['playwright', '/opt/node22/lib/node_modules/playwright']){ try{ ({ chromium } = require(p)); break; }catch(e){} }
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f=> fs.existsSync(f));
if(!chromium){ console.log('(Playwright not installed -- skipped)'); process.exit(0); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const www = path.join(__dirname, '..', 'www');
const outDir = process.env.SHARE_ELEV_OUT;
const LAT0 = 33.6681, LNG0 = -117.3273, M_LAT = 1/111195;

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
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e=> errors.push(e.message));
  await page.route(u=> !u.href.startsWith(base), r=> r.abort());
  await page.route(/maplibre-gl\.js$/, r=> r.abort());
  await page.clock.install({time: new Date('2026-09-19T08:00:00')});
  await page.addInitScript(()=>{
    window.__ALTIRO_TEST_TODAY__ = '2026-09-19';
    window.__geo = {cb:null};
    navigator.geolocation.watchPosition = cb=>{ window.__geo.cb = cb; return 7; };
    navigator.geolocation.clearWatch = ()=>{ window.__geo.cb = null; };
    navigator.geolocation.getCurrentPosition = cb=> setTimeout(()=> cb({coords:{latitude:33.6681, longitude:-117.3273, accuracy:10}, timestamp: Date.now()}), 10);
    window.__fix = (lat, lng, alt)=>{ if(window.__geo.cb) window.__geo.cb({coords:{latitude:lat, longitude:lng, accuracy:6, altitude:alt, altitudeAccuracy:3}, timestamp: Date.now()}); };
    Object.defineProperty(navigator, 'wakeLock', {configurable:true, value:{request: async()=>({release: async()=>{}})}});
  });
  await page.goto(base + 'index.html?proto');
  await sleep(400);
  await page.clock.pauseAt(new Date('2026-09-19T08:05:00'));
  await page.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); document.documentElement.classList.remove('proto-on'); });
  await sleep(200);
  if(!(await page.evaluate(()=>{ const e = document.getElementById('trackRunBtn'); return !!e && !e.closest('[hidden]'); }))) await page.tap('#homeMoreBtn');
  await page.tap('#trackRunBtn');
  await sleep(100);

  // A loop with two hills: 4.5 miles, a fix every 4 s, climbing to about 50 m above the start and back.
  let east = 0, north = 0, d = 0;
  const MILE = 1609.344, total = 4.51*MILE;
  const altAt = d=> 500 + 45*Math.max(0, Math.sin(d/total*Math.PI*2)) + 20*Math.sin(d/total*Math.PI*6);
  const fix = ()=> page.evaluate(([la, ln, al])=> window.__fix(la, ln, al), [LAT0 + north*M_LAT, LNG0 + east*M_LAT/Math.cos(LAT0*Math.PI/180), altAt(d)]);
  await fix();
  await page.tap('#gpsStartBtn');
  while(d < total){
    const mile = Math.floor(d/MILE) + 1;
    const step = (mile===3 ? 5.6 : 4.8 + (mile%2)*0.2) * 4;
    const heading = d/900;
    east += step*Math.cos(heading); north += step*Math.sin(heading); d += step;
    await page.clock.fastForward(4000);
    await fix();
  }
  await page.evaluate(()=> document.getElementById('gpsHoldFinish').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
  await page.clock.fastForward(1300);
  await sleep(100);
  await page.tap('#saveLogPerf');
  await sleep(300);
  await page.clock.resume();

  await page.evaluate(()=>{
    window.__drawn = [];
    const f = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y){
      window.__drawn.push({text: String(text), x, y, w: this.measureText(text).width, align: this.textAlign, fill: String(this.fillStyle), cw: this.canvas.width, ch: this.canvas.height});
      return f.apply(this, arguments);
    };
  });
  await page.tap('#shareWorkoutBtn');
  const preview = ()=> page.evaluate(()=>{ const i = document.getElementById('shareCardPreview'); return {h:i.naturalHeight, src:i.src, complete:i.complete}; });
  let last = '';
  const waitCard = async h=>{ let pv; for(let i=0; i<60; i++){ pv = await preview(); if(pv.complete && pv.h===h && pv.src!==last) break; await sleep(100); } last = pv.src; await sleep(200); return (await page.evaluate(()=> window.__drawn.splice(0))).filter(t=> t.cw===1080); };
  const save = async name=>{
    if(!outDir) return;
    fs.mkdirSync(outDir, {recursive:true});
    const b64 = await page.evaluate(async ()=>{ const r = await fetch(document.getElementById('shareCardPreview').src); const b = await r.blob(); return await new Promise(res=>{ const fr = new FileReader(); fr.onload = ()=> res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }); });
    fs.writeFileSync(path.join(outDir, name), Buffer.from(b64, 'base64'));
  };
  const chip = ()=> page.evaluate(()=>{ const c = document.getElementById('shareElevChip'); return {hidden: c.hidden, on: c.classList.contains('sel'), text: c.textContent}; });
  check('The share sheet has an Elevation chip, on', (await chip()).hidden===false && (await chip()).on && (await chip()).text==='Elevation', JSON.stringify(await chip()));
  for(const [fmt, h] of [['post', 1350], ['story', 1920]]){
    if(fmt==='story') await page.tap('[data-share-format="story"]');
    const texts = await waitCard(h);
    const low = texts.find(t=> /^Low \d/.test(t.text)), high = texts.find(t=> /^High \d/.test(t.text));
    check(`${fmt}: the elevation's low and high points are on the card`, !!low && !!high && /ft$/.test(low.text) && /ft$/.test(high.text), texts.map(t=> t.text).join(' | ').slice(0, 300));
    check(`${fmt}: ...inside the card's margins`, !!low && !!high && low.x>=80 && low.x+low.w<=1000+1 && high.x-high.w>=80-1 && high.x<=1000+1);
    const labels = texts.filter(t=> /^Mile \d+$|^0\.\d+ mi$/.test(t.text)).map(t=> t.text);
    check(`${fmt}: every split is still on the card`, labels.length===5 && labels.includes('Mile 4') && !texts.some(t=> /more$/.test(t.text)), labels.join(','));
    check(`${fmt}: ...the climb's tile says CLIMB, in full`, texts.some(t=> t.text==='CLIMB') && !texts.some(t=> /^ELEVATION/.test(t.text)));
    // (The body is drawn on its own layer, as tall as the space above the footer: nothing past its bottom.)
    const body = texts.filter(t=> t.ch!==h);
    check(`${fmt}: nothing runs past the space above the footer`, body.length>0 && body.every(t=> t.y <= t.ch), body.filter(t=> t.y > t.ch).map(t=> t.text).join(','));
    await save(`elev-${fmt}.jpg`);
  }
  // Off: no strip; the route gets its room back.
  await page.tap('#shareElevChip');
  let texts = await waitCard(1920);
  check('Elevation chip off: no strip on the card', !texts.some(t=> /^Low |^High /.test(t.text)) && !(await chip()).on);
  await save('no-elev-story.jpg');
  check('...remembered for next time', await page.evaluate(()=> localStorage.getItem('altiro_share_elev'))==='0');
  await page.tap('#shareElevChip');
  texts = await waitCard(1920);
  check('...and back on', texts.some(t=> /^Low /.test(t.text)));
  // In Spanish.
  await page.evaluate(()=>{ document.getElementById('closeShareCard').click(); document.querySelector('.lang-btn[data-lang="es"]').click(); });
  await sleep(100);
  await page.tap('#shareWorkoutBtn');
  last = '';
  texts = await waitCard(1920);
  check('In Spanish: Elevación, Mín / Máx and SUBIDA', (await chip()).text==='Elevación' && texts.some(t=> /^Mín \d/.test(t.text)) && texts.some(t=> /^Máx \d/.test(t.text)) && texts.some(t=> t.text==='SUBIDA'), texts.map(t=> t.text).join(' | ').slice(0, 300));
  check('No page errors', errors.length===0, errors.join(' | '));
  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
