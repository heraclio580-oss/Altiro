const fs = require('fs');
const path = require('path');
const http = require('http');

// Support, Terms and Privacy from inside the app: an iPhone user with Altiro on her home screen (full
// screen, no browser buttons) opened Help & support and had no way back but closing the app. Now they open
// in the app's own window, each has a "Back to Altiro" bar at the top (staying in view as you scroll), and
// it goes back to the tab it was opened from -- Settings -- not Today. In Spanish: "Volver a Altiro".
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

// A signed-in account (nothing leaves the page).
const FAKE = (lang)=>{
  window.__ALTIRO_TEST_TODAY__ = '2026-09-16';
  try{ localStorage.setItem('altiro_tour_done', '1'); localStorage.setItem('altiro_install_nudge_dismissed', '1'); if(lang) localStorage.setItem('altiro_lang', lang); }catch(e){}
  const user = {id:'u1', email:'runner@example.com', user_metadata:{}};
  const rows = {profiles: [{id:'u1', goal:'mix', level:'intermediate', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, weekly_miles:10, equipment:'gym', plan_start:'2026-09-07'}]};
  const from = t => { const api = { select(){return api;}, eq(){return api;}, order(){return api;}, in(){return api;}, is(){return api;}, not(){return api;}, gte(){return api;}, lte(){return api;}, limit(){return api;},
    upsert(){return api;}, update(){return api;}, insert(){return api;}, delete(){return api;},
    maybeSingle(){ return Promise.resolve({data:(rows[t]||[])[0]||null, error:null}); }, single(){ return api.maybeSingle(); },
    then(res,rej){ return Promise.resolve({data: rows[t]||[], error:null}).then(res,rej); } }; return api; };
  const client = { auth: { async getSession(){ return {data:{session:{user, access_token:'t'}}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async signOut(){ return {}; } },
    from, functions:{ async invoke(){ return {data:{connected:false}, error:null}; } } };
  Object.defineProperty(window, 'supabase', { value: { createClient: () => client }, writable: false, configurable: false });
};

(async () => {
  const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webmanifest':'application/manifest+json', '.png':'image/png'};
  const server = http.createServer((req, res)=>{
    let f = path.join(www, decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, ''));
    if(fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if(!f.startsWith(www) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
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
    await page.route(/vendor\/supabase\.js/, r=> r.fulfill({status:200, contentType:'text/javascript', body:''}));
    await page.route(/sw\.js$/, r=> r.fulfill({status:404, body:''}));
    await page.addInitScript(FAKE, lang || null);
    await page.goto(base);
    await sleep(1200);
    for(const id of ['badgeOverlay', 'locPromptOverlay']) await page.evaluate(id=>{ const e = document.getElementById(id); if(e) e.hidden = true; }, id);
    return {ctx, page, errors};
  }
  const onScreen = page => page.evaluate(()=>{ const s = ['home','settings'].find(id=>{ const e = document.getElementById('screen-'+id); return e && !e.hidden; }); return s || null; });
  const toSettings = async page => { await page.tap('#bottomNav [data-tab="settings"]'); await sleep(250); };

  // ---- Help & support, in English ----
  {
    const {ctx, page, errors} = await openApp();
    check('Signed in, on Today', await onScreen(page)==='home');
    await toSettings(page);
    check('Settings', await onScreen(page)==='settings');
    const link = await page.evaluate(()=>{ const a = document.getElementById('settingsSupportLink'); return {target: a.getAttribute('target'), href: a.getAttribute('href')}; });
    check('Help & support opens in the app\'s own window (no new window)', !link.target && link.href==='support.html', JSON.stringify(link));
    await Promise.all([page.waitForNavigation(), page.tap('#settingsSupportLink')]);
    await sleep(200);
    check('...the Support page', /support\.html$/.test(page.url()) && /Support/.test(await page.textContent('h1')));
    const bar = await page.evaluate(()=>{ const a = document.getElementById('appBack'); const r = a.getBoundingClientRect(); return {text: a.textContent.trim(), top: r.top, h: r.height}; });
    check('...with "Back to Altiro" at the top', bar.text==='Back to Altiro' && bar.top>=0 && bar.top<40 && bar.h>=30, JSON.stringify(bar));
    await page.evaluate(()=> window.scrollTo(0, document.body.scrollHeight));
    await sleep(100);
    const after = await page.evaluate(()=>{ const r = document.getElementById('appBack').getBoundingClientRect(); return {top: r.top, scrolled: window.scrollY}; });
    check('...still there, scrolled to the bottom', after.scrolled>200 && after.top>=0 && after.top<40, JSON.stringify(after));
    const lenOnPage = await page.evaluate(()=> history.length);
    await Promise.all([page.waitForNavigation(), page.tap('#appBack')]);
    await sleep(1300);
    check('Back to Altiro: back in the app, on Settings (not Today)', await onScreen(page)==='settings', await onScreen(page));
    check('...the history doesn\'t pile up (the page was replaced)', await page.evaluate(()=> history.length)===lenOnPage, `${lenOnPage} -> ${await page.evaluate(()=> history.length)}`);
    // Then a plain reopen lands on Today as always.
    await page.reload(); await sleep(1300);
    check('A later reopen: Today, as always', await onScreen(page)==='home');
    check('No page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }

  // ---- Terms and Privacy from Settings ----
  for(const [sel, name, file] of [['#screen-settings .terms-link', 'Terms', 'terms.html'], ['#screen-settings a[href^="privacy.html"]:not([href*="#strava"])', 'Privacy', 'privacy.html']]){
    const {ctx, page} = await openApp();
    await toSettings(page);
    check(`${name}: opens in the app's own window`, await page.evaluate(s=> !document.querySelector(s).getAttribute('target'), sel));
    await Promise.all([page.waitForNavigation(), page.evaluate(s=> document.querySelector(s).click(), sel)]);
    await sleep(200);
    check(`...${file}, with "Back to Altiro"`, page.url().includes(file) && (await page.textContent('#appBack')).trim()==='Back to Altiro');
    await Promise.all([page.waitForNavigation(), page.tap('#appBack')]);
    await sleep(1300);
    check('...and back on Settings', await onScreen(page)==='settings');
    await ctx.close();
  }

  // ---- In Spanish ----
  {
    const {ctx, page} = await openApp('es');
    await toSettings(page);
    check('In Spanish: the link goes to the Spanish part', await page.evaluate(()=> document.getElementById('settingsSupportLink').getAttribute('href'))==='support.html#es');
    await Promise.all([page.waitForNavigation(), page.tap('#settingsSupportLink')]);
    await sleep(200);
    check('...and the bar says "Volver a Altiro"', (await page.textContent('#appBack')).trim()==='Volver a Altiro');
    await Promise.all([page.waitForNavigation(), page.tap('#appBack')]);
    await sleep(1300);
    check('...back on Ajustes', await onScreen(page)==='settings');
    await ctx.close();
  }

  // ---- Opened straight from the web (getaltiro.app/support.html): the bar opens the app ----
  {
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true });
    const page = await ctx.newPage();
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    await page.goto(base + 'support.html');
    const href = await page.evaluate(()=> document.getElementById('appBack').getAttribute('href'));
    check('Opened from the web: "Back to Altiro" goes to the app', href==='./');
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
