const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Altiro Pro. Before Pro launches (no launch date set) every account is Pro, free for life. After it,
// accounts made before the launch date keep that; a new account has a week of Pro, then the free plan
// (its plan from today on, Adjust, full history, records and voice cues locked) with the paywall shown
// once. A subscription (from the RevenueCat webhook, in `subscriptions`) or a lifetime grant makes it
// Pro; a cancelled one stays Pro until it runs out. In the store app the paywall buys through RevenueCat
// (yearly picked, monthly too, Restore purchases), and Pro is there straight away; on the website it
// says to subscribe in the app. Settings shows what the account has.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
function makeBackend(opts){
  const db = {
    profiles: {u1: {id:'u1'}},
    workout_logs: {},
    manual_entries: {},
    strava_activities: {},
    subscriptions: {},
  };
  const invokes = [];
  let connected = !!opts.connected;
  let nextId = 1;
  const newId = () => 'id' + (nextId++);
  const addLog = (log_date, fields) => { const id = newId(); db.workout_logs[id] = {id, user_id:'u1', log_date, completed_override:null, ...fields}; return id; };
  const addStrava = (id, local_date, name, distance_m, moving_time_s) => {
    db.strava_activities[id] = {id, user_id:'u1', name, local_date, start_date: local_date+'T12:00:00Z', distance_m, moving_time_s, applied_at:null};
  };
  function from(table){
    let filters = [], op = 'select', payload = null, wantRows = false, cols = '';
    const matches = row => filters.every(([c,v,kind]) => kind==='is' ? row[c]==null : kind==='notnull' ? row[c]!=null : kind==='gte' ? row[c]>=v : row[c]===v);
    async function run(single){
      const rows = db[table];
      if(!rows) return {data: [], error:null}; // planned_workouts, progression_targets, personal_records, ...
      // A database that doesn't have the climb column yet.
      if(op==='select' && table==='strava_activities' && opts.noClimbColumn && /elev_gain_m/.test(cols)) return {data:null, error:{code:'42703', message:'column strava_activities.elev_gain_m does not exist'}};
      if(op==='insert'){
        const id = newId(); rows[id] = {id, ...payload};
        return {data: rows[id], error:null};
      }
      if(op==='delete'){ Object.values(rows).filter(matches).forEach(r=> delete rows[r.id]); return {data:null, error:null}; }
      if(op==='update'){
        const hit = Object.values(rows).filter(matches);
        hit.forEach(r => Object.assign(r, payload));
        return {data: wantRows ? hit.map(r=>({id:r.id})) : null, error:null};
      }
      const hit = Object.values(rows).filter(matches);
      if(single) return {data: hit[0] || null, error:null};
      if(table==='workout_logs'){
        return {data: hit.map(r => ({...r, manual_entries: Object.values(db.manual_entries).filter(e=>e.workout_log_id===r.id)})), error:null};
      }
      return {data: hit, error:null};
    }
    const api = {
      select(c){ wantRows = true; cols = c || ''; return api; },
      eq(c,v){ filters.push([c,v,'eq']); return api; },
      is(c){ filters.push([c,null,'is']); return api; },
      not(c){ filters.push([c,null,'notnull']); return api; },
      gte(c,v){ filters.push([c,v,'gte']); return api; },
      order(){ return api; },
      insert(p){ op='insert'; payload=p; return api; },
      update(p){ op='update'; payload=p; wantRows=false; return api; },
      upsert(){ op='noop'; return api; }, delete(){ op='delete'; return api; },
      maybeSingle(){ return run(true); },
      then(res, rej){ return run(false).then(res, rej); },
    };
    return api;
  }
  function createClient(){
    const user = {id:'u1', email:'runner@example.com', created_at: opts.createdAt};
    return {
      auth: {
        async getSession(){ return {data:{session:{user}}}; },
        onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
        async signOut(){ return {error:null}; },
      },
      from,
      functions: {
        async invoke(name, {body}){
          invokes.push(body);
          if(opts.notDeployed){
            return {data:null, error:{message:'Edge Function returned a non-2xx status code', context:{status:404, json: async()=>({})}}};
          }
          if(body.action==='connect'){ connected = true; return {data:{connected:true, athlete_name:'Sam Runner', fetched:0}, error:null}; }
          if(body.action==='sync') return {data: connected ? {connected:true, athlete_name:'Sam Runner', fetched:0} : {connected:false}, error:null};
          if(body.action==='disconnect'){ connected = false; return {data:{connected:false}, error:null}; }
          if(body.action==='authorize_url') return {data:{url:'https://www.strava.com/oauth/authorize?x=1'}, error:null};
          return {data:null, error:{message:'?', context:{status:400, json: async()=>({error:'unknown_action'})}}};
        },
      },
    };
  }
  return { db, invokes, addLog, addStrava, createClient };
}

