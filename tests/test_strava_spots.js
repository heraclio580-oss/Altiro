const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// While Altiro's Strava connections are all taken (Strava allows 10 athletes until it reviews the app),
// people who haven't connected don't see the Connect button -- just a note that the watch can sync
// through the phone's health app. It comes back as soon as the strava function says there's room
// (STRAVA_ATHLETE_LIMIT raised after Strava approves, or someone disconnects). Connected people are
// unaffected.
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
      if(name==='strava' && o.body.action==='sync') return {data: opts.sync(), error:null};
      if(name==='strava' && o.body.action==='disconnect') return {data:{connected:false, spots_open:true}, error:null};
      if(name==='strava' && o.body.action==='authorize_url' && opts.authorizeFull) return {data:null, error:{message:'Edge Function returned a non-2xx status code', context:{status:403, json: async()=>({error:'athlete_limit'})}}};
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
  return {w: dom.window, dom, doc: dom.window.document, log: be.log, listeners};
}



const status = doc => doc.getElementById('stravaStatusText').textContent;
const btn = doc => doc.getElementById('stravaConnectBtn');
const toast = doc => doc.getElementById('toastMsg').textContent;
function goSettings(doc){ [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click(); }
function foreground(w){ w.Object.defineProperty(w.document, 'visibilityState', {value:'visible', configurable:true}); w.document.dispatchEvent(new w.Event('visibilitychange')); }
(async () => {
  {
    let reply = {connected:false, spots_open:false};
    const {w, doc} = await open({native:true, signedIn:true, sync: () => reply});
    goSettings(doc); await wait(20);
    check('Strava full, not connected: no Connect button', btn(doc).hidden);
    check('...a note saying so, pointing to Health Connect above', /Strava connections are full for now/.test(status(doc)) && /Health Connect above/.test(status(doc)), status(doc));
    check('...and no Sync / Disconnect either', doc.getElementById('stravaSyncBtn').hidden && doc.getElementById('stravaDisconnectBtn').hidden);
    doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
    check('...in Spanish too', /Las conexiones con Strava están llenas/.test(status(doc)), status(doc));
    doc.querySelector('.lang-btn[data-lang="en"]').click(); await wait(20);
    // Strava approves; the limit is raised in Supabase -- the next sync (coming back to the app) says there's room.
    reply = {connected:false, spots_open:true};
    w.Date.now = (n => () => n() + 10*60*1000)(w.Date.now);
    foreground(w); await wait(60);
    check('Once there\'s room again: the Connect button is back', !btn(doc).hidden);
    check('...with the usual line', /Import runs from your watch/.test(status(doc)), status(doc));
  }
  {
    const {doc} = await open({native:true, signedIn:true, sync: () => ({connected:true, athlete_name:'Sam Runner', fetched:0})});
    goSettings(doc); await wait(20);
    check('Already connected: unaffected (Sync now and Disconnect, no full note)', !doc.getElementById('stravaSyncBtn').hidden && !doc.getElementById('stravaDisconnectBtn').hidden && !/full/.test(status(doc)), status(doc));
    doc.getElementById('stravaDisconnectBtn').click(); await wait(30);
    check('...after disconnecting (a spot just opened): the Connect button', !btn(doc).hidden);
  }
  {
    const {doc} = await open({sync: () => ({connected:false, spots_open:false}), signedIn:true});
    goSettings(doc); await wait(20);
    check('On the website: no button, and the note points to the phone app', btn(doc).hidden && /In the Altiro phone app/.test(status(doc)), status(doc));
  }
  {
    // An older answer without spots_open (the function not redeployed yet): the button stays.
    const {doc} = await open({native:true, signedIn:true, sync: () => ({connected:false})});
    goSettings(doc); await wait(20);
    check('Function not redeployed yet (no spots_open): Connect button as before', !btn(doc).hidden);
  }
  {
    // The count was under the limit when the page loaded, but filled up before they tapped Connect.
    const {doc} = await open({native:true, signedIn:true, authorizeFull:true, sync: () => ({connected:false, spots_open:true})});
    goSettings(doc); await wait(20);
    btn(doc).click(); await wait(40);
    check('Filled up just before tapping Connect: the kind message, not an error', /Strava connections are full for now/.test(toast(doc)) && !/Couldn't connect/.test(toast(doc)), toast(doc));
    check('...and the button goes away', btn(doc).hidden);
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
