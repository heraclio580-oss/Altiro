const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Connecting Strava when Altiro's Strava connections are all taken (Strava allows only so many athletes
// until it approves more): a plain message saying so, and that the watch can still sync through the
// phone's health app -- instead of "Couldn't connect to Strava (403)". Nothing is connected.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

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
      if(name==='strava' && o.body.action==='connect') return {data:null, error:{message:'Edge Function returned a non-2xx status code', context:{status:403, json: async()=>({error:'athlete_limit'})}}};
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
      if(opts.native) w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { Health: {}, App: { addListener(n, fn){ listeners[n] = fn; return Promise.resolve({remove(){}}); }, getLaunchUrl: async () => (opts.launchUrl ? {url: opts.launchUrl} : undefined) } } };
      w.supabase = { createClient: () => be.client };
      w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      if(opts.pendingEmail) w.localStorage.setItem('altiro_pending_signup', JSON.stringify({email: opts.pendingEmail, at: Date.now(), fields: {}}));
    } });
  await wait(300);
  return {w: dom.window, doc: dom.window.document, log: be.log, listeners};
}


const toast = doc => doc.getElementById('toastMsg').textContent;
(async () => {
  {
    const {doc, listeners} = await open({native:true, signedIn:true});
    listeners.appUrlOpen({url:'altiro://strava-callback?state=native&code=abc123&scope=read,activity:read_all'}); await wait(60);
    check('The store app, Strava full: says so, and that the watch can sync through Health Connect', /Strava connections are full for now/.test(toast(doc)) && /Health Connect: Settings → Connected Apps/.test(toast(doc)), toast(doc));
    check('...not the bare error', !/Couldn't connect|403/.test(toast(doc)), toast(doc));
    const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    go('settings'); await wait(20);
    check('...and Strava is still not connected (the Connect button is there)', !doc.getElementById('stravaConnectBtn').hidden);
  }
  {
    // The website: the callback page left Strava's reply for the app to finish once signed in.
    const site = await (async () => {
      const be = backend({signedIn:true});
      const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://getaltiro.app/',
        beforeParse(win){ win.supabase = { createClient: () => be.client }; win.__ALTIRO_TEST_TODAY__ = '2026-09-18';
          win.localStorage.setItem('altiro_strava_callback', JSON.stringify({search:'?code=abc123&scope=read,activity:read_all', at: Date.now()})); } });
      await wait(400);
      return dom.window.document;
    })();
    check('On the website: says so, and points to the phone app for watch syncing', /Strava connections are full for now/.test(toast(site)) && /In the Altiro phone app/.test(toast(site)), toast(site));
  }
  {
    const {doc, listeners} = await open({native:true, signedIn:true});
    doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
    listeners.appUrlOpen({url:'altiro://strava-callback?state=native&code=xyz789&scope=read,activity:read_all'}); await wait(60);
    check('In Spanish', /Las conexiones con Strava están llenas/.test(toast(doc)) && /Health Connect/.test(toast(doc)), toast(doc));
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
