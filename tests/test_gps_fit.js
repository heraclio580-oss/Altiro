const fs = require('fs');
const path = require('path');
const http = require('http');

// The GPS screen fits a small phone with large text: an iPhone user (Spanish, large text) saw the map,
// the time and the long browser note, and no Run/Walk/Hike/Bike ride choice or Start -- the bottom was cut
// off and couldn't be scrolled. Now the map gives up its room first, the browser note is one short line
// (the whole why a tap away, an × to hide it for good), and if it still doesn't fit, the screen scrolls.
// Skipped without Playwright.
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

  async function openGps(w, h, textSize, lang){
    const ctx = await browser.newContext({ viewport: {width:w, height:h}, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    await page.route(/maplibre-gl\.js$/, r=> r.abort());
    await page.addInitScript(([ts, lang])=>{
      window.__ALTIRO_TEST_TODAY__ = '2026-09-19';
      localStorage.setItem('altiro_text_size', ts); localStorage.setItem('altiro_lang', lang);
      navigator.geolocation.watchPosition = (cb)=>{ setTimeout(()=> cb({coords:{latitude:37.7749, longitude:-122.4194, accuracy:6}, timestamp: Date.now()}), 30); return 7; };
      navigator.geolocation.clearWatch = ()=>{};
      navigator.geolocation.getCurrentPosition = cb=> setTimeout(()=> cb({coords:{latitude:37.7749, longitude:-122.4194, accuracy:12}, timestamp: Date.now()}), 10);
    }, [textSize, lang]);
    await page.goto(base + 'index.html?proto');
    await sleep(400);
    await page.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); document.documentElement.classList.remove('proto-on'); });
    await sleep(150);
    await page.evaluate(()=>{ const b = document.getElementById('trackRunBtn'); if(b.closest('[hidden]')) document.getElementById('homeMoreBtn').click(); });
    await sleep(50);
    await page.evaluate(()=> document.getElementById('trackRunBtn').click());
    await sleep(300);
    return {ctx, page};
  }
  // Is it inside the GPS screen's visible area (scrolled as it is now)?
  const inView = (page, sel)=> page.evaluate(s=>{ const r = document.querySelector(s).getBoundingClientRect(), o = document.getElementById('gpsOverlay').getBoundingClientRect(); return r.height>0 && r.top>=o.top-1 && r.bottom<=o.bottom+1; }, sel);

  for(const [w, h, ts, lang, name] of [[375, 667, '1.25', 'es', 'iPhone SE size, large text, Spanish'], [390, 844, '1.25', 'es', 'iPhone 14 size, large text'], [360, 640, '1.12', 'en', 'small Android'], [320, 568, '1.25', 'es', 'smallest iPhone, large text']]){
    const {ctx, page} = await openGps(w, h, ts, lang);
    check(`${name}: Start is on screen without scrolling`, await inView(page, '#gpsStartBtn'));
    check('...and the Run/Walk/Hike/Bike ride choice', await inView(page, '#gpsActRow'));
    check('...the map is still there', await page.evaluate(()=> document.getElementById('gpsMap').getBoundingClientRect().height >= 119));
    await ctx.close();
  }

  // The browser note: one short line, with the whole why a tap away.
  {
    const {ctx, page} = await openGps(390, 844, '1', 'en');
    const note = ()=> page.evaluate(()=> document.getElementById('gpsNote').textContent.replace(/\s+/g, ' ').trim());
    check('Browser note: one short line, "Keep the screen on while you run. Why?"', (await note())==='Keep the screen on while you run. Why?', await note());
    await page.tap('#gpsNoteMore');
    check('...Why? shows the whole of it (the lock, the pocket)', /browsers pause GPS when the screen turns off/.test(await note()) && /Tap the lock at the top/.test(await note()), await note());
    await ctx.close();
  }
  // The × hides it, for good on this phone (it's advice; a warning still shows).
  {
    const {ctx, page} = await openGps(390, 844, '1', 'en');
    check('The note has an × in its corner ("Hide this note")', await page.evaluate(()=>{ const x = document.getElementById('gpsNoteX'); return !!x && x.getAttribute('aria-label')==='Hide this note'; }));
    const mapBefore = await page.evaluate(()=> document.getElementById('gpsMap').getBoundingClientRect().height);
    await page.tap('#gpsNoteMore');
    check('...still there with the whole why open', await page.evaluate(()=> !!document.getElementById('gpsNoteX')));
    await page.tap('#gpsNoteX');
    await sleep(50);
    check('Tapped: the note is gone, and the map has its room', await page.evaluate(()=> document.getElementById('gpsNote').hidden) && await page.evaluate(()=> document.getElementById('gpsMap').getBoundingClientRect().height) > mapBefore);
    await page.evaluate(()=> document.getElementById('gpsClose').click());
    await sleep(100);
    await page.evaluate(()=> document.getElementById('trackRunBtn').click());
    await sleep(200);
    check('...and it stays gone next time', await page.evaluate(()=> document.getElementById('gpsOverlay').hidden===false && document.getElementById('gpsNote').hidden));
    await page.reload(); await sleep(400);
    await page.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); document.documentElement.classList.remove('proto-on'); });
    await sleep(150);
    await page.evaluate(()=>{ const b = document.getElementById('trackRunBtn'); if(b.closest('[hidden]')) document.getElementById('homeMoreBtn').click(); });
    await page.evaluate(()=> document.getElementById('trackRunBtn').click());
    await sleep(200);
    check('...even after the app is reopened', await page.evaluate(()=> document.getElementById('gpsNote').hidden));
    await ctx.close();
  }
  {
    const {ctx, page} = await openGps(375, 667, '1', 'es');
    check('In Spanish: "Mantén la pantalla encendida mientras corres. ¿Por qué?", × "Ocultar esta nota"', await page.evaluate(()=> document.getElementById('gpsNote').textContent.replace(/\s+/g, ' ').trim())==='Mantén la pantalla encendida mientras corres. ¿Por qué?' && await page.evaluate(()=> document.getElementById('gpsNoteX').getAttribute('aria-label'))==='Ocultar esta nota');
    await ctx.close();
  }

  // Still too tall (the whole why open, on the smallest phone with large text): the screen scrolls to Start.
  {
    const {ctx, page} = await openGps(320, 568, '1.25', 'es');
    await page.tap('#gpsNoteMore');
    await sleep(50);
    const scrolls = await page.evaluate(()=>{ const o = document.getElementById('gpsOverlay'); return o.scrollHeight > o.clientHeight && getComputedStyle(o).overflowY==='auto'; });
    await page.evaluate(()=> document.getElementById('gpsStartBtn').scrollIntoView({block:'end'}));
    check('Too tall even so: the screen scrolls, and Start can be reached', scrolls && await inView(page, '#gpsStartBtn'));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
