const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Workout reminders: turning them on asks for notification permission, saves this device's push
// subscription and the user's reminder time (7:00 AM unless they pick another) and time zone, and keeps
// the next three weeks of workouts -- worded, one per day, rest days left out -- saved for the
// workout-reminders Edge Function to send. Plus Add to Home Screen, which iPhones need for reminders.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

function makeBackend(opts = {}){
  const db = {
    profiles: {u1: {id:'u1', full_name:'Sam', goal:'general', level:'intermediate', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, plan_start:'2026-09-14'}},
    workout_logs: {}, manual_entries: {}, reminder_settings: {}, push_subscriptions: {},
  };
  let nextId = 1;
  function from(table){
    let filters = [], op = 'select', payload = null, conflict = null;
    const matches = row => filters.every(([c,v]) => row[c]===v);
    async function run(single){
      const rows = db[table];
      if(!rows) return {data: single ? null : [], error:null};
      if(op==='upsert' && opts.missingTable===table) return {data:null, error:{code:'42P01', message:'relation does not exist'}};
      if(op==='upsert'){
        const key = conflict || 'id';
        const existing = Object.values(rows).find(r => r[key]===payload[key]);
        if(existing) Object.assign(existing, payload);
        else { const id = payload.id || ('id'+(nextId++)); rows[table==='reminder_settings' ? payload.user_id : id] = {id, ...payload}; }
        return {data:null, error:null};
      }
      if(op==='delete'){ Object.keys(rows).forEach(k => { if(matches(rows[k])) delete rows[k]; }); return {data:null, error:null}; }
      if(op==='update'){ Object.values(rows).filter(matches).forEach(r => Object.assign(r, payload)); return {data:null, error:null}; }
      if(op==='insert'){ const id = 'id'+(nextId++); rows[id] = {id, ...payload}; return {data: rows[id], error:null}; }
      const hit = Object.values(rows).filter(matches);
      if(single) return {data: hit[0] || null, error:null};
      if(table==='workout_logs') return {data: hit.map(r => ({...r, manual_entries: []})), error:null};
      return {data: hit, error:null};
    }
    const api = {
      select(){ return api; }, order(){ return api; }, in(){ return api; }, is(){ return api; }, gte(){ return api; }, lte(){ return api; },
      eq(c,v){ filters.push([c,v]); return api; },
      upsert(p, o){ op='upsert'; payload=p; conflict = o && o.onConflict; return api; },
      update(p){ op='update'; payload=p; return api; },
      insert(p){ op='insert'; payload=p; return api; },
      delete(){ op='delete'; return api; },
      maybeSingle(){ return run(true); }, single(){ return run(true); },
      then(res, rej){ return run(false).then(res, rej); },
    };
    return api;
  }
  const user = {id:'u1', email:'sam@example.com'};
  return {
    db,
    createClient: () => ({
      auth: {
        async getSession(){ return {data:{session:{user}}}; },
        onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
        async signOut(){ return {error:null}; },
      },
      from,
      functions: { async invoke(){ return {data:{connected:false}, error:null}; } },
    }),
  };
}

// A browser with notifications and a service worker, faked.
function openSession(backend, opts = {}){
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/Altiro/',
    beforeParse(w){
      const ua = opts.userAgent || 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36';
      Object.defineProperty(w.navigator, 'userAgent', { get: () => ua });
      w.supabase = { createClient: () => backend.createClient() };
      w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      w.registered = [];
      w.permissionAsks = 0;
      let current = null;
      // Like Chrome: the service worker is still installing when the page first registers it, and
      // subscribing through one that isn't active yet fails.
      const reg = { active: null };
      const pushManager = {
        async getSubscription(){ return current; },
        async subscribe(o){
          if(!reg.active) throw new w.DOMException('Subscription failed - no active Service Worker', 'AbortError');
          w.subscribeKey = o.applicationServerKey;
          current = { endpoint: 'https://fcm.googleapis.com/fcm/send/device-1', toJSON(){ return {endpoint: this.endpoint, keys:{p256dh:'BPUBKEY', auth:'AUTHSECRET'}}; } };
          return current;
        },
      };
      if(!opts.noPush){
        w.PushManager = function(){};
        w.Notification = { permission: opts.permission || 'default', async requestPermission(){ w.permissionAsks++; this.permission = opts.answer || 'granted'; return this.permission; } };
        reg.pushManager = pushManager;
        Object.defineProperty(w.navigator, 'serviceWorker', { value: {
          register(url){ w.registered.push(url); return Promise.resolve(reg); },
          get ready(){ return new Promise(r => setTimeout(() => { reg.active = {state:'activated'}; r(reg); }, 20)); },
          addEventListener(){},
        }});
      }
      if(opts.standalone) w.matchMedia = q => ({matches: /standalone/.test(q), addListener(){}, removeListener(){}});
    },
  });
}

