const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Delete account -- required by the App Store and Google Play: in Settings (signed in only), it says what
// goes, needs the word typed, then asks the delete-account Edge Function to delete the account, signs
// out and goes back to the start. A failure says so and keeps them where they are. The same from the
// web page (www/delete-account.html), for Google Play's "delete your account" link.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'www', 'delete-account.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

function fakeClient(opts){
  const log = {invokes: [], signOuts: 0, signIns: []};
  const user = {id:'u1', email:'sam@example.com'};
  let session = opts.signedIn ? {user, access_token:'user-token'} : null;
  function from(){
    const api = { select(){return api;}, eq(){return api;}, order(){return api;}, in(){return api;}, is(){return api;}, gte(){return api;}, lte(){return api;}, limit(){return api;},
      upsert(){return api;}, update(){return api;}, insert(){return api;}, delete(){return api;},
      maybeSingle(){ return Promise.resolve({data:null, error:null}); }, single(){ return api.maybeSingle(); },
      then(res, rej){ return Promise.resolve({data:[], error:null}).then(res, rej); } };
    return api;
  }
  return { log, client: {
    auth: {
      async getSession(){ return {data:{session}}; },
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async signOut(){ log.signOuts++; session = null; return {}; },
      async signInWithPassword(c){ log.signIns.push(c.email); if(c.password!=='right') return {data:{}, error:{message:'Invalid login credentials'}}; session = {user, access_token:'user-token'}; return {data:{user, session}, error:null}; },
    },
    from,
    functions: { async invoke(name, o){
      log.invokes.push({name, body:o.body, headers:o.headers});
      if(name==='delete-account') return opts.deleteFails ? {data:null, error:{message:'Edge Function returned a non-2xx status code', context:{json: async()=>({error:'delete_failed'})}}} : {data:{deleted:true}, error:null};
      return {data:{connected:false}, error:null};
    } },
  } };
}

async function app(opts){
  const fake = fakeClient(opts);
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/Altiro/',
    beforeParse(w){ w.supabase = { createClient: () => fake.client }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(300);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  return {w: dom.window, doc, go, log: fake.log};
}

(async () => {
  // ---- not signed in: nothing to delete ----
  {
    const {doc, go} = await app({signedIn:false});
    go('settings'); await wait(20);
    check('Not signed in: no Delete account', doc.getElementById('deleteAccountBtn').hidden);
  }
  // ---- signed in ----
  {
    const {w, doc, go, log} = await app({signedIn:true});
    go('settings'); await wait(20);
    const btn = doc.getElementById('deleteAccountBtn');
    check('Signed in: Settings has Delete account', !btn.hidden && btn.textContent==='Delete account');
    btn.click(); await wait(20);
    const sheet = doc.getElementById('deleteAccountOverlay'), confirm = doc.getElementById('confirmDeleteAccount'), input = doc.getElementById('deleteAccountInput');
    check('It says what will be deleted, and that it can\'t be undone', !sheet.hidden && /plan, workouts and history/.test(sheet.textContent) && /can't be undone/.test(sheet.textContent));
    check('...and the button waits for the word', confirm.disabled && /Type DELETE to confirm/.test(sheet.textContent));
    const type = v => { input.value = v; input.dispatchEvent(new w.Event('input', {bubbles:true})); };
    type('delet');
    check('...not part of it', confirm.disabled);
    type('delete');
    check('...typed (any case), it\'s ready', !confirm.disabled);
    confirm.click(); await wait(60);
    const call = log.invokes.find(c=>c.name==='delete-account');
    check('Deleting asks the server to delete this account', call && call.body.confirm==='DELETE' && call.headers['x-altiro-user']==='user-token', JSON.stringify(call));
    check('...then signs out and goes back to the start', log.signOuts>=1 && sheet.hidden && !doc.getElementById('screen-welcome').hidden);
    check('...saying so', /account was deleted/.test(doc.getElementById('toastMsg').textContent));
  }
  // ---- a failure ----
  {
    const {w, doc, go, log} = await app({signedIn:true, deleteFails:true});
    go('settings'); await wait(20);
    doc.getElementById('deleteAccountBtn').click(); await wait(20);
    const input = doc.getElementById('deleteAccountInput');
    input.value = 'DELETE'; input.dispatchEvent(new w.Event('input', {bubbles:true}));
    doc.getElementById('confirmDeleteAccount').click(); await wait(60);
    const err = doc.getElementById('deleteAccountError');
    check('If it fails: it says why, and nothing else happens', !err.hidden && /delete_failed/.test(err.textContent) && log.signOuts===0 && !doc.getElementById('deleteAccountOverlay').hidden, err.textContent);
    check('...and it can be tried again', !doc.getElementById('confirmDeleteAccount').disabled);
  }
  // ---- in Spanish ----
  {
    const {w, doc, go} = await app({signedIn:true});
    go('settings'); await wait(10);
    doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
    doc.getElementById('deleteAccountBtn').click(); await wait(20);
    const input = doc.getElementById('deleteAccountInput');
    input.value = 'eliminar'; input.dispatchEvent(new w.Event('input', {bubbles:true}));
    check('In Spanish: Eliminar cuenta, confirmed with ELIMINAR', doc.getElementById('deleteAccountBtn').textContent==='Eliminar cuenta' && /Escribe ELIMINAR/.test(doc.getElementById('deleteAccountOverlay').textContent) && !doc.getElementById('confirmDeleteAccount').disabled);
  }
  // ---- the web page ----
  {
    const fake = fakeClient({signedIn:false});
    const dom = new JSDOM(page, { runScripts: 'dangerously', url: 'https://example.com/Altiro/delete-account.html',
      beforeParse(w){ w.supabase = { createClient: () => fake.client }; } });
    await wait(50);
    const d = dom.window.document, $ = id => d.getElementById(id);
    check('Web page: asks to sign in first', !$('signInCard').hidden && $('deleteCard').hidden);
    $('email').value = 'sam@example.com'; $('password').value = 'wrong';
    $('signInForm').dispatchEvent(new dom.window.Event('submit', {bubbles:true, cancelable:true})); await wait(20);
    check('...a wrong password says so', !$('signInMsg').hidden && /Invalid login/.test($('signInMsg').textContent));
    $('password').value = 'right';
    $('signInForm').dispatchEvent(new dom.window.Event('submit', {bubbles:true, cancelable:true})); await wait(20);
    check('...signed in, it shows the account and the delete step', $('signInCard').hidden && !$('deleteCard').hidden && /sam@example.com/.test($('signedInAs').textContent) && $('deleteBtn').disabled);
    $('confirmWord').value = 'DELETE'; $('confirmWord').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
    $('deleteBtn').click(); await wait(30);
    const call = fake.log.invokes.find(c=>c.name==='delete-account');
    check('...and deletes it the same way the app does', call && call.body.confirm==='DELETE' && call.headers['x-altiro-user']==='user-token' && !$('doneCard').hidden && fake.log.signOuts===1);
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
