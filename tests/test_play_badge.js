const fs = require('fs');
const path = require('path');
const http = require('http');

// Altiro is on Google Play: the website sends people to it. In a browser on Android (and on a computer),
// Google's "Get it on Google Play" badge is on the welcome screen and in Settings ("Get the app"), linking
// to the Play Store listing, in the app's language; on an Android phone, Today's banner offers the app
// ("Get the Altiro app" -- Get it) instead of adding the website to the home screen, and once closed it
// stays closed. On an iPhone (no app yet) none of it shows: the home-screen banner stays. Skipped without
// Playwright.
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
const PLAY = 'https://play.google.com/store/apps/details?id=com.altiro.app';
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

(async () => {
  const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.webmanifest':'application/manifest+json'};
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
  async function open(kind, opts){
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile: kind!=='desktop', hasTouch: kind!=='desktop', userAgent: UA[kind] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e=> errors.push(e.message));
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    if(opts.lang || opts.dismissed) await page.addInitScript(o=>{ if(o.lang) localStorage.setItem('altiro_lang', o.lang); if(o.dismissed) localStorage.setItem('altiro_play_nudge_dismissed', '1'); }, opts);
    await page.goto(base + 'index.html' + (opts.proto ? '?proto' : ''));
    await sleep(700);
    return {ctx, page, errors};
  }
  const shown = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); if(!e || e.hidden || e.closest('[hidden]')) return false; return getComputedStyle(e).display!=='none'; }, sel);
  const txt = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g,' ').trim() : null; }, sel);
  const goto = (page, id)=> page.evaluate(id=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId===id).click(); document.documentElement.classList.remove('proto-on'); }, id);

  // ---- Android, in the browser ----
  {
    const {ctx, page, errors} = await open('android');
    const w = await page.evaluate(()=>{ const a = document.querySelector('#welcomePlay a'), img = a && a.querySelector('img'); return {href: a && a.href, target: a && a.target, src: img && img.getAttribute('src'), alt: img && img.alt}; });
    check('Android browser: the welcome screen has "Get the Android app" and Google Play\'s badge', await shown(page, '#welcomePlay') && /Get the Android app/.test(await txt(page, '#welcomePlay')), await txt(page, '#welcomePlay'));
    check('...linking to the Play Store listing (in a new tab), Google\'s own English badge', w.href===PLAY && w.target==='_blank' && /badges\/en_badge_web_generic\.png$/.test(w.src) && w.alt==='Get it on Google Play', JSON.stringify(w));
    check('No page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }
  {
    const {ctx, page} = await open('android', {proto: true});
    await goto(page, 'home'); await sleep(200);
    check('Android browser, Today: "Get the Altiro app" banner, with "Get it" to Google Play', await shown(page, '#installNudge') && /Get the Altiro app/.test(await txt(page, '#installNudge')) && await shown(page, '#playNudgeGet') && !(await shown(page, '#installNudgeAdd')) && (await page.evaluate(()=> document.getElementById('playNudgeGet').href))===PLAY, await txt(page, '#installNudge'));
    await page.evaluate(()=> document.getElementById('installNudgeClose').click());
    await sleep(100);
    check('...closed, it\'s gone, and stays gone', !(await shown(page, '#installNudge')) && await page.evaluate(()=> localStorage.getItem('altiro_play_nudge_dismissed'))==='1');
    await goto(page, 'settings'); await sleep(200);
    check('Settings: "Get the app" with Google Play\'s badge, not "Add to your Home Screen"', await shown(page, '#settingsPlay') && /Get the app/.test(await txt(page, '#installSection')) && !(await shown(page, '#installBtn')));
    await ctx.close();
  }
  {
    const {ctx, page} = await open('android', {lang: 'es'});
    const src = await page.evaluate(()=> document.querySelector('#welcomePlay img').getAttribute('src'));
    check('In Spanish: "Descarga la app para Android" and Google\'s Spanish badge', /Descarga la app para Android/.test(await txt(page, '#welcomePlay')) && /badges\/es-419_badge_web_generic\.png$/.test(src) && (await page.evaluate(()=> document.querySelector('#welcomePlay img').alt))==='Disponible en Google Play', src);
    await page.evaluate(()=> document.querySelector('.lang-btn[data-lang="en"]').click()); await sleep(100);
    check('...switched to English: the English badge', /badges\/en_badge_web_generic\.png$/.test(await page.evaluate(()=> document.querySelector('#welcomePlay img').getAttribute('src'))));
    await ctx.close();
  }

  // ---- iPhone (no app yet): none of it ----
  {
    const {ctx, page} = await open('iphone', {proto: true});
    check('iPhone browser: no Google Play badge on the welcome screen', !(await shown(page, '#welcomePlay')));
    await goto(page, 'home'); await sleep(200);
    check('...Today\'s banner still offers adding it to the Home Screen', await shown(page, '#installNudge') && /Home Screen/.test(await txt(page, '#installNudge')) && await shown(page, '#installNudgeAdd') && !(await shown(page, '#playNudgeGet')), await txt(page, '#installNudge'));
    await goto(page, 'settings'); await sleep(200);
    check('...and Settings: no Google Play badge', !(await shown(page, '#settingsPlay')) && await shown(page, '#installBtn'));
    await ctx.close();
  }

  // ---- A computer: the badge too ----
  {
    const {ctx, page} = await open('desktop', {proto: true});
    check('A computer: the badge on the welcome screen', await shown(page, '#welcomePlay'));
    await goto(page, 'settings'); await sleep(200);
    check('...and in Settings', await shown(page, '#settingsPlay'));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
