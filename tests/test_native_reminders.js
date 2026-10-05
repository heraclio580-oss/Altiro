const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Reminders in the store app: web push doesn't reach an App Store / Google Play app, so there each
// coming workout's reminder is scheduled on the phone (@capacitor/local-notifications) at the reminder
// time -- asked for with the phone's own permission prompt, rescheduled when the plan or time changes,
// cleared when turned off or on sign-out, and a tap opens Today.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

function fakePhone(permission){
  const pending = new Map(), listeners = {};
  const log = {requests: 0};
  const LN = {
    async checkPermissions(){ return {display: log.requests ? permission : 'prompt'}; },
    async requestPermissions(){ log.requests++; return {display: permission}; },
    async getPending(){ return {notifications: [...pending.values()].map(n=>({id:n.id, title:n.title}))}; },
    async cancel({notifications}){ notifications.forEach(n=>pending.delete(n.id)); },
    async schedule({notifications}){ notifications.forEach(n=>pending.set(n.id, n)); return {notifications: notifications.map(n=>({id:n.id}))}; },
    addListener(name, fn){ listeners[name] = fn; return Promise.resolve({remove(){}}); },
  };
  return {LN, pending, listeners, log};
}
function fakeBackend(){
  const upserts = [];
  const user = {id:'u1', email:'sam@example.com'};
  function from(table){
    let op = 'select', payload = null;
    const api = { select(){return api;}, eq(){return api;}, order(){return api;}, in(){return api;}, is(){return api;}, gte(){return api;}, lte(){return api;}, limit(){return api;},
      upsert(p){ op='upsert'; payload=p; return api; }, update(p){ op='update'; payload=p; return api; }, insert(){ op='insert'; return api; }, delete(){ op='delete'; return api; },
      maybeSingle(){ return run(true); }, single(){ return run(true); }, then(res, rej){ return run(false).then(res, rej); } };
    async function run(single){
      if(op==='upsert' && table==='reminder_settings') upserts.push(payload);
      if(op!=='select') return {data: single ? {id:'x'} : [], error:null};
      if(table==='profiles') return {data: single ? {id:'u1', full_name:'Sam', goal:'mix', level:'intermediate', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, plan_start:'2026-09-14'} : [], error:null};
      return {data: single ? null : [], error:null};
    }
    return api;
  }
  return {upserts, client: { auth: { async getSession(){ return {data:{session:{user, access_token:'t'}}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async signOut(){ return {}; } },
    from, functions: { async invoke(){ return {data:{connected:false}, error:null}; } } }};
}

async function app(permission){
  const phone = fakePhone(permission), backend = fakeBackend();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'capacitor://localhost/',
    beforeParse(w){
      w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { LocalNotifications: phone.LN } };
      w.supabase = { createClient: () => backend.client };
      // Today is Friday Sep 18, 2026, 9 AM.
      w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      const RealDate = w.Date, fixed = new RealDate(2026, 8, 18, 9, 0, 0).getTime();
      w.Date.now = () => fixed;
    } });
  await wait(300);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  return {w: dom.window, doc, go, phone, backend};
}

(async () => {
  {
    const {w, doc, go, phone, backend} = await app('granted');
    go('settings'); await wait(20);
    doc.getElementById('notifToggle').click(); await wait(80);
    const list = [...phone.pending.values()].sort((a,b)=>a.id-b.id);
    check('Turning reminders on asks the phone for permission', phone.log.requests===1);
    check('...and schedules them on the phone, one per coming workout day', list.length>=5 && list.length<=21, list.length);
    const first = list[0];
    const at = first && new w.Date(first.schedule.at);
    check('...at the reminder time (7 AM by default) -- so not today, already past 7 at 9 AM', first && at.getHours()===7 && at.getMinutes()===0 && at.getDate()>18, first && String(at));
    check('...naming the workout', first && /: /.test(first.title) && first.body.length>0, first && first.title);
    check('...no rest days among them', list.every(n=> !/Rest Day/.test(n.title)));
    check('...and the setting is saved for the account', backend.upserts.some(u=>u.enabled===true));
    check('Settings shows it on, with no "not supported" note', doc.getElementById('notifToggle').classList.contains('on') && doc.getElementById('reminderNote').hidden);

    const sel = doc.getElementById('reminderTimeSelect');
    sel.value = '18:30'; sel.dispatchEvent(new w.Event('change', {bubbles:true})); await wait(60);
    const moved = [...phone.pending.values()].sort((a,b)=>a.id-b.id);
    check('Changing the time moves them, without doubling them', moved.every(n=> new w.Date(n.schedule.at).getHours()===18 && new w.Date(n.schedule.at).getMinutes()===30) && new Set(moved.map(n=>n.id)).size===moved.length && moved.length>=list.length, `${list.length} -> ${moved.length}`);
    check('...an evening time still to come today includes today', new w.Date(moved[0].schedule.at).getDate()===18 && /^Today: /.test(moved[0].title), moved[0] && moved[0].title);

    phone.listeners.localNotificationActionPerformed && phone.listeners.localNotificationActionPerformed({notification: moved[0]});
    go('progress'); await wait(10);
    phone.listeners.localNotificationActionPerformed({notification: moved[0]}); await wait(20);
    check('Tapping a reminder opens Today', !doc.getElementById('screen-home').hidden);

    go('settings'); await wait(20);
    doc.getElementById('notifToggle').click(); await wait(60);
    check('Turning them off clears them from the phone', phone.pending.size===0 && !doc.getElementById('notifToggle').classList.contains('on'));
    doc.getElementById('notifToggle').click(); await wait(80);
    check('(on again)', phone.pending.size>0);
    doc.getElementById('signOutBtn').click(); await wait(60);
    check('Signing out clears them too (the next person here won\'t get them)', phone.pending.size===0);
  }
  {
    const {doc, go, phone} = await app('denied');
    go('settings'); await wait(20);
    doc.getElementById('notifToggle').click(); await wait(60);
    check('Permission refused: nothing scheduled, stays off', phone.pending.size===0 && !doc.getElementById('notifToggle').classList.contains('on'));
    check('...and it says how to turn them on in the phone\'s Settings', !doc.getElementById('reminderNote').hidden && /phone's Settings/.test(doc.getElementById('reminderNote').textContent), doc.getElementById('reminderNote').textContent);
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