const DAY = 86400000, ago = d => new Date(Date.now() - d*DAY).toISOString(), ahead = d => new Date(Date.now() + d*DAY).toISOString();
function purchases(opts){
  const log = {configure: [], logIn: [], bought: [], restored: 0};
  const pkg = (type, id, price) => ({identifier: '$rc_'+type.toLowerCase(), packageType: type, product: {identifier: id, priceString: '$'+price.toFixed(2), price, currencyCode: 'USD'}});
  const annual = pkg('ANNUAL', 'altiro_pro_yearly', 49.99), monthly = pkg('MONTHLY', 'altiro_pro_monthly', 7.99);
  const proInfo = {entitlements: {active: {pro: {expirationDate: ahead(365), willRenew: true, store: 'PLAY_STORE', productIdentifier: 'altiro_pro_yearly'}}}, managementURL: 'https://play.google.com/store/account/subscriptions?sku=altiro_pro_yearly&package=com.altiro.app'};
  const none = {entitlements: {active: {}}, managementURL: null};
  let owned = !!opts.alreadyPro;
  return {log, plugin: {
    async configure(o){ log.configure.push(o); },
    async logIn(o){ log.logIn.push(o); return {customerInfo: owned ? proInfo : none, created: false}; },
    async getCustomerInfo(){ return {customerInfo: owned ? proInfo : none}; },
    async getOfferings(){ return {current: {identifier: 'default', annual, monthly, availablePackages: [annual, monthly]}, all: {}}; },
    async purchasePackage({aPackage}){
      log.bought.push(aPackage.product.identifier);
      if(opts.cancel) throw {code: '1', message: 'Purchase was cancelled.', userCancelled: true};
      if(opts.fail) throw {code: '2', message: 'There was a problem with the store.'};
      owned = true;
      return {productIdentifier: aPackage.product.identifier, customerInfo: proInfo};
    },
    async restorePurchases(){ log.restored++; return {customerInfo: owned ? proInfo : none}; },
  }};
}
const open = (backend, o = {}) => new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/',
  beforeParse(w){
    w.supabase = {createClient: ()=> backend.createClient()};
    w.__ALTIRO_TEST_TODAY__ = '2026-09-16'; // a Wednesday: a training day on the default plan
    if(o.launch) w.__ALTIRO_TEST_PRO_LAUNCH__ = o.launch;
    if(o.rc){
      w.__ALTIRO_TEST_RC_KEYS__ = o.keys===false ? {android: '', ios: ''} : {android: 'goog_test', ios: 'appl_test'};
      w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { Purchases: o.rc.plugin, App: { addListener(){ return Promise.resolve({remove(){}}); }, getLaunchUrl: async () => undefined } } };
    }
  }});
