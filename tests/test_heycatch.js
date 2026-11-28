const fs = require('fs');
const path = require('path');
const http = require('http');

// HeyCatch analytics (heycatch.ai/agents.md), with a stand-in for the SDK that records what the app asks
// of it: the app and its other pages start it (project key, "web", "claude-code"; the separate pages send
// right away); a signed-in account is identified by its ID with its email and name, and the day it was
// made; a new account's sign-up is sent once; the plan goes with it; signing out starts the next person
// anonymous. And with the SDK unreachable (offline, blocked), the app works as before. Skipped without
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
const SDK_URL = 'https://esm.sh/@heycatch/sdk@0.8.5';
const KEY = 'hck_pk_lLJ2SwhN4rLJ0wp-8UntgVCFFkwVs-DN';
// The stand-in SDK: the same calls as @heycatch/sdk's `analytics`, recorded in window.__hc.
const FAKE_SDK = `const log = (window.__hc = window.__hc || []);
const rec = name => (...args) => { log.push([name, ...args]); };
export const analytics = { init: rec('init'), setIdentity: rec('setIdentity'), resetIdentity: rec('resetIdentity'), trackEvent: rec('trackEvent'), setPersonProperties: rec('setPersonProperties') };`;
// A signed-in account (nothing leaves the page).
const FAKE = (o)=>{
  window.__ALTIRO_TEST_TODAY__ = '2026-11-28';
  try{ localStorage.setItem('altiro_tour_done', '1'); localStorage.setItem('altiro_install_nudge_dismissed', '1'); }catch(e){}
  if(!o.user) return;
  const user = {id: 'u-123', email: 'sam@example.com', created_at: o.createdAt, user_metadata: {full_name: 'Sam Rivers'}, app_metadata: {provider: o.provider || 'email'}};
  const rows = {profiles: [{id:'u-123', goal:'mix', level:'intermediate', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, weekly_miles:10, equipment:'gym', plan_start:'2026-11-02'}]};
  const from = t => { const api = { select(){return api;}, eq(){return api;}, order(){return api;}, in(){return api;}, is(){return api;}, not(){return api;}, gte(){return api;}, lte(){return api;}, limit(){return api;},
    upsert(){return api;}, update(){return api;}, insert(){return api;}, delete(){return api;},
    maybeSingle(){ return Promise.resolve({data:(rows[t]||[])[0]||null, error:null}); }, single(){ return api.maybeSingle(); },
    then(res,rej){ return Promise.resolve({data: rows[t]||[], error:null}).then(res,rej); } }; return api; };
  let signedOut = false;
  const client = { auth: { async getSession(){ return {data:{session: signedOut ? null : {user, access_token:'t'}}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async signOut(){ signedOut = true; return {}; } },
    from, functions:{ async invoke(){ return {data:{connected:false}, error:null}; } } };
  Object.defineProperty(window, 'supabase', { value: { createClient: () => client }, writable: false, configurable: false });
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
  async function open(o){
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e=> errors.push(e.message));
    await page.route(u=> u.href===SDK_URL, r=> o.sdkDown ? r.abort() : r.fulfill({status:200, contentType:'text/javascript', headers:{'Access-Control-Allow-Origin':'*'}, body: FAKE_SDK}));
    await page.route(u=> !u.href.startsWith(base) && u.href!==SDK_URL, r=> r.abort());
    await page.route(/vendor\/supabase\.js/, r=> r.fulfill({status:200, contentType:'text/javascript', body:''}));
    await page.route(/sw\.js$/, r=> r.fulfill({status:404, body:''}));
    await page.addInitScript(FAKE, o);
    await page.goto(base + (o.page || ''));
    await sleep(1500);
    return {ctx, page, errors, log: ()=> page.evaluate(()=> window.__hc || [])};
  }
  const calls = (log, name)=> log.filter(c=> c[0]===name);

  // ---- A visitor (not signed in) ----
  {
    const {ctx, log, errors} = await open({});
    const l = await log();
    const init = calls(l, 'init');
    check('The app starts HeyCatch once, with the project key, "web" and "claude-code"', init.length===1 && init[0][1].projectKey===KEY && init[0][1].install.framework==='web' && init[0][1].install.agent==='claude-code' && !('apiHost' in init[0][1]) && !('requestBatching' in init[0][1]), JSON.stringify(init));
    check('...a visitor isn\'t identified, and nothing else is sent by the app', l.length===1, JSON.stringify(l));
    check('No page errors', !errors.length, errors.join(' | '));
    await ctx.close();
  }

  // ---- A new account, signed in ----
  const made = new Date(Date.now() - 3600000).toISOString();
  {
    const {ctx, page, log} = await open({user: true, createdAt: made, provider: 'google'});
    let l = await log();
    const id = calls(l, 'setIdentity');
    check('Signed in: identified by the account ID, with email and name, and the day it was made (once)', id.length===1 && id[0][1]==='u-123' && id[0][2].email==='sam@example.com' && id[0][2].name==='Sam Rivers' && id[0][3] && id[0][3].signup_date===made, JSON.stringify(id));
    const su = calls(l, 'trackEvent').filter(c=> c[1]==='signup_completed');
    check('...a new account: "signup_completed" sent once, with how they signed up (google)', su.length===1 && su[0][2].method==='google', JSON.stringify(su));
    check('...after identifying (so it\'s theirs)', l.findIndex(c=> c[0]==='setIdentity') < l.findIndex(c=> c[0]==='trackEvent'));
    const plan = calls(l, 'setPersonProperties');
    check('...and their plan (Pro, joined before launch)', plan.length===1 && plan[0][1].plan==='pro' && plan[0][1].pro_source==='early', JSON.stringify(plan));
    await page.reload(); await sleep(1500);
    l = await log();
    check('Opened again: identified again, but no second sign-up', calls(l, 'setIdentity').length===1 && !calls(l, 'trackEvent').some(c=> c[1]==='signup_completed'), JSON.stringify(l));
    await page.evaluate(()=> document.querySelector('#bottomNav [data-tab="settings"]').click()); await sleep(200);
    await page.evaluate(()=> document.getElementById('signOutBtn').click()); await sleep(800);
    l = await log();
    check('Signing out: the next person starts anonymous', calls(l, 'resetIdentity').length===1, JSON.stringify(l));
    await ctx.close();
  }

  // ---- An account made long ago ----
  {
    const {ctx, log} = await open({user: true, createdAt: '2026-10-01T10:00:00Z'});
    const l = await log();
    check('An older account signing in: identified, no sign-up event', calls(l, 'setIdentity').length===1 && !calls(l, 'trackEvent').length, JSON.stringify(l));
    await ctx.close();
  }

  // ---- The other pages ----
  for(const pg of ['support.html', 'terms.html', 'privacy.html', 'delete-account.html']){
    const {ctx, log} = await open({page: pg});
    const init = calls(await log(), 'init');
    check(`${pg}: HeyCatch starts, sending right away (requestBatching off)`, init.length===1 && init[0][1].projectKey===KEY && init[0][1].requestBatching===false, JSON.stringify(init));
    await ctx.close();
  }

  // ---- HeyCatch unreachable ----
  {
    const {ctx, page, errors} = await open({user: true, createdAt: made, sdkDown: true});
    const home = await page.evaluate(()=> !document.getElementById('screen-home').hidden);
    check('HeyCatch unreachable: the app still opens and signs in as before, no page errors', home && !errors.length, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
