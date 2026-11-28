const fs = require('fs');
const path = require('path');
const http = require('http');

// The welcome screen is also the website's homepage (after the website audit): it says what Altiro is and
// who it's for (hybrid running + strength), shows a sample week, has the start buttons up top (the bottom
// ones only once those scroll away), prices under the free week (before Pro launches: free for life; in an
// iPhone's browser: Pro free there), common questions, links to the other pages, and a list for the iPhone
// app. The Prototype Navigator isn't there for visitors (only with ?proto). Proof blocks (count, tester
// quotes, founder) stay hidden until real content is filled in. The head has a real title, description,
// share tags and structured data; robots.txt, sitemap.xml, llms.txt, the hybrid-training guide and the
// changelog exist. Skipped without Playwright.
let chromium;
for(const p of ['playwright', '/opt/node22/lib/node_modules/playwright']){ try{ ({ chromium } = require(p)); break; }catch(e){} }
if(!chromium){ console.log('(Playwright not installed -- skipped)'); process.exit(0); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const www = path.join(__dirname, '..', 'www');
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

// ---- The files themselves ----
const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));
const title = (head.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
check('Title names the category, under 60 characters', /Hybrid Running \+ Strength/.test(title) && title.length < 60, title);
const desc = (head.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
check('A meta description of about 155 characters', desc.length >= 120 && desc.length <= 160, desc.length);
for(const t of ['og:title', 'og:description', 'og:image', 'og:url']) check(`Share tag ${t}`, new RegExp(`property="${t}" content="[^"]+"`).test(head));
check('Twitter card', /name="twitter:card" content="summary_large_image"/.test(head));
check('The share image exists', fs.existsSync(path.join(www, 'img', 'og-image.png')));
let ld = null;
try{ ld = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]); }catch(e){}
const types = ld ? ld['@graph'].map(n=> n['@type']) : [];
check('Structured data: organization, app with both prices, FAQ', ['Organization', 'SoftwareApplication', 'FAQPage'].every(t=> types.includes(t))
  && JSON.stringify(ld).includes('"7.99"') && JSON.stringify(ld).includes('"49.99"'), types.join(','));