const text = el => (el ? el.textContent : '').replace(/\s+/g,' ').trim();
const LAUNCH = '2026-01-01';
async function app(o){
  const backend = makeBackend({createdAt: o.createdAt});
  if(o.sub) backend.db.subscriptions.s1 = {id:'s1', user_id:'u1', entitlement:'pro', ...o.sub};
  if(o.tester) backend.db.profiles.u1 = {id:'u1', tester:true};
  const dom = open(backend, o); await wait(500);
  const doc = dom.window.document, go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('home'); await wait(20);
  const planLocked = () => !!doc.querySelector('#sessionCard [data-pro="plan"]');
  const settings = async () => { go('settings'); await wait(20); return {shown: !doc.getElementById('proSection').hidden, title: text(doc.getElementById('proStatusTitle')), sub: text(doc.getElementById('proStatusSub')), btn: doc.getElementById('proStatusBtn'), manage: doc.getElementById('proManageLink'), restore: doc.getElementById('proRestoreBtn')}; };
  const paywall = () => ({open: !doc.getElementById('paywallOverlay').hidden, why: text(doc.getElementById('paywallWhy')), buy: doc.getElementById('paywallBuyBtn'), note: doc.getElementById('paywallNote'), err: doc.getElementById('paywallError'), restore: doc.getElementById('paywallRestoreBtn')});
  return {dom, doc, go, backend, planLocked, settings, paywall, w: dom.window};
}

