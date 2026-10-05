const fs = require('fs');
const path = require('path');
const http = require('http');

// The shareable workout card, in a real browser (it's drawn on a canvas, which jsdom can't do): after a
// workout is saved, Share workout makes a picture of it -- name, date, time, sets, reps, volume and
// every exercise's weights -- as a post or a story, and hands it to the phone's share sheet, or saves
// it where sharing isn't available. Set SHARE_CARD_OUT=<folder> to keep the pictures for a look.
// Skipped where Playwright/Chromium isn't installed.
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
const outDir = process.env.SHARE_CARD_OUT;

(async () => {
  const types = {'.html':'text/html', '.js':'text/javascript', '.wav':'audio/wav', '.png':'image/png', '.webmanifest':'application/manifest+json'};
  const server = http.createServer((req, res)=>{
    const f = path.join(www, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if(!f.startsWith(www) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, {'Content-Type': types[path.extname(f)] || 'application/octet-stream'});
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=> server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });

  async function openApp(lang){
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true, acceptDownloads:true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e=> errors.push(e.message));
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    await page.addInitScript(l=>{
      window.__ALTIRO_TEST_TODAY__ = '2026-09-19'; // a Saturday: a rest day on the default plan
      if(l) try{ localStorage.setItem('altiro_lang', l); }catch(e){}
      window.__shared = [];
      navigator.canShare = d=> !!(d && d.files && d.files.length);
      navigator.share = async d=>{ const f = d.files[0]; window.__shared.push({name:f.name, type:f.type, size:f.size, text:d.text}); };
    }, lang || null);
    await page.goto(base + 'index.html?proto');
    await sleep(500);
    if(lang==='es') await page.evaluate(()=>{ const b = [...document.querySelectorAll('.lang-btn')].find(b=>b.getAttribute('data-lang')==='es'); if(b) b.click(); });
    await page.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); document.documentElement.classList.remove('proto-on'); });
    await sleep(200);
    return {page, errors};
  }
  const preview = page => page.evaluate(()=>{ const i = document.getElementById('shareCardPreview'); return {w:i.naturalWidth, h:i.naturalHeight, alt:i.alt, src:!!i.getAttribute('src'), complete:i.complete}; });
  const waitPreview = async (page, h) => { for(let i=0; i<40; i++){ const p = await preview(page); if(p.complete && p.h===h) return p; await sleep(100); } return preview(page); };
  async function keep(page, name){
    if(!outDir) return;
    fs.mkdirSync(outDir, {recursive:true});
    const b64 = await page.evaluate(async ()=>{ const r = await fetch(document.getElementById('shareCardPreview').src); const b = await r.blob(); return await new Promise(res=>{ const fr = new FileReader(); fr.onload = ()=> res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }); });
    fs.writeFileSync(path.join(outDir, name), Buffer.from(b64, 'base64'));
  }

  // ---- A lifting workout logged as it was done ----
  {
    const {page, errors} = await openApp();
    await page.evaluate(async ()=>{
      const doc = document, wait = ms=> new Promise(r=>setTimeout(r,ms));
      const type = (el, v)=>{ el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); };
      doc.getElementById('addTodayWorkoutBtn').click(); await wait(30);
      doc.getElementById('createLiveToggle').click(); await wait(30);
      type(doc.getElementById('manualNameInput'), 'Push Day');
      doc.getElementById('saveManualEntry').click(); await wait(60);
      const row = key=> [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].find(r=>r.getAttribute('data-exercise-key')===key);
      const add = async (name, sets)=>{
        type(doc.getElementById('logPerfAddExerciseInput'), name); doc.getElementById('logPerfAddExerciseBtn').click(); await wait(30);
        const key = [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].pop().getAttribute('data-exercise-key');
        for(let i=0; i<sets.length; i++){
          if(i>0){ row(key).querySelector('[data-step="1"]').click(); await wait(20); }
          const r = row(key).querySelectorAll('.set-log-row')[i];
          type(r.querySelector('[data-field="weight"]'), String(sets[i][0])); type(r.querySelector('[data-field="reps"]'), String(sets[i][1]));
        }
      };
      await add('Bench Press', [[135,8],[155,6],[175,4]]);
      await add('Overhead Press', [[95,8],[95,8],[95,8]]);
      await add('Cable Crossover Machine', [[40,12],[40,12]]);
      type(doc.getElementById('logPerfTimeMInput'), '52'); type(doc.getElementById('logPerfTimeSInput'), '0'); type(doc.getElementById('logPerfTimeHInput'), '0');
      doc.getElementById('saveLogPerf').click(); await wait(80);
    });
    await sleep(200);
    check('(set-up) the workout is saved and the Summary is showing', await page.evaluate(()=> !document.getElementById('screen-summary').hidden));
    const summaryStats = await page.evaluate(()=> document.getElementById('summaryStats').textContent);
    // 135*8 + 155*6 + 175*4 + 95*8*3 + 40*12*2 = 1080+930+700+2280+960 = 5950
    check('The Summary shows the real weight moved and the time taken', /5,950 lb/.test(summaryStats) && /52 min/.test(summaryStats), summaryStats);
    check('A Share workout button is on the Summary', await page.evaluate(()=> !document.getElementById('shareWorkoutBtn').hidden));
    await page.tap('#shareWorkoutBtn');
    const post = await waitPreview(page, 1350);
    check('Share workout opens a preview of the picture', await page.evaluate(()=> !document.getElementById('shareCardOverlay').hidden) && post.src);
    check('It\'s a feed post: 1080 × 1350', post.w===1080 && post.h===1350, `${post.w}x${post.h}`);
    check('It has the workout\'s name and date', /Push Day/.test(post.alt) && /Sep 19, 2026/.test(post.alt), post.alt);
    check('...the time, sets, reps and volume', /Time: 52 min/.test(post.alt) && /Sets: 8/.test(post.alt) && /Reps: 66/.test(post.alt) && /Volume: 5,950 lb/.test(post.alt), post.alt);
    check('...each set of a changing lift', /Bench Press: 135×8 · 155×6 · 175×4 lb/.test(post.alt), post.alt);
    check('...and a lift done the same every set, written short', /Overhead Press: 3 × 8 @ 95 lb/.test(post.alt), post.alt);
    check('...and an exercise the app didn\'t know', /Cable Crossover Machine: 2 × 12 @ 40 lb/.test(post.alt), post.alt);
    await keep(page, 'post-lifting.jpg');

    await page.tap('[data-share-format="story"]');
    const story = await waitPreview(page, 1920);
    check('Story makes a 1080 × 1920 picture', story.w===1080 && story.h===1920, `${story.w}x${story.h}`);
    await keep(page, 'story-lifting.jpg');

    await page.tap('#shareCardShareBtn');
    await sleep(300);
    const shared = await page.evaluate(()=> window.__shared);
    check('Share hands the picture to the phone\'s share sheet, as a small JPEG (well under a screenshot\'s size)', shared.length===1 && shared[0].type==='image/jpeg' && shared[0].size>20000 && shared[0].size<300000 && shared[0].name==='altiro-workout-2026-09-19-story.jpg', JSON.stringify(shared));
    check('...with a line of text to go with it', /Push Day/.test(shared[0] && shared[0].text || ''), JSON.stringify(shared));

    // Where the browser can't share files, the picture is saved instead.
    await page.evaluate(()=>{ navigator.canShare = ()=> false; });
    const dl = page.waitForEvent('download', {timeout: 3000}).catch(()=> null);
    await page.tap('#shareCardShareBtn');
    const download = await dl;
    check('Can\'t share here? The picture is saved instead', !!download && download.suggestedFilename()==='altiro-workout-2026-09-19-story.jpg', download && download.suggestedFilename());
    const dl2 = page.waitForEvent('download', {timeout: 3000}).catch(()=> null);
    await page.tap('#shareCardSaveBtn');
    check('Save image saves it', !!(await dl2));
    // Full screen, for a screenshot instead of a saved file.
    await page.tap('#shareCardPreview');
    await sleep(200);
    const full = await page.evaluate(()=>{ const f = document.getElementById('shareCardFull'), i = document.getElementById('shareCardFullImg'), r = i.getBoundingClientRect();
      return {shown: !f.hidden, loaded: i.complete && i.naturalHeight===1920, w: r.width, h: r.height, tip: !document.getElementById('shareCardFullTip').classList.contains('gone')}; });
    check('Tapping the preview shows the picture full screen, ready for a screenshot', full.shown && full.loaded && (Math.round(full.w)===390 || Math.round(full.h)===844), JSON.stringify(full));
    check('...with a short tip', full.tip);
    await sleep(2600);
    check('...that fades away before the screenshot', await page.evaluate(()=> document.getElementById('shareCardFullTip').classList.contains('gone')));
    await page.tap('#shareCardFull');
    await sleep(150);
    check('A tap closes full screen, back to the preview', await page.evaluate(()=> document.getElementById('shareCardFull').hidden && !document.getElementById('shareCardOverlay').hidden));
    await page.tap('#closeShareCard');
    check('The preview closes', await page.evaluate(()=> document.getElementById('shareCardOverlay').hidden));
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- An interval workout, in Spanish ----
  {
    const {page, errors} = await openApp('es');
    await page.evaluate(async ()=>{
      const doc = document, wait = ms=> new Promise(r=>setTimeout(r,ms));
      doc.getElementById('addTodayWorkoutBtn').click(); await wait(30);
      doc.getElementById('manualNameInput').value = 'Saco de boxeo';
      doc.getElementById('manualNameInput').dispatchEvent(new Event('input', {bubbles:true}));
      [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='interval').click();
      doc.getElementById('createRoundsInput').value = '1';
      doc.getElementById('createWorkDurationInput').value = '0:01';
      doc.getElementById('createRestDurationInput').value = '0:01';
      doc.getElementById('saveManualEntry').click(); await wait(30);
    });
    await page.tap('#recordBtn');
    await sleep(300);
    await page.tap('#timerStartPauseBtn');
    await sleep(5000 + 1000 + 1500);
    await page.tap('#timerFinishBtn');
    await sleep(300);
    await page.tap('#shareWorkoutBtn');
    const p = await waitPreview(page, 1350);
    check('An interval workout\'s card (in Spanish): its rounds, work, rest and time', /Saco de boxeo/.test(p.alt) && /Rondas: 1/.test(p.alt) && /sept/i.test(p.alt), p.alt);
    check('...and no exercise list', !/×/.test(p.alt), p.alt);
    await keep(page, 'post-interval-es.jpg');
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