const faqLd = ld && ld['@graph'].find(n=> n['@type']==='FAQPage');
check('...the FAQ schema has the same 6 questions as the page', faqLd && faqLd.mainEntity.length===6 && faqLd.mainEntity.every(q=> html.includes(`>${q.name.replace(/'/g, '&#x27;')}</summary>`) || html.includes(`>${q.name}</summary>`)));
check('Fonts don\'t block the first paint', /fonts\.googleapis\.com\/css2[^>]*media="print" onload="this\.media='all'"/.test(head));
check('The navigator isn\'t in the page for visitors (only built with ?proto)', !/<div class="proto-nav">/.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')));
check('No "Supabase" staging note on the account screen', !/created with Supabase/.test(html) && /saved to your account automatically/.test(html));
check('No real-looking demo person', !/Jordan Rivera|jordan\.rivera/.test(html));
check('The paywall\'s prices are in the page before any script runs', /id="paywallYearlyPrice">\$49\.99</.test(html) && /id="paywallMonthlyPrice">\$7\.99</.test(html));
const robots = fs.existsSync(path.join(www, 'robots.txt')) ? fs.readFileSync(path.join(www, 'robots.txt'), 'utf8') : '';
check('robots.txt allows everything and points to the sitemap', /Allow: \//.test(robots) && /Sitemap: https:\/\/getaltiro\.app\/sitemap\.xml/.test(robots));
const sitemap = fs.existsSync(path.join(www, 'sitemap.xml')) ? fs.readFileSync(path.join(www, 'sitemap.xml'), 'utf8') : '';
const locs = [...sitemap.matchAll(/<loc>https:\/\/getaltiro\.app\/([^<]*)<\/loc>/g)].map(m=> m[1]);
check('sitemap.xml lists the pages, and each exists', locs.length >= 6 && locs.every(l=> fs.existsSync(path.join(www, l || 'index.html'))), locs.join(','));
const llms = fs.existsSync(path.join(www, 'llms.txt')) ? fs.readFileSync(path.join(www, 'llms.txt'), 'utf8') : '';
check('llms.txt says what it is, the prices and the key pages', /^# Altiro/.test(llms) && /\$7\.99/.test(llms) && /\$49\.99/.test(llms) && /hybrid-training\.html/.test(llms) && /changelog\.html/.test(llms));
const guide = fs.readFileSync(path.join(www, 'hybrid-training.html'), 'utf8');
const words = guide.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
check('Hybrid training guide: about 600 words, the plan\'s real sessions', words >= 550 && ['Long Run', 'Tempo Run', 'Easy Run', 'Leg Day', 'deload'].every(w=> guide.includes(w)), words);
const changelog = fs.readFileSync(path.join(www, 'changelog.html'), 'utf8');
check('Changelog: dated entries', (changelog.match(/<time datetime="2026-\d\d-\d\d">/g) || []).length >= 10);
for(const f of ['hybrid-training.html', 'changelog.html']){
  const p = fs.readFileSync(path.join(www, f), 'utf8');
  check(`${f}: title, description, canonical, back bar`, /<title>[^<]+<\/title>/.test(p) && /name="description"/.test(p) && /rel="canonical"/.test(p) && /id="appBack"/.test(p));
}

(async () => {
  const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.webmanifest':'application/manifest+json'};
  const server = http.createServer((req, res)=>{
    let f = path.join(www, decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, ''));
    if(fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if(!f.startsWith(www) || !fs.existsSync(f)){ res.writeHead(404); return res.end(); }
    res.writeHead(200, {'Content-Type': mime[path.extname(f)] || 'application/octet-stream'});
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=> server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  async function open(kind, opts){
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile: kind!=='desktop', hasTouch: kind!=='desktop', userAgent: UA[kind] });
    const page = await ctx.newPage();
    const errors = [], joined = [];
    page.on('pageerror', e=> errors.push(e.message));
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    // (The iPhone list's insert, answered here instead of by Supabase.)
    await page.route(u=> /\/rest\/v1\/ios_waitlist/.test(u.href), r=>{
      if(r.request().method()==='OPTIONS') return r.fulfill({status: 204, headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}});
      joined.push(JSON.parse(r.request().postData() || 'null'));
      return opts.waitlistFails ? r.fulfill({status: 500, body: '{}', headers: {'access-control-allow-origin': '*'}}) : r.fulfill({status: 201, body: '', headers: {'access-control-allow-origin': '*'}});
    });
    await page.addInitScript(o=>{
      if(o.lang) localStorage.setItem('altiro_lang', o.lang);
      if(o.launch) window.__ALTIRO_TEST_PRO_LAUNCH__ = o.launch;
    }, opts);
    await page.goto(base + 'index.html' + (opts.proto ? '?proto' : ''));
    await sleep(800);
    return {ctx, page, errors, joined};
  }
  const shown = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); if(!e || e.hidden || e.closest('[hidden]')) return false; return getComputedStyle(e).display!=='none'; }, sel);
  const txt = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g,' ').trim() : null; }, sel);

  // ---- A visitor on a computer, after Pro launched ----
  {
    const {ctx, page, errors, joined} = await open('desktop', {launch: '2026-01-01T00:00:00Z'});
    check('No Prototype Navigator for a visitor', await page.evaluate(()=> !document.querySelector('.proto-nav') && !document.getElementById('protoPills') && !document.body.innerText.includes('Prototype Navigator')));
    check('One h1, naming the category', await page.evaluate(()=> document.querySelectorAll('h1').length===1 && /hybrid running \+ strength planner/.test(document.querySelector('h1').textContent)));
    check('The pain line is the eyebrow above it, the tagline beneath', await page.evaluate(()=>{
      const e = document.querySelector('.welcome-eyebrow'), h = document.querySelector('#screen-welcome h1'), t = document.querySelector('#screen-welcome .tagline');
      return /Finding time to work out is hard/.test(e.textContent) && (e.compareDocumentPosition(h) & 4) && (h.compareDocumentPosition(t) & 4) && t.textContent==='Your pace, your plan.';
    }));
    check('A sample week shows on the first screen, with day names', await page.evaluate(()=>{
      const w = document.querySelector('.hero-week'), r = w.getBoundingClientRect();
      return r.top < 844 && w.querySelectorAll('.tm-row').length===6 && w.querySelector('[data-hero-dow="0"]').textContent==='MON' && /Long Run/.test(w.textContent);
    }));
    check('The start buttons are up top, and the bottom ones are hidden meanwhile', await shown(page, '#heroCta [data-go="onb-goal"]') && await shown(page, '#welcomeSignInBtn') && !(await shown(page, '.welcome-footer')));
    await page.evaluate(()=> document.getElementById('screen-welcome').scrollTop = 99999); await sleep(300);
    check('...scrolled past them, the bottom ones stick to the screen', await shown(page, '.welcome-footer') && await page.evaluate(()=>{ const r = document.querySelector('.welcome-footer').getBoundingClientRect(); return r.bottom <= 844 + 1 && r.top < 844; }));
    check('Bullets: runs and lifts in one plan, hard days apart, Strava, GPS, sets, progress', await page.evaluate(()=>{
      const t = document.querySelector('.welcome-bullets').textContent;
      return /two plans that ignore each other/.test(t) && /Hard days are spaced apart/.test(t) && /Strava/.test(t) && /GPS/.test(t) && /every set/.test(t) && /progress/.test(t);
    }));
    check('Who it\'s for, and who it isn\'t', /run and lift in the same week/.test(await txt(page, '.welcome-fit')) && /Not for:/.test(await txt(page, '.welcome-fit')));
    check('After launch: the price line under the free week', await txt(page, '#trialPrice')==='Then Altiro Pro from $4.17/mo, billed $49.99 a year, or $7.99 month to month. First week free, no card.', await txt(page, '#trialPrice'));
    check('No made-up proof: count, quotes and founder hidden until filled in', !(await shown(page, '#proofCount')) && !(await shown(page, '#testerQuotes')) && !(await shown(page, '#founderBlock')));
    check('Google Play badge labeled "Get the Android app"', await shown(page, '#welcomePlay') && await txt(page, '.play-get-t')==='Get the Android app');
    check('The iPhone list shows on the website', await shown(page, '#iphoneList') && /iPhone version coming/.test(await txt(page, '.iphone-list-t')) && !(await shown(page, '#iphoneListSub')));
    check('6 questions, the first one opens', await page.evaluate(()=>{
      const d = document.querySelectorAll('.welcome-faq details'); d[0].querySelector('summary').click();
      return d.length===6 && d[0].open && /\$7\.99 a month or \$49\.99 a year/.test(d[0].textContent);
    }));
    check('Links to the guide, changelog, support, privacy and terms', await page.evaluate(()=> ['hybrid-training.html', 'changelog.html', 'support.html', 'privacy.html', 'terms.html'].every(h=> document.querySelector(`.welcome-links a[href="${h}"]`))));
    // The iPhone list: a bad address, then a good one.
    await page.fill('#iphoneListEmail', 'not-an-email'); await page.click('#iphoneListBtn'); await sleep(200);
    check('iPhone list: a bad address is caught, nothing sent', /valid email/.test(await txt(page, '#iphoneListMsg')) && joined.length===0);
    await page.fill('#iphoneListEmail', ' Runner@Example.com '); await page.click('#iphoneListBtn'); await sleep(800);
    check('...a good one is saved to ios_waitlist (lower case, language, where from)', joined.length===1 && JSON.stringify(joined[0]).includes('"email":"runner@example.com"') && JSON.stringify(joined[0]).includes('"lang":"en"') && JSON.stringify(joined[0]).includes('"source":"web"'), JSON.stringify(joined));
    check('...and it says so, with the box gone', /You're on the list/.test(await txt(page, '#iphoneListMsg')) && !(await page.isVisible('#iphoneListEmail')));
    await page.reload(); await sleep(700);
    check('...still on the list after a reload', /You're on the list/.test(await txt(page, '#iphoneListMsg')));
    await page.evaluate(()=> document.getElementById('screen-welcome').scrollTop = 0); await sleep(200);
    await page.click('#heroCta [data-go="onb-goal"]'); await sleep(300);
    check('Start Free Week (up top) starts the questions', await page.evaluate(()=> !document.getElementById('screen-onb-goal').hidden));
    check('No page errors', errors.length===0, errors.join(' | '));
    await ctx.close();
  }
  // ---- The iPhone list when saving fails ----
  {
    const {ctx, page} = await open('desktop', {waitlistFails: true});
    await page.fill('#iphoneListEmail', 'a@b.co'); await page.click('#iphoneListBtn'); await sleep(800);
    check('iPhone list: when saving fails, it says so and the box stays', /Couldn't add you/.test(await txt(page, '#iphoneListMsg')) && await page.isVisible('#iphoneListEmail'));
    await ctx.close();
  }
  // ---- Before Pro launches ----
  {
    const {ctx, page} = await open('android', {launch: '2099-01-01T00:00:00Z'});
    check('Before launch: Pro\'s prices from December 1, free for life before then', /from December 1\. Make your account before then and Pro is free for life\./.test(await txt(page, '#trialPrice')) && /\$7\.99/.test(await txt(page, '#trialPrice')));
    await ctx.close();
  }
  // ---- iPhone, in the browser, after launch ----
  {
    const {ctx, page} = await open('iphone', {launch: '2026-01-01T00:00:00Z'});
    check('iPhone: Pro free in the browser, Android prices said as such', /On iPhone, Pro is free in the browser/.test(await txt(page, '#trialPrice')));
    check('iPhone: no Play badge, the iPhone list with its "until then" line', !(await shown(page, '#welcomePlay')) && await shown(page, '#iphoneList') && await shown(page, '#iphoneListSub'));
    await ctx.close();
  }
  // ---- In Spanish ----
  {
    const {ctx, page} = await open('desktop', {lang: 'es', launch: '2026-01-01T00:00:00Z'});
    check('Spanish: the h1, the price line, the questions and the day names', /planificador híbrido/.test(await txt(page, '#screen-welcome h1')) && /Altiro Pro desde \$4\.17 al mes/.test(await txt(page, '#trialPrice'))
      && await txt(page, '#faqTitle')==='Preguntas frecuentes' && await txt(page, '[data-hero-dow="0"]')==='LUN', await txt(page, '#trialPrice'));
    await ctx.close();
  }
  // ---- The team's navigator, with ?proto ----
  {
    const {ctx, page} = await open('desktop', {proto: true});
    check('With ?proto the navigator is there, with its pills', await page.evaluate(()=> !!document.querySelector('.proto-nav') && document.querySelectorAll('.proto-pill').length > 10));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