(async () => {
  const backend = makeBackend();
  const dom = openSession(backend);
  const w = dom.window, doc = w.document;
  await wait(250);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // ---- installable ----
  check('The page links a web app manifest and a Home Screen icon', !!doc.querySelector('link[rel="manifest"][href="manifest.webmanifest"]') && !!doc.querySelector('link[rel="apple-touch-icon"]'));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'www', 'manifest.webmanifest'), 'utf8'));
  check('...a manifest that opens full screen, with its icons', manifest.display==='standalone' && manifest.start_url==='./' && manifest.icons.every(i => fs.existsSync(path.join(__dirname, '..', 'www', i.src))) && manifest.icons.some(i=>i.purpose==='maskable'));
  check('The service worker is registered', w.registered.join()==='sw.js', w.registered.join());
  const sw = fs.readFileSync(path.join(__dirname, '..', 'www', 'sw.js'), 'utf8');
  check('...and it shows pushed reminders and opens the app when one is tapped', /addEventListener\('push'/.test(sw) && /showNotification/.test(sw) && /notificationclick/.test(sw) && /openWindow/.test(sw));

  go('home'); await wait(30);
  const nudge = doc.getElementById('installNudge');
  check('Today suggests adding Altiro to the Home Screen (on a phone)', !nudge.hidden && nudge.textContent.includes('Put Altiro on your Home Screen'));
  doc.getElementById('installNudgeAdd').click(); await wait(10);
  const steps = [...doc.querySelectorAll('#installSteps li')].map(li => li.textContent.trim());
  check('...Add shows how, for Android when the browser hasn\'t offered to install', !doc.getElementById('installOverlay').hidden && steps.length===3 && /Add to Home screen/.test(steps[1]), steps.join(' | '));
  doc.getElementById('installDoneBtn').click();
  // Chrome's own install prompt, when it offers one
  let prompted = 0;
  const ev = new w.Event('beforeinstallprompt'); ev.prompt = () => { prompted++; }; ev.userChoice = Promise.resolve({outcome:'accepted'});
  w.dispatchEvent(ev); await wait(5);
  doc.getElementById('installNudgeAdd').click(); await wait(10);
  check('...and uses the browser\'s own install prompt when there is one', prompted===1 && doc.getElementById('installOverlay').hidden);
  doc.getElementById('installNudgeClose').click(); await wait(5);
  check('Closing the suggestion hides it for good', nudge.hidden && w.localStorage.getItem('altiro_install_nudge_dismissed')==='1');

  // ---- reminders ----
  go('settings'); await wait(30);
  const toggle = doc.getElementById('notifToggle');
  check('Reminders start off', !toggle.classList.contains('on') && doc.getElementById('reminderTimeRow').hidden);
  check('Settings also offers Add to Home Screen', !doc.getElementById('installSection').hidden && doc.getElementById('installBtn').textContent.includes('Add Altiro to your Home Screen'));
  toggle.click(); await wait(50);
  check('Turning them on asks for permission', w.permissionAsks===1);
  check('...subscribes this device with Altiro\'s push key', w.subscribeKey && w.subscribeKey.length===65);
  const subs = Object.values(backend.db.push_subscriptions);
  check('...and saves the device', subs.length===1 && subs[0].endpoint==='https://fcm.googleapis.com/fcm/send/device-1' && subs[0].p256dh==='BPUBKEY' && subs[0].auth==='AUTHSECRET' && subs[0].user_id==='u1', JSON.stringify(subs));
  const rs = () => backend.db.reminder_settings.u1;
  check('...on, at 7:00 AM, in the user\'s time zone', rs() && rs().enabled===true && rs().remind_at==='07:00' && typeof rs().time_zone==='string' && rs().time_zone.length>0, JSON.stringify(rs() && {e:rs().enabled, t:rs().remind_at, z:rs().time_zone}));
  check('The toggle is on, with the time to pick', toggle.classList.contains('on') && !doc.getElementById('reminderTimeRow').hidden && doc.getElementById('reminderTimeSelect').selectedOptions[0].textContent==='7:00 AM');
  check('...and says so', doc.getElementById('toastMsg').textContent==='Reminders on: 7:00 AM on workout days', doc.getElementById('toastMsg').textContent);

  const sched = rs().schedule || {};
  const days = Object.keys(sched).sort();
  check('The next 3 weeks of workouts are saved for the reminders', days.length>=8 && days[0]>='2026-09-18' && days[days.length-1]<='2026-10-08', days.join(','));
  // Training days are Mon/Wed/Fri: every saved day is one of those, and there's no rest-day reminder.
  check('...only workout days, no rest days', days.every(k => [1,3,5].includes(new Date(k+'T12:00:00').getDay())), days.join(','));
  const first = sched[days[0]];
  check('...each worded as it will show: "Today: <workout>" and its details', /^Today: \S/.test(first.title) && first.body.length>0, JSON.stringify(first));

  // Pick another time
  const sel = doc.getElementById('reminderTimeSelect');
  sel.value = '18:30'; sel.dispatchEvent(new w.Event('change', {bubbles:true})); await wait(30);
  check('Picking a time saves it', rs().remind_at==='18:30' && doc.getElementById('toastMsg').textContent==="You'll be reminded at 6:30 PM", doc.getElementById('toastMsg').textContent);

  // A workout done early today drops today's reminder (the schedule is kept current as things change).
  const todayKey = '2026-09-18';
  const hadToday = !!rs().schedule[todayKey];
  go('calendar'); await wait(20);
  doc.querySelector(`.mo-cell[data-date="${todayKey}"]`).click(); await wait(20);
  doc.getElementById('dayDetailPlanRow').click(); await wait(20);
  doc.getElementById('saveLogPerf').click(); await wait(50);
  if(!doc.getElementById('dayDetailOverlay').hidden) doc.getElementById('closeDayDetail').click();
  await wait(1800);
  check('Logging today\'s workout takes today off the reminders', hadToday && !rs().schedule[todayKey], `${hadToday} ${JSON.stringify(rs().schedule[todayKey])}`);

  // Spanish: reminders are worded in the user's language
  go('settings'); await wait(20);
  doc.querySelector('.lang-btn[data-lang="es"]') && doc.querySelector('.lang-btn[data-lang="es"]').click();
  [...doc.querySelectorAll('.lang-btn')].filter(b=>b.dataset.lang==='es').forEach(b=>b.click());
  await wait(1800);
  const esFirst = rs().schedule[Object.keys(rs().schedule).sort()[0]];
  check('In Spanish, reminders read "Hoy: ..."', /^Hoy: /.test(esFirst.title) && rs().lang==='es', JSON.stringify(esFirst));
  [...doc.querySelectorAll('.lang-btn')].filter(b=>b.dataset.lang==='en').forEach(b=>b.click());
  await wait(10);

  // Turning off
  go('settings'); await wait(20);
  toggle.click(); await wait(30);
  check('Turning them off saves that', rs().enabled===false && !toggle.classList.contains('on') && doc.getElementById('reminderTimeRow').hidden);

  // Next sign-in on another device: the setting comes back from the account
  toggle.click(); await wait(50);
  const dom2 = openSession(backend, {permission:'granted'});
  await wait(300);
  const doc2 = dom2.window.document;
  [...doc2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click(); await wait(20);
  check('Signing in again: reminders are still on, at the time picked', doc2.getElementById('notifToggle').classList.contains('on') && doc2.getElementById('reminderTimeSelect').value==='18:30');

  // Sign out: this device stops getting this account's reminders
  doc.getElementById('signOutBtn').click(); await wait(50);
  check('Signing out removes this device from the reminders', Object.keys(backend.db.push_subscriptions).length===0);

  // ---- blocked, and iPhone ----
  const b3 = makeBackend();
  const dom3 = openSession(b3, {answer:'denied'});
  await wait(250);
  const doc3 = dom3.window.document;
  [...doc3.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click(); await wait(20);
  doc3.getElementById('notifToggle').click(); await wait(30);
  check('Permission refused: stays off and explains how to allow it', !doc3.getElementById('notifToggle').classList.contains('on') && /blocked/.test(doc3.getElementById('toastMsg').textContent) && !b3.db.reminder_settings.u1);

  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
  const b4 = makeBackend();
  const dom4 = openSession(b4, {userAgent: iphone});
  await wait(250);
  const doc4 = dom4.window.document;
  [...doc4.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click(); await wait(20);
  check('iPhone in Safari: explains reminders need Altiro on the Home Screen', !doc4.getElementById('reminderNote').hidden && /Home Screen/.test(doc4.getElementById('reminderNote').textContent));
  doc4.getElementById('notifToggle').click(); await wait(20);
  const iSteps = [...doc4.querySelectorAll('#installSteps li')].map(li=>li.textContent.trim());
  check('...and turning them on shows how to add it', dom4.window.permissionAsks===0 && !doc4.getElementById('installOverlay').hidden && /Share/.test(iSteps[0]) && /Add to Home Screen/.test(iSteps[1]), iSteps.join(' | '));
  const dom5 = openSession(makeBackend(), {userAgent: iphone, standalone: true});
  await wait(250);
  const doc5 = dom5.window.document;
  [...doc5.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click(); await wait(20);
  check('Opened from the iPhone Home Screen: no install prompt, reminders can be turned on', doc5.getElementById('installSection').hidden && doc5.getElementById('reminderNote').hidden);
  doc5.getElementById('notifToggle').click(); await wait(50);
  check('...and they turn on', doc5.getElementById('notifToggle').classList.contains('on'));

  // A setup problem says which step failed, e.g. the table was never created.
  const b6 = makeBackend({missingTable:'push_subscriptions'});
  const dom6 = openSession(b6);
  await wait(250);
  const doc6 = dom6.window.document;
  [...doc6.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click(); await wait(20);
  doc6.getElementById('notifToggle').click(); await wait(80);
  check('If saving the device fails, the message says so', doc6.getElementById('toastMsg').textContent==="Couldn't turn on reminders. Check your connection and try again. (device: 42P01)" && !doc6.getElementById('notifToggle').classList.contains('on'), doc6.getElementById('toastMsg').textContent);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
