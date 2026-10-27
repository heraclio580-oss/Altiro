const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Sign in with Apple, next to Google: the button shows once Apple is switched on in Supabase (its public
// auth settings say so), and is remembered for next time. On the website it signs in like Google. In the
// store app, Google's and Apple's sign-in open in the phone's browser and come back through
// auth-callback.html and an altiro:// link carrying only a one-time code, which the app trades for the
// sign-in with the key it kept (PKCE) -- never the sign-in itself.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const callback = fs.readFileSync(path.join(__dirname, '..', 'www', 'auth-callback.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

function backend(opts){
  const log = {oauth: [], clients: [], exchanged: [], setSession: []};
  const user = {id:'u1', email: opts.noEmail ? undefined : 'sam@example.com', user_metadata:{}};
  let session = null;
  function from(table){
    const api = { select(){return api;}, eq(){return api;}, order(){return api;}, in(){return api;}, is(){return api;}, gte(){return api;}, lte(){return api;}, limit(){return api;}, not(){return api;},
      upsert(){return api;}, update(){return api;}, insert(){return api;}, delete(){return api;},
      maybeSingle(){ return Promise.resolve({data: table==='profiles' && session ? {id:'u1', full_name:'Sam', goal:'mix', level:'intermediate', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, plan_start:'2026-09-14'} : null, error:null}); },
      single(){ return api.maybeSingle(); }, then(res, rej){ return Promise.resolve({data:[], error:null}).then(res, rej); } };
    return api;
  }
  const client = settings => {
    log.clients.push(settings || null);
    const pkce = !!(settings && settings.auth && settings.auth.flowType==='pkce');
    return {
      auth: {
        async getSession(){ return {data:{session: pkce ? null : session}}; },
        onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
        async signOut(){ session = null; return {}; },
        async signInWithOAuth(o){ log.oauth.push({...o, pkce}); return {data:{}, error: opts.oauthError ? {message: opts.oauthError} : null}; },
        async exchangeCodeForSession(code){ log.exchanged.push({code, pkce}); return code==='good' ? {data:{session:{access_token:'A', refresh_token:'R', user}}, error:null} : {data:{session:null}, error:{message:'invalid code'}}; },
        async setSession(t){ log.setSession.push({...t, pkce}); session = {user, ...t}; return {data:{session}, error:null}; },
      },
      from,
      functions: { async invoke(){ return {data:{connected:false}, error:null}; } },
    };
  };
  return {log, createClient: (url, key, settings) => client(settings)};
}
async function open(opts){
  const be = backend(opts);
  const listeners = {}, fetches = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: opts.url || 'https://getaltiro.app/',
    beforeParse(w){
      if(opts.native) w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { App: { addListener(n, fn){ listeners[n] = fn; return Promise.resolve({remove(){}}); }, getLaunchUrl: async () => undefined } } };
      w.supabase = { createClient: be.createClient };
      w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      if(opts.remembered) w.localStorage.setItem('altiro_auth_providers', JSON.stringify(opts.remembered));
      if(opts.settings!==undefined) w.fetch = async (url, o) => {
        fetches.push({url, apikey: o && o.headers && o.headers.apikey});
        if(opts.settings===null) throw new Error('offline');
        return {ok:true, json: async () => ({external: opts.settings})};
      };
    } });
  await wait(300);
  const doc = dom.window.document;
  const toAccount = async () => { doc.getElementById('welcomeSignInBtn').click(); await wait(20); };
  return {w: dom.window, doc, log: be.log, listeners, fetches, toAccount};
}
const shown = (doc, id) => !doc.getElementById(id).hidden;

