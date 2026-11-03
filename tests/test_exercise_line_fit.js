const fs = require('fs');
const path = require('path');
const http = require('http');

// Exercise lines fit their card: a pyramid's long line ("Peak pyramid · 16 sets · top 120 lb") goes
// under the lift's name instead of running off the right edge, and any line's numbers wrap rather than
// overflow -- at the normal text size and the largest. Checked with real layout. Skipped without Playwright.
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

  async function open(today, textSize){
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    await page.addInitScript(o=>{ window.__ALTIRO_TEST_TODAY__ = o.today; if(o.textSize) localStorage.setItem('altiro_text_size', o.textSize); }, {today, textSize});
    await page.goto(base + 'index.html?proto');
    await sleep(400);
    // A weights-only plan: today is one of the plan's lifting days, its main lift a pyramid.
    await page.evaluate(()=>{
      const go = id=> [...document.querySelectorAll('.proto-pill')].find(p=> p.dataset.navId===id).click();
      go('adjust');
      for(let i=0; i<4; i++) document.getElementById('adjSliderThumb').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
      document.getElementById('applyAdjust').click();
      go('home');
      document.documentElement.classList.remove('proto-on');
      ['badgeOverlay', 'locPromptOverlay', 'tourOverlay'].forEach(id=>{ const e = document.getElementById(id); if(e) e.hidden = true; });
    });
    await sleep(300);
    return {page, ctx};
  }
  // Every exercise line on Today: does anything stick out past its card?
  const measure = page => page.evaluate(()=>{
    const out = [];
    document.querySelectorAll('#screen-home .r-exercise-list li').forEach(li=>{
      const card = li.closest('.r-exercise-list').getBoundingClientRect();
      const items = [...li.querySelectorAll('span, .ex-nm, button')];
      const right = Math.max(li.getBoundingClientRect().right, ...items.map(e=> e.getBoundingClientRect().right));
      out.push({text: li.textContent.replace(/\s+/g, ' ').trim(), pyramid: li.classList.contains('rx-below'), over: Math.round(right - card.right), scroll: li.scrollWidth - li.clientWidth});
    });
    return out;
  });

  // Find a day this week whose workout has a peak pyramid.
  let page, ctx, rows = null, day = null;
  for(const d of ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-14', '2026-09-15']){
    ({page, ctx} = await open(d));
    rows = await measure(page);
    if(rows.some(r=> /Peak pyramid/.test(r.text))){ day = d; break; }
    await ctx.close();
  }
  check('A peak pyramid day on Today', !!day, rows && rows.map(r=> r.text).join(' | '));
  if(day){
    const layout = await page.evaluate(()=>{
      const li = [...document.querySelectorAll('#screen-home .r-exercise-list li')].find(l=> /Peak pyramid/.test(l.textContent));
      const nmEl = li.querySelector('.ex-nm');
      if(!nmEl) return {below: false};
      const nm = nmEl.getBoundingClientRect(), rx = li.querySelector(':scope > span').getBoundingClientRect();
      return {below: rx.top >= nm.bottom - 1, nameLines: Math.round(nm.height / parseFloat(getComputedStyle(li).lineHeight || 16))};
    });
    check('The pyramid\'s line goes under the lift\'s name', layout.below, JSON.stringify(layout));
    check('...and nothing runs off the card', rows.every(r=> r.over<=1 && r.scroll<=1), rows.filter(r=> r.over>1 || r.scroll>1).map(r=> `${r.text} (+${r.over}px)`).join(' | '));
    check('...the (i) is fully inside', await page.evaluate(()=>{ const li = [...document.querySelectorAll('#screen-home .r-exercise-list li')].find(l=> /Peak pyramid/.test(l.textContent)); const b = li && li.querySelector('button'); const c = b && b.closest('.r-exercise-list').getBoundingClientRect(); return !!b && b.getBoundingClientRect().right <= c.right + 1; }));
    check('Other lifts keep name left, numbers right, on one line', await page.evaluate(()=>{
      const li = [...document.querySelectorAll('#screen-home .r-exercise-list li:not(.rx-below)')].find(l=> l.querySelector(':scope > span'));
      if(!li) return false;
      const sp = li.querySelector(':scope > span').getBoundingClientRect(), r = li.getBoundingClientRect();
      return Math.abs(sp.right - r.right) <= 1 && sp.height < 30;
    }));
    await ctx.close();

    // The largest text size.
    ({page, ctx} = await open(day, '1.25'));
    rows = await measure(page);
    check('Largest text size: still nothing runs off the card', rows.length && rows.every(r=> r.over<=1 && r.scroll<=1), rows.filter(r=> r.over>1 || r.scroll>1).map(r=> `${r.text} (+${r.over}px)`).join(' | '));
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
