const fs = require('fs');
const path = require('path');
const http = require('http');

// Layout polish, checked with real layout (skipped without Playwright):
// - Spanish at the largest text size: the Plan page's week headers and Progress's activity tiles stay on
//   screen (the delete-week button was pushed 25px off, the Reps tile 8px).
// - Light mode: the workout summary's "Rate this workout" title is readable (it was white on white).
// - The summary's stats: an odd number of them leaves none alone on a row (the first takes the row).
// - Today's card has no faint icon peeking out past Start Workout.
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
  async function open(o){
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    await page.addInitScript(o=>{
      window.__ALTIRO_TEST_TODAY__ = '2026-09-16';
      if(o.lang) localStorage.setItem('altiro_lang', o.lang);
      if(o.fs) localStorage.setItem('altiro_text_size', o.fs);
      if(o.theme) localStorage.setItem('altiro_theme', o.theme);
    }, o || {});
    await page.goto(base + 'index.html?proto');
    await sleep(400);
    await page.evaluate(()=>{ document.documentElement.classList.remove('proto-on'); ['badgeOverlay','locPromptOverlay','tourOverlay'].forEach(id=>{ const e = document.getElementById(id); if(e) e.hidden = true; }); });
    return {page, ctx};
  }
  const go = (page, id) => page.evaluate(id=> [...document.querySelectorAll('.proto-pill')].find(p=> p.dataset.navId===id).click(), id);
  // What sticks out past the right edge of the screen, on the screen showing.
  const offRight = page => page.evaluate(()=>{
    const W = window.innerWidth, scr = [...document.querySelectorAll('.screen')].find(s=> !s.hidden);
    return [...scr.querySelectorAll('*')].filter(el=>{ const r = el.getBoundingClientRect(); return r.width && r.height && r.right > W + 1 && r.left < W; })
      .map(el=> (el.className || el.tagName) + ' "' + (el.textContent||'').trim().slice(0, 30) + '"');
  });

  {
    const {page, ctx} = await open({lang:'es', fs:'1.25'});
    await go(page, 'week'); await sleep(300);
    const off = await offRight(page);
    check('Spanish, largest text: the Plan page\'s week headers stay on screen', off.length===0, off.slice(0, 4).join(' | '));
    check('...the delete-week button included', await page.evaluate(()=>{ const b = document.querySelector('#screen-week .week-clear-btn'); return !!b && b.getBoundingClientRect().right <= window.innerWidth; }));
    await go(page, 'progress'); await sleep(300);
    const off2 = await offRight(page);
    check('...and Progress\'s activity tiles too', off2.length===0, off2.slice(0, 4).join(' | '));
    check('...the reps tile says Reps', await page.evaluate(()=> [...document.querySelectorAll('.act-tile .l')].some(l=> l.textContent==='Reps')));
    await ctx.close();
  }
  {
    const {page, ctx} = await open({theme:'light'});
    await go(page, 'home'); await sleep(200);
    check('Today: no icon behind the card peeking out past Start Workout', await page.evaluate(()=>{ const a = document.getElementById('thArt'); return !a || getComputedStyle(a).display==='none'; }));
    await page.evaluate(()=> document.getElementById('recordBtn').click());
    await sleep(900);
    await page.evaluate(()=> document.getElementById('saveLogPerf').click());
    await sleep(900);
    const rate = await page.evaluate(()=>{
      const el = document.querySelector('#summaryReviewCard > .st-label'), card = document.getElementById('summaryReviewCard');
      const rgb = c=> c.match(/[\d.]+/g).slice(0, 3).map(Number), lum = ([r,g,b])=> (0.2126*r + 0.7152*g + 0.0722*b)/255;
      return {text: el.textContent, fg: lum(rgb(getComputedStyle(el).color)), bg: lum(rgb(getComputedStyle(card).backgroundColor))};
    });
    check('Light mode: "Rate this workout" is readable on its card', rate.text==='Rate this workout' && Math.abs(rate.fg - rate.bg) > 0.5, JSON.stringify(rate));
    const grid = await page.evaluate(()=>{
      const cells = [...document.querySelectorAll('#summaryStats .cell')].map(c=> c.getBoundingClientRect());
      const rows = {}; cells.forEach(r=>{ const k = Math.round(r.top); rows[k] = (rows[k]||0) + 1; });
      const g = document.getElementById('summaryStats').getBoundingClientRect();
      return {n: cells.length, rows: Object.values(rows), firstFull: cells.length%2===1 ? Math.abs(cells[0].width - (g.width - 40)) < 2 : null};
    });
    check('Summary stats: none alone on a row with a gap beside it', grid.n%2===0 ? grid.rows.every(n=> n===2) : grid.firstFull && grid.rows.slice(1).every(n=> n===2), JSON.stringify(grid));
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