(async () => {
  // ---- Pro hasn't launched: everyone has it ----
  {
    const a = await app({createdAt: ago(400)});
    check('Before Pro launches, an account (even a year old) has everything: today\'s plan is there', !a.planLocked() && !/Rest/.test(text(a.doc.querySelector('#sessionCard .title'))));
    check('...no paywall pops up', !a.paywall().open);
    check('...and no Pro section in Settings (nothing to say yet)', !(await a.settings()).shown);
    a.dom.window.close();
    const t = await app({createdAt: ago(400), tester: true});
    const st = await t.settings();
    check('A tester sees it before launch: "Pro, free for life" for joining early', st.shown && st.title==='Pro, free for life' && /before Pro launched/.test(st.sub), JSON.stringify(st.title));
    t.dom.window.close();
  }
  // ---- After launch: made before it ----
  {
    const a = await app({launch: LAUNCH, createdAt: '2025-11-02T10:00:00Z'});
    const st = await a.settings();
    check('After launch, an account from before it keeps Pro for life', st.shown && st.title==='Pro, free for life' && !st.btn.hidden===false, st.title);
    a.go('home'); await wait(20);
    check('...with its plan', !a.planLocked());
    a.dom.window.close();
  }
  // ---- A new account: a week free ----
  {
    const a = await app({launch: LAUNCH, createdAt: ago(2)});
    check('A new account (2 days old) has Pro: its plan is there', !a.planLocked());
    const st = await a.settings();
    check('Settings: "Free trial: 5 days left", when it ends, and "See plans"', st.shown && st.title==='Free trial: 5 days left' && /^Ends /.test(st.sub) && !st.btn.hidden && st.btn.textContent==='See plans', `${st.title} / ${st.sub}`);
    st.btn.click(); await wait(30);
    const p = a.paywall();
    check('"See plans" opens Altiro Pro', p.open && /personalized plan/.test(text(a.doc.querySelector('.paywall-perks'))));
    check('...yearly first and picked: $49.99, $4.17 a month, "Save 48%"; monthly $7.99',
      a.doc.querySelector('.paywall-plan[data-plan="yearly"]').getAttribute('aria-checked')==='true' && text(a.doc.getElementById('paywallYearlyPrice'))==='$49.99'
      && text(a.doc.getElementById('paywallYearlySub'))==='$4.17 a month, billed yearly' && text(a.doc.getElementById('paywallSave'))==='Save 48%' && text(a.doc.getElementById('paywallMonthlyPrice'))==='$7.99');
    check('...on the website it can\'t be bought here: it says to subscribe in the app', p.buy.disabled && !p.note.hidden && /Subscribe in the Altiro app/.test(text(p.note)) && p.restore.hidden);
    check('...with the renewal terms, Terms and Privacy', /renews automatically/.test(text(a.doc.getElementById('paywallFine'))) && /App Store or Google Play/.test(text(a.doc.getElementById('paywallFine'))) && !!a.doc.querySelector('#paywallOverlay a[href="privacy.html"]') && !!a.doc.querySelector('#paywallOverlay .terms-link'));
    a.doc.querySelector('.paywall-plan[data-plan="monthly"]').click(); await wait(10);
    check('Picking monthly', a.doc.querySelector('.paywall-plan[data-plan="monthly"]').getAttribute('aria-checked')==='true' && /\$7\.99 a month/.test(p.buy.textContent), p.buy.textContent);
    a.dom.window.close();
  }
  // ---- The week is over, nothing bought ----
  {
    const a = await app({launch: LAUNCH, createdAt: ago(10)});
    check('After the free week: the plan from today on is locked ("Unlock your plan")', a.planLocked());
    await wait(700);
    const p = a.paywall();
    check('...and the paywall shows once, saying the week ended and nothing is lost', p.open && /free week of Pro has ended/.test(p.why) && /still here/.test(p.why));
    check('...(remembered, so it doesn\'t keep popping up)', a.w.localStorage.getItem('altiro_trial_ended_seen_u1')==='1');
    a.doc.getElementById('closePaywall').click(); await wait(10);
    const st = await a.settings();
    check('Settings: "Free plan", with "Get Pro"', st.title==='Free plan' && !st.btn.hidden && st.btn.textContent==='Get Pro' && st.manage.hidden);
    a.dom.window.close();
  }
  // ---- Subscribed (from the webhook) ----
  {
    const a = await app({launch: LAUNCH, createdAt: ago(40), sub: {status:'active', expires_at: ahead(20), product_id:'altiro_pro_monthly', store:'play_store'}});
    check('Subscribed: Pro, with its plan', !a.planLocked() && !a.paywall().open);
    const st = await a.settings();
    check('Settings: "Pro, renews <date>", billed through Google Play, and "Manage subscription"', /^Pro, renews /.test(st.title) && /Google Play/.test(st.sub) && !st.manage.hidden && /play\.google\.com\/store\/account\/subscriptions/.test(st.manage.href), `${st.title} / ${st.manage.href}`);
    a.go('settings'); await wait(10);
    a.doc.getElementById('deleteAccountBtn').click(); await wait(20);
    check('Deleting the account says to cancel the subscription in the store first', !a.doc.getElementById('deleteAccountSubNote').hidden && /doesn't cancel/.test(text(a.doc.getElementById('deleteAccountSubNote'))));
    a.dom.window.close();
  }
  {
    const a = await app({launch: LAUNCH, createdAt: ago(40), sub: {status:'cancelled', expires_at: ahead(5), store:'app_store'}});
    const st = await a.settings();
    check('Cancelled but not run out: still Pro, "Pro until <date>"', !st.btn.textContent && /^Pro until /.test(st.title), st.title);
    a.dom.window.close();
  }
  {
    const a = await app({launch: LAUNCH, createdAt: ago(200), sub: {status:'expired', expires_at: ago(3), store:'app_store'}});
    check('Run out: free again', a.planLocked());
    a.dom.window.close();
  }
  {
    const a = await app({launch: LAUNCH, createdAt: ago(200), sub: {status:'lifetime'}});
    const st = await a.settings();
    check('A lifetime grant: Pro, free for life, from the Altiro team', !a.planLocked() && st.title==='Pro, free for life' && /Altiro team/.test(st.sub));
    a.dom.window.close();
  }
  // ---- The store app: buying ----
  {
    const rc = purchases({});
    const a = await app({launch: LAUNCH, createdAt: ago(10), rc});
    await wait(700);
    check('(set-up) the store app, after the free week: the paywall', a.paywall().open && a.planLocked());
    check('RevenueCat is signed in as the Altiro account, with Google Play\'s key', rc.log.configure.length===1 && rc.log.configure[0].appUserID==='u1' && rc.log.configure[0].apiKey==='goog_test', JSON.stringify(rc.log.configure));
    const p = a.paywall();
    check('...prices from the store, the buy button on, Restore purchases there', !p.buy.disabled && /Subscribe for \$49\.99 a year/.test(p.buy.textContent) && !p.restore.hidden && p.note.hidden && /Google Play/.test(text(a.doc.getElementById('paywallFine'))), p.buy.textContent);
    p.buy.click(); await wait(80);
    check('Buying yearly buys the yearly plan', JSON.stringify(rc.log.bought)==='["altiro_pro_yearly"]');
    check('...Pro straight away: the paywall closes, "Welcome to Altiro Pro"', !a.paywall().open && /Welcome to Altiro Pro/.test(text(a.doc.getElementById('toastMsg'))));
    a.go('home'); await wait(20);
    check('...and today\'s plan is back', !a.planLocked());
    const st = await a.settings();
    check('Settings: "Pro, renews <date>", Manage subscription goes to the store\'s page', /^Pro, renews /.test(st.title) && /sku=altiro_pro_yearly/.test(st.manage.href), st.manage.href);
    a.dom.window.close();
  }
  {
    const rc = purchases({cancel: true});
    const a = await app({launch: LAUNCH, createdAt: ago(10), rc});
    await wait(700);
    a.paywall().buy.click(); await wait(60);
    check('Backing out of the store\'s sheet: no error, still free, paywall still there', a.paywall().open && a.paywall().err.hidden && a.planLocked());
    a.dom.window.close();
  }
  {
    const rc = purchases({fail: true});
    const a = await app({launch: LAUNCH, createdAt: ago(10), rc});
    await wait(700);
    a.paywall().buy.click(); await wait(60);
    check('A purchase that fails says nothing was charged', !a.paywall().err.hidden && /Nothing was charged/.test(text(a.paywall().err)));
    a.paywall().restore.click(); await wait(60);
    check('Restore with nothing to restore says so', rc.log.restored===1 && /No Altiro Pro subscription was found/.test(text(a.doc.getElementById('toastMsg'))));
    a.dom.window.close();
  }
  {
    const rc = purchases({alreadyPro: true});
    const a = await app({launch: LAUNCH, createdAt: ago(10), rc});
    await wait(700);
    check('Bought on this store account before (no webhook row yet): RevenueCat says Pro, so it\'s Pro', !a.planLocked());
    a.dom.window.close();
  }
  {
    const rc = purchases({});
    const a = await app({launch: LAUNCH, createdAt: ago(2), rc, keys: false});
    const st = await a.settings();
    st.btn.click(); await wait(40);
    const p = a.paywall();
    check('The store app before subscriptions are set up: "aren\'t open yet", nothing to press', p.open && p.buy.disabled && /aren't open yet/.test(text(p.note)) && p.restore.hidden && rc.log.configure.length===0);
    a.dom.window.close();
  }
  // ---- Previewing free (a tester with Pro) ----
  {
    const a = await app({launch: LAUNCH, createdAt: '2025-11-02T10:00:00Z', tester: true});
    a.go('settings'); await wait(10);
    a.doc.getElementById('freePreviewToggle').click(); await wait(30);
    a.go('home'); await wait(20);
    check('A tester previewing free sees the locks', a.planLocked());
    a.doc.querySelector('#sessionCard [data-pro="plan"]').click(); await wait(30);
    check('...and the paywall, noting it\'s a preview', a.paywall().open && !a.doc.getElementById('paywallPreviewNote').hidden);
    a.dom.window.close();
  }
  // ---- Spanish ----
  {
    const a = await app({launch: LAUNCH, createdAt: ago(2)});
    a.go('settings'); await wait(10);
    a.doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
    const st = await a.settings();
    check('In Spanish: "Prueba gratis: quedan 5 días"', st.title==='Prueba gratis: quedan 5 días', st.title);
    st.btn.click(); await wait(30);
    check('...and "Suscribirse" on the paywall\'s prices', /Ahorra 48%/.test(text(a.doc.getElementById('paywallSave'))) && /al mes, cobro anual/.test(text(a.doc.getElementById('paywallYearlySub'))));
    a.dom.window.close();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
