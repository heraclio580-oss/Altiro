const fs = require('fs');
const path = require('path');
const http = require('http');

// The share card, for a lifting workout with half pounds: weights show as lifted (40.5×10, not 41×10);
// every saved card gets its own file name -- the workout, the day and the time -- so a browser never asks
// "Download file again?" for a second card; and a clear card's text has a thin dark outline and edge (it reads over
// a bright sky or a gallery's white). Skipped without Playwright.
let chromium;
for(const p of ['playwright', '/opt/node22/lib/node_modules/playwright']){ try{ ({ chromium } = require(p)); break; }catch(e){} }
if(!chromium){ console.log('(Playwright not installed -- skipped)'); process.exit(0); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const www = path.join(__dirname, '..', 'www');

(async () => {
  const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.wav':'audio/wav'};
  const server = http.createServer((req, res)=>{
    const f = path.join(www, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if(!f.startsWith(www) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, {'Content-Type': types[path.extname(f)] || 'application/octet-stream'});
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=> server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true, acceptDownloads:true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e=> errors.push(e.message));
  await page.route(u=> !u.href.startsWith(base), r=> r.abort());
  await page.addInitScript(()=>{ window.__ALTIRO_TEST_TODAY__ = '2026-09-16'; localStorage.setItem('altiro_tour_done', '1'); });
  await page.goto(base + 'index.html?proto');
  await sleep(400);
  // A weights-only plan: today is a lifting workout.
  await page.evaluate(()=>{
    const go = id=> [...document.querySelectorAll('.proto-pill')].find(p=> p.dataset.navId===id).click();
    go('adjust');
    for(let i=0; i<4; i++) document.getElementById('adjSliderThumb').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
    document.getElementById('applyAdjust').click();
    go('home');
    document.documentElement.classList.remove('proto-on');
    ['badgeOverlay','locPromptOverlay','tourOverlay'].forEach(id=>{ const e = document.getElementById(id); if(e) e.hidden = true; });
    document.getElementById('recordBtn').click();
  });
  await sleep(1000);
  // Half pounds in a weighted exercise that isn't the pyramid.
  const exName = await page.evaluate(()=>{
    const rows = [...document.querySelectorAll('#logPerfExercisesList .exercise-log-row')].filter(r=> r.querySelector('[data-field="weight"]'));
    const row = rows[1];
    row.querySelectorAll('[data-field="weight"]').forEach((i, n)=>{ i.value = String(40.5 + n*5); i.dispatchEvent(new Event('input', {bubbles:true})); });
    row.querySelectorAll('[data-field="reps"]').forEach(i=>{ i.value = '10'; i.dispatchEvent(new Event('input', {bubbles:true})); });
    return row.getAttribute('data-exercise-key');
  });
  await page.evaluate(()=> document.getElementById('saveLogPerf').click());
  await sleep(600);
  await page.evaluate(()=>{
    window.__drawn = [];
    const f = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text){ window.__drawn.push({text: String(text), blur: this.shadowBlur, color: String(this.shadowColor)}); return f.apply(this, arguments); };
  });
  await page.evaluate(()=> document.getElementById('shareWorkoutBtn').click());
  await sleep(1500);
  let texts = await page.evaluate(()=> window.__drawn.splice(0));
  const line = texts.map(t=> t.text).join(' | ');
  check('Half pounds on the share card as lifted: 40.5×10, 45.5×10 ...', /40\.5×10 · 45\.5×10/.test(line) && !/\b41×10/.test(line), exName + ': ' + line.slice(0, 400));

  // Saving twice (the website: a download each time) -- two different names, the workout's in them.
  const title = await page.evaluate(()=> document.getElementById('summarySessTitle').textContent.split(',')[0].trim());
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const save = async ()=>{ const [dl] = await Promise.all([page.waitForEvent('download', {timeout: 5000}).catch(()=> null), page.evaluate(()=> document.getElementById('shareCardSaveBtn').click())]); return dl && dl.suggestedFilename(); };
  const n1 = await save();
  await sleep(1100);
  const n2 = await save();
  check('Each saved card has its own name: the workout, the day and the time', !!n1 && !!n2 && n1!==n2 && new RegExp(`^altiro-${slug}-2026-09-16-\\d{6}\\.jpg$`).test(n1), `${n1} / ${n2} (${slug})`);

  // Clear: a tight dark edge on the text.
  await page.evaluate(()=> document.getElementById('shareClearChip').click());
  await sleep(1500);
  texts = await page.evaluate(()=> window.__drawn.splice(0));
  const edged = texts.filter(t=> t.blur>0);
  check('Clear card: the text has a tight dark edge (not a wide soft glow)', edged.length>5 && edged.every(t=> t.blur<=4 && /0\.8|0\.9|rgba\(0, 0, 0, 0\.85\)/.test(t.color)), JSON.stringify(edged.slice(0, 2)));
  const n3 = await save();
  check('...and its file is a PNG named as clear', !!n3 && /-clear\.png$/.test(n3), n3);

  check('No page errors', errors.length===0, errors.join(' | '));
  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
