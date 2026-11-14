const fs = require('fs');
const path = require('path');
const http = require('http');
const { JSDOM } = require('jsdom');

// From an iPhone: on a rest day, Today's More menu opened below the card's buttons, behind the bottom tab
// bar, and the page didn't scroll to it. Now opening it scrolls just enough to show all of it above the
// bar; each tab's room under its last item is a spacer (Safari can leave a scrolling box's own bottom
// padding out); and the greeting never uses an email's first part as a name ("Rest up, rveronica.homes.").
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

// ---- The greeting (jsdom, signed in with a fake backend) ----
function backend(email, meta, fullName){
  function from(table){
    const api = { select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; }, in(){ return api; }, limit(){ return api; },
      insert(){ return api; }, delete(){ return api; }, update(){ return api; }, upsert(){ return api; }, single(){ return api.maybeSingle(); },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[], focus_ratio:0, own_since:'2026-11-01', ...(fullName ? {full_name: fullName} : {})} : null, error:null}); },
      then(res, rej){ return Promise.resolve({data: [], error:null}).then(res, rej); } };
    return api;
  }
  return { createClient: () => ({ auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
    async getSession(){ return {data:{session:{user:{id:'u1', email, user_metadata: meta || {}}}}}; }, async signOut(){ return {error:null}; } }, from }) };
}
async function greeting(email, meta, fullName, lang){
  const b = backend(email, meta, fullName);
  const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => b.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-11-14'; if(lang) w.localStorage.setItem('altiro_lang', lang); } });
  await wait(300);
  const t = dom.window.document.getElementById('homeGreeting').textContent;
  dom.window.close();
  return t;
}

(async () => {
  let g = await greeting('rveronica.homes@example.com');
  check('No name, just an email: "Rest up." (not "Rest up, rveronica.homes.")', g==='Rest up.', g);
  g = await greeting('rveronica.homes@example.com', null, 'rveronica.homes');
  check('...also when the email\'s first part was saved as the name', g==='Rest up.', g);
  g = await greeting('vr@example.com', {full_name: 'Veronica Ramos'});
  check('Signed up with a name (Google / Apple): "Rest up, Veronica."', g==='Rest up, Veronica.', g);
  g = await greeting('vr@example.com', null, 'Veronica Ramos');
  check('A name in the profile: "Rest up, Veronica."', g==='Rest up, Veronica.', g);
  g = await greeting('rveronica.homes@example.com', null, null, 'es');
  check('In Spanish, no name: "Descansa."', g==='Descansa.', g);

  // ---- Real layout (Playwright): the More menu at the bottom of a rest day ----
  let chromium;
  for(const p of ['playwright', '/opt/node22/lib/node_modules/playwright']){ try{ ({ chromium } = require(p)); break; }catch(e){} }
  if(!chromium){ console.log('(Playwright not installed -- layout checks skipped)'); }
  else {
    const www = path.join(__dirname, '..', 'www');
    const server = http.createServer((req, res)=>{
      const f = path.join(www, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      if(!f.startsWith(www) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
      res.writeHead(200, {'Content-Type': {'.html':'text/html', '.js':'text/javascript', '.png':'image/png'}[path.extname(f)] || 'application/octet-stream'});
      fs.createReadStream(f).pipe(res);
    });
    await new Promise(r=> server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport:{width:390, height:664}, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    await page.addInitScript(()=>{ window.__ALTIRO_TEST_TODAY__ = '2026-11-14'; localStorage.setItem('altiro_tour_done', '1'); });
    await page.goto(base + 'index.html?proto');
    await page.waitForTimeout(500);
    const r = await page.evaluate(async ()=>{
      document.documentElement.classList.remove('proto-on');
      ['badgeOverlay','locPromptOverlay','tourOverlay'].forEach(id=>{ const e = document.getElementById(id); if(e) e.hidden = true; });
      [...document.querySelectorAll('.proto-pill')].find(p=> p.dataset.navId==='home').click();
      await new Promise(r=> setTimeout(r, 300));
      const scr = document.getElementById('screen-home'), btn = document.getElementById('homeMoreBtn');
      // The More button just above the bottom bar, as in the screenshot.
      const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
      scr.scrollTop += btn.getBoundingClientRect().bottom - (nav.top - 6);
      await new Promise(r=> setTimeout(r, 100));
      const before = scr.scrollTop;
      btn.click();
      await new Promise(r=> setTimeout(r, 900));
      const p = document.getElementById('homeMorePanel').getBoundingClientRect();
      const after = {scrolled: scr.scrollTop - before, panelBottom: p.bottom, panelTop: p.top, navTop: nav.top};
      // The spacer: a tab's last item scrolls clear of the bar.
      scr.scrollTop = 1e6;
      await new Promise(r=> setTimeout(r, 100));
      const items = [...scr.children].filter(c=> !c.hidden && c.getBoundingClientRect().height);
      const last = items[items.length-1].getBoundingClientRect();
      return {...after, lastBottom: last.bottom, padding: getComputedStyle(scr).paddingBottom, spacer: getComputedStyle(scr, '::after').height};
    });
    check('More, tapped just above the tab bar: the page scrolls to show it', r.scrolled > 20, JSON.stringify(r));
    check('...all of it above the bar', r.panelBottom <= r.navTop && r.panelTop > 0, JSON.stringify(r));
    check('Each tab ends with room to scroll its last item above the bar (a spacer, not padding)', r.lastBottom <= r.navTop && r.padding==='0px' && parseFloat(r.spacer) >= 70, JSON.stringify(r));
    await browser.close();
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
