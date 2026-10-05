const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Getting back into the store app: Strava's sign-in and the sign-up confirmation email both land on the
// website (the only address Strava and Supabase send people back to), which hands them back to the app
// through altiro:// links -- never carrying a sign-in, only Strava's one-time code.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const callback = fs.readFileSync(path.join(__dirname, '..', 'www', 'strava-callback.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

function backend(opts){
  const log = {invokes: [], signUps: []};
  const user = {id:'u1', email:'sam@example.com', user_metadata: opts.metadata || {}};
  let session = opts.signedIn ? {user, access_token:'t'} : null;
  function from(table){
    const api = { select(){return api;}, eq(){return api;}, order(){return api;}, in(){return api;}, is(){return api;}, gte(){return api;}, lte(){return api;}, limit(){return api;}, not(){return api;},
      upsert(){return api;}, update(){return api;}, insert(){return api;}, delete(){return api;},
      maybeSingle(){ return Promise.resolve({data: table==='profiles' && session ? {id:'u1', full_name:'Sam', goal:'mix', level:'intermediate', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, plan_start:'2026-09-14'} : null, error:null}); },
      single(){ return api.maybeSingle(); }, then(res, rej){ return Promise.resolve({data:[], error:null}).then(res, rej); } };
    return api;
  }
  return {log, client: {
    auth: { async getSession(){ return {data:{session}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async signOut(){ session = null; return {}; },
      async signUp(o){ log.signUps.push(o); return {data:{user:{...user, email:o.email}, session:null}, error:null}; } },
    from,
    functions: { async invoke(name, o){
      log.invokes.push({name, body:o.body});
      if(name==='strava' && o.body.action==='connect') return {data:{connected:true, athlete_name:'Sam Runner', fetched:0}, error:null};
      if(name==='strava' && o.body.action==='authorize_url') return {data:{url:'https://www.strava.com/oauth/authorize?client_id=1&redirect_uri='+encodeURIComponent(o.body.redirect_uri)}, error:null};
      return {data:{connected:false}, error:null};
    } },
  }};
}
async function open(opts){
  const be = backend(opts);
  const listeners = {};
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: opts.url || 'https://localhost/',
    beforeParse(w){
      if(opts.native) w.Capacitor = { isNativePlatform: () => true, Plugins: { App: { addListener(n, fn){ listeners[n] = fn; return Promise.resolve({remove(){}}); }, getLaunchUrl: async () => (opts.launchUrl ? {url: opts.launchUrl} : undefined) } } };
      w.supabase = { createClient: () => be.client };
      w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      if(opts.pendingEmail) w.localStorage.setItem('altiro_pending_signup', JSON.stringify({email: opts.pendingEmail, at: Date.now(), fields: {}}));
    } });
  await wait(300);
  return {w: dom.window, doc: dom.window.document, log: be.log, listeners};
}

(async () => {
  // ---- Strava from the store app ----
  {
    const {doc, log, listeners} = await open({native:true, signedIn:true});
    const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    go('settings'); await wait(20);
    doc.getElementById('stravaConnectBtn').click(); await wait(30);
    const auth = log.invokes.find(c=>c.body && c.body.action==='authorize_url');
    check('Connecting Strava from the app: Strava sends the reply to the website\'s callback page', auth && auth.body.redirect_uri==='https://heraclio580-oss.github.io/Altiro/strava-callback.html', auth && auth.body.redirect_uri);
    check('The app listens for altiro:// links', typeof listeners.appUrlOpen==='function');
    listeners.appUrlOpen({url:'altiro://strava-callback?state=native&code=abc123&scope=read,activity:read_all'}); await wait(40);
    const connect = log.invokes.find(c=>c.body && c.body.action==='connect');
    check('Strava\'s reply handed back to the app finishes the connection', connect && connect.body.code==='abc123' && /activity:read_all/.test(connect.body.scope), JSON.stringify(connect && connect.body));
    check('...and shows it connected', /Sam Runner/.test(doc.getElementById('screen-settings').textContent));
  }
  // ---- the callback page, from the app ----
  {
    const dom = new JSDOM(callback, { runScripts: 'dangerously', url: 'https://heraclio580-oss.github.io/Altiro/strava-callback.html?state=native&code=abc123&scope=read' });
    await wait(20);
    const a = dom.window.document.getElementById('back');
    check('The website\'s callback page sends a reply for the app back to the app (with a button too)', !a.hidden && a.getAttribute('href')==='altiro://strava-callback?state=native&code=abc123&scope=read' && /Open Altiro/.test(a.textContent));
    check('...and keeps nothing for the website', dom.window.localStorage.getItem('altiro_strava_callback')===null);
    const web = new JSDOM(callback, { runScripts: 'dangerously', url: 'https://heraclio580-oss.github.io/Altiro/strava-callback.html?code=xyz&scope=read' });
    await wait(20);
    check('From the website itself: as before', web.window.document.getElementById('back').hidden && /xyz/.test(web.window.localStorage.getItem('altiro_strava_callback')||''));
  }
  // ---- signing up in the app, confirming in the phone's browser ----
  {
    const {w, doc, log} = await open({native:true, signedIn:false});
    const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    go('onb-account'); await wait(20);
    const email = doc.getElementById('emailInput'), pw = doc.getElementById('passwordInput');
    email.value = 'new@example.com'; email.dispatchEvent(new w.Event('input', {bubbles:true}));
    pw.value = 'secret123'; pw.dispatchEvent(new w.Event('input', {bubbles:true}));
    doc.getElementById('emailSignupBtn').click(); await wait(40);
    const su = log.signUps[0];
    check('A sign-up in the app says so (for the confirmation link)', su && su.options.data && su.options.data.signup_source==='app', JSON.stringify(su && su.options));
  }
  {
    const {doc} = await open({native:false, signedIn:true, metadata:{signup_source:'app'}, url:'https://heraclio580-oss.github.io/Altiro/#access_token=x&refresh_token=y&type=signup'});
    const ov = doc.getElementById('appHandoffOverlay');
    check('Confirmed in the browser: "Email confirmed -- Open Altiro"', !ov.hidden && doc.getElementById('appHandoffOpen').getAttribute('href')==='altiro://confirmed' && /Go back to the Altiro app/.test(ov.textContent));
    check('...without signing in on the website', !doc.getElementById('screen-welcome').hidden);
    doc.getElementById('appHandoffWeb').click(); await wait(60);
    check('...or carry on in the browser', ov.hidden && !doc.getElementById('screen-home').hidden);
  }
  {
    const {doc} = await open({native:false, signedIn:true, metadata:{signup_source:'web'}, url:'https://heraclio580-oss.github.io/Altiro/#access_token=x&refresh_token=y&type=signup'});
    check('A website sign-up confirmed: straight in, as before', doc.getElementById('appHandoffOverlay').hidden && !doc.getElementById('screen-home').hidden);
  }
  {
    const {doc, listeners} = await open({native:true, signedIn:false, pendingEmail:'new@example.com'});
    listeners.appUrlOpen({url:'altiro://confirmed'}); await wait(20);
    check('"Open Altiro": the app opens to sign in, email filled in, saying it\'s confirmed', !doc.getElementById('screen-onb-account').hidden && doc.getElementById('emailInput').value==='new@example.com' && /Email confirmed/.test(doc.getElementById('authError').textContent));
  }
  {
    const {doc} = await open({native:true, signedIn:false, pendingEmail:'new@example.com', launchUrl:'altiro://confirmed'});
    check('...also when the link starts the app', !doc.getElementById('screen-onb-account').hidden && /Email confirmed/.test(doc.getElementById('authError').textContent));
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
