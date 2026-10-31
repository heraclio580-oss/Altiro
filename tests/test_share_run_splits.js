const fs = require('fs');
const path = require('path');
const http = require('http');

// Sharing a run tracked with GPS: the card shows just the route (no map behind it) and every split under
// the numbers, the fastest one in red -- a 9.6-mile long run's ten splits fit on both the post and the
// story, nothing cut off. Set SHARE_RUN_OUT=<folder> to keep the pictures. Skipped without Playwright.
let chromium;
for(const p of ['playwright', '/opt/node22/lib/node_modules/playwright']){ try{ ({ chromium } = require(p)); break; }catch(e){} }
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f=> fs.existsSync(f));
if(!chromium){ console.log('(Playwright not installed -- skipped)'); process.exit(0); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const www = path.join(__dirname, '..', 'www');
const outDir = process.env.SHARE_RUN_OUT;
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
    window.__fix = (lat, lng)=>{ if(window.__geo.cb) window.__geo.cb({coords:{latitude:lat, longitude:lng, accuracy:6}, timestamp: Date.now()}); };
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

  // A loop around a lake: 9.6 miles, a fix every 4 s. Mile 5 is run faster than the rest.
  let east = 0, north = 0;
  const fix = ()=> page.evaluate(([la, ln])=> window.__fix(la, ln), [LAT0 + north*M_LAT, LNG0 + east*M_LAT/Math.cos(LAT0*Math.PI/180)]);
  await fix();
  await page.tap('#gpsStartBtn');
  const MILE = 1609.344, total = 9.6*MILE;
  let d = 0;
  while(d < total){
    const mile = Math.floor(d/MILE) + 1;
    const step = (mile===5 ? 5.0 : 4.6 + (mile%3)*0.1) * 4; // metres in 4 s
    const heading = d/3000; // a slow curve
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
  const summary = await page.evaluate(()=> document.getElementById('summarySplits').textContent.replace(/\s+/g,' ').trim());
  check('The run is saved with its splits', /Mile 9/.test(summary) && /0\.\d+ mi/.test(summary), summary);

  await page.evaluate(()=>{
    window.__drawn = [];
    const f = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y){
      window.__drawn.push({text: String(text), x, y, w: this.measureText(text).width, align: this.textAlign, fill: String(this.fillStyle), cw: this.canvas.width, ch: this.canvas.height});
      return f.apply(this, arguments);
    };
    window.__images = 0;
    const di = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(img){ if(img && img.tagName==='CANVAS' && img.width>=900 && img.height>=400 && img.height<=900 && this.canvas.width===1080 && img!==this.canvas) window.__images++; return di.apply(this, arguments); };
  });
  await page.tap('#shareWorkoutBtn');
  const preview = ()=> page.evaluate(()=>{ const i = document.getElementById('shareCardPreview'); return {h:i.naturalHeight, alt:i.alt, complete:i.complete}; });
  for(const [fmt, h] of [['post', 1350], ['story', 1920]]){
    if(fmt==='story'){ await page.evaluate(()=> window.__drawn.splice(0)); await page.tap('[data-share-format="story"]'); }
    let pv;
    for(let i=0; i<60; i++){ pv = await preview(); if(pv.complete && pv.h===h) break; await sleep(100); }
    await sleep(200);
    const texts = (await page.evaluate(()=> window.__drawn.splice(0))).filter(t=> t.cw===1080);
    const labels = texts.filter(t=> /^Mile \d+$|^0\.\d+ mi$/.test(t.text)).map(t=> t.text);
    const paces = texts.filter(t=> /^\d+:\d\d\/mi$/.test(t.text));
    check(`${fmt}: every split is on the card (Mile 1 to 9 and the last part mile)`, labels.length===10 && labels.includes('Mile 1') && labels.includes('Mile 9') && labels.some(l=> /^0\.\d+ mi$/.test(l)), labels.join(','));
    const red = texts.filter(t=> /^Mile \d+$|^0\.\d+ mi$/.test(t.text) && /#ff5257/i.test(t.fill)).map(t=> t.text);
    check(`${fmt}: ...the fastest, mile 5, in red (and only that one)`, red.length===1 && red[0]==='Mile 5', red.join(','));
    check(`${fmt}: ...each split with its pace, none cut off`, paces.length>=10 && !texts.some(t=> /…/.test(t.text) && /Mile|mi$/.test(t.text)) && !texts.some(t=> /more$/.test(t.text)));
    check(`${fmt}: ...all inside the card's margins`, [...texts.filter(t=> /^Mile|^0\.\d+ mi$/.test(t.text) && t.align==='left'), ...paces].every(t=> (t.align==='right' ? t.x-t.w>=80-1 && t.x<=1000+1 : t.x>=80 && t.x+t.w<=1000+1)));
    check(`${fmt}: the alt text lists the splits and says which was fastest`, /Mile 5: \d+:\d\d\/mi \(fastest\)/.test(pv.alt) && /Mile 1: /.test(pv.alt), pv.alt.slice(0, 300));
    if(outDir){
      fs.mkdirSync(outDir, {recursive:true});
      const b64 = await page.evaluate(async ()=>{ const r = await fetch(document.getElementById('shareCardPreview').src); const b = await r.blob(); return await new Promise(res=>{ const fr = new FileReader(); fr.onload = ()=> res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }); });
      fs.writeFileSync(path.join(outDir, `run-${fmt}.jpg`), Buffer.from(b64, 'base64'));
    }
  }
  check('No map picture on the card (just the route line)', await page.evaluate(()=> window.__images)===0);
  check('No page errors', errors.length===0, errors.join(' | '));
  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