(async () => {
  // ---- Apple not switched on yet (today) ----
  {
    const {doc, fetches, toAccount, w} = await open({settings: {google:true, apple:false, email:true}});
    check('Starting the app doesn\'t ask (only the sign-in screen does)', fetches.length===0, fetches.length);
    await toAccount();
    check('Apple not switched on in Supabase: no Apple button; Google as before', !shown(doc, 'appleSignInBtn') && shown(doc, 'googleSignInBtn') && shown(doc, 'authDivider'));
    check('...(asked of Supabase\'s public sign-in settings, with the public key)', fetches.length===1 && /\/auth\/v1\/settings$/.test(fetches[0].url) && !!fetches[0].apikey);
    check('...and remembered', w.localStorage.getItem('altiro_auth_providers')==='{"google":true,"apple":false}');
  }
  // ---- Switched on ----
  {
    const {doc, log, toAccount, w} = await open({settings: {google:true, apple:true}});
    await toAccount();
    check('Apple switched on: "Sign in with Apple", under Google', shown(doc, 'appleSignInBtn') && /Sign in with Apple/.test(doc.getElementById('appleSignInBtn').textContent)
      && !!(doc.getElementById('googleSignInBtn').compareDocumentPosition(doc.getElementById('appleSignInBtn')) & w.Node.DOCUMENT_POSITION_FOLLOWING));
    doc.getElementById('appleSignInBtn').click(); await wait(30);
    const o = log.oauth[0];
    check('On the website it signs in with Apple and comes back to the website', o && o.provider==='apple' && !o.pkce && o.options.redirectTo==='https://getaltiro.app/', JSON.stringify(o));
    check('...saying it\'s signing in', /Signing in/i.test(doc.getElementById('appleSignInBtn').textContent));
  }
  // ---- Remembered from last time, offline now ----
  {
    const {doc, toAccount} = await open({settings: null, remembered: {google:true, apple:true}});
    await toAccount();
    check('Offline: the buttons as remembered', shown(doc, 'appleSignInBtn') && shown(doc, 'googleSignInBtn'));
  }
  // ---- Neither switched on ----
  {
    const {doc, toAccount} = await open({settings: {google:false, apple:false, email:true}});
    await toAccount();
    check('Neither switched on: no buttons that can\'t work, and no "Or"', !shown(doc, 'appleSignInBtn') && !shown(doc, 'googleSignInBtn') && !shown(doc, 'authDivider'));
  }
  // ---- A provider that isn't set up says so ----
  {
    const {doc, toAccount} = await open({settings: {google:true, apple:true}, oauthError: 'Unsupported provider: provider is not enabled'});
    await toAccount();
    doc.getElementById('appleSignInBtn').click(); await wait(30);
    check('An error from Supabase is shown, and the button is back', /not enabled/.test(doc.getElementById('authError').textContent) && !doc.getElementById('appleSignInBtn').disabled && /Sign in with Apple/.test(doc.getElementById('appleSignInBtn').textContent));
  }
  // ---- The store app ----
  {
    const {doc, log, listeners, toAccount, w} = await open({native:true, url:'https://localhost/', settings: {google:true, apple:true}});
    await toAccount();
    doc.getElementById('appleSignInBtn').click(); await wait(30);
    const o = log.oauth[0];
    check('In the store app: Apple\'s sign-in comes back to the website\'s hand-back page, not the app\'s own address', o && o.provider==='apple' && o.options.redirectTo==='https://getaltiro.app/auth-callback.html', JSON.stringify(o));
    check('...using the one-time-code way (PKCE), not the website\'s', o && o.pkce);
    doc.getElementById('googleSignInBtn').click(); await wait(30);
    check('...Google the same', log.oauth[1] && log.oauth[1].provider==='google' && log.oauth[1].pkce && log.oauth[1].options.redirectTo==='https://getaltiro.app/auth-callback.html', JSON.stringify(log.oauth[1]));
    w.localStorage.setItem('altiro-oauth-code-verifier', 'v');
    listeners.appUrlOpen({url:'altiro://auth-callback?code=good'}); await wait(300);
    check('Back in the app with the code: it\'s traded for the sign-in', log.exchanged.length===1 && log.exchanged[0].code==='good' && log.exchanged[0].pkce);
    check('...which becomes the app\'s own', log.setSession.length===1 && log.setSession[0].access_token==='A' && log.setSession[0].refresh_token==='R' && !log.setSession[0].pkce);
    check('...signed in, on Today', !doc.getElementById('screen-home').hidden, [...doc.querySelectorAll('.screen')].filter(x=>!x.hidden).map(x=>x.id).join(','));
    check('...and the code\'s key is let go', w.localStorage.getItem('altiro-oauth-code-verifier')===null);
  }
  {
    const {doc, log, listeners} = await open({native:true, url:'https://localhost/', settings: {google:true, apple:true}});
    listeners.appUrlOpen({url:'altiro://auth-callback?access_token=STOLEN&refresh_token=STOLEN'}); await wait(100);
    check('A link carrying a sign-in itself (not a code) isn\'t taken', log.setSession.length===0 && log.exchanged.length===0 && doc.getElementById('screen-home').hidden);
    check('...it says signing in didn\'t finish, on the sign-in screen', !doc.getElementById('screen-onb-account').hidden && /Couldn't finish signing in/.test(doc.getElementById('authError').textContent));
    listeners.appUrlOpen({url:'altiro://auth-callback?error=access_denied&error_description=The+user+cancelled'}); await wait(100);
    check('Cancelled at Apple: says so', /The user cancelled/.test(doc.getElementById('authError').textContent));
  }
  // ---- Signed in with Apple and no email ----
  {
    const {doc, listeners} = await open({native:true, url:'https://localhost/', settings: {google:true, apple:true}, noEmail:true});
    listeners.appUrlOpen({url:'altiro://auth-callback?code=good'}); await wait(300);
    check('An Apple sign-in without an email still gets in', !doc.getElementById('screen-home').hidden);
  }
  // ---- The hand-back page ----
  {
    const dom = new JSDOM(callback, { runScripts: 'dangerously', url: 'https://getaltiro.app/auth-callback.html?code=abc' });
    await wait(20);
    const a = dom.window.document.getElementById('back');
    check('The hand-back page sends the code back to the app (with a button too)', !a.hidden && a.getAttribute('href')==='altiro://auth-callback?code=abc' && /Open Altiro/.test(a.textContent));
    check('...and doesn\'t sign the browser in (no Supabase on it)', !/supabase/i.test(callback.replace(/<!--[\s\S]*?-->|\/\/.*$/gm, '')));
  }
  // ---- Spanish ----
  {
    const {doc, toAccount} = await open({settings: {google:true, apple:true}});
    doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
    await toAccount();
    check('In Spanish: "Continuar con Apple"', /Continuar con Apple/.test(doc.getElementById('appleSignInBtn').textContent));
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
