const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Making things easier to find: a one-time tip on moving exercises (until it's closed or something's
// moved), a lift's numbers looking like the button they are, "Change exercises" outlined, a tour stop for
// rearranging and supersets, and a "Connect your watch" card on Today for someone with nothing connected.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=> m[1]).join('\n');

const BLOCK = 60;
function fakeRect(){
  const block = this.classList && (this.classList.contains('ex-block') ? this : this.classList.contains('ex-drag') ? this.closest('.ex-block') : null);
  if(block){
    const i = [...block.parentElement.children].indexOf(block);
    const top = i*BLOCK + (block===this ? 0 : 10), h = block===this ? 50 : 20;
    return { top, bottom: top+h, left:0, right:300, width:300, height:h, x:0, y:top };
  }
  return { top:0, bottom:0, left:0, right:0, width:0, height:0, x:0, y:0 };
}
// A signed-in user; stravaConnected / native (the store app, Health Connect off unless healthOn).
function backend(opts){
  function from(table){
    const api = { select(){return api;}, eq(){return api;}, order(){return api;}, in(){return api;}, is(){return api;}, gte(){return api;}, lte(){return api;}, limit(){return api;}, not(){return api;},
      upsert(){return api;}, update(){return api;}, insert(){return api;}, delete(){return api;},
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', full_name:'Sam', goal:'mix', level:'intermediate', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, plan_start:'2026-09-14'} : null, error:null}); },
      single(){ return api.maybeSingle(); }, then(res, rej){ return Promise.resolve({data:[], error:null}).then(res, rej); } };
    return api;
  }
  return {
    auth: { async getSession(){ return {data:{session:{user:{id:'u1', email:'sam@example.com', user_metadata:{}}, access_token:'t'}}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async signOut(){ return {}; } },
    from,
    functions: { async invoke(name, o){
      if(name==='strava' && o.body.action==='sync') return {data: opts.stravaConnected ? {connected:true, athlete_name:'Sam', fetched:0} : {connected:false, spots_open: opts.stravaFull ? false : true}, error:null};
      return {data:{}, error:null};
    } },
  };
}
async function signedIn(opts){
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
    beforeParse(w){
      if(opts.native) w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { Health: {}, App: { addListener(){ return Promise.resolve({remove(){}}); }, getLaunchUrl: async () => undefined } } };
      if(opts.healthOn) w.localStorage.setItem('altiro_health_on_u1', '1');
      if(opts.closed) w.localStorage.setItem('altiro_watch_card_off', '1');
      w.supabase = { createClient: () => backend(opts) };
      w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
    } });
  await wait(350);
  const doc = dom.window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  return {w: dom.window, doc};
}

(async () => {
  // ---- 1. The tip, 2. the numbers, 4. Change exercises ----
  {
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; w.Element.prototype.getBoundingClientRect = fakeRect; } });
    await wait(50);
    const w = dom.window, doc = w.document;
    const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    const pointer = (el, type, y) => el.dispatchEvent(new w.PointerEvent(type, {bubbles:true, cancelable:true, pointerId:1, clientX:100, clientY:y}));
    goPill('adjust');
    for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
    doc.getElementById('applyAdjust').click();
    await wait(10);
    goPill('home');
    await wait(20);
    check('"Change exercises" is on Today\'s card', !!doc.getElementById('changeExercisesBtn'));
    check('...outlined in the accent', /#changeExercisesBtn\{border-color:var\(--accent\);\}/.test(css));
    check('A lift\'s numbers on Today look like a button', /\.r-exercise-list li\.lift-tap > span\{[^}]*border:1px solid/.test(css) && !!doc.querySelector('#sessionCard li.lift-tap > span'));
    check('...and in the preview', /\.wp-rx-btn\{[^}]*border:1px solid var\(--border\);border-radius:var\(--r-pill\)/.test(css));
    doc.getElementById('changeExercisesBtn').click();
    await wait(20);
    const tip = doc.getElementById('wpReorderTip');
    check('The preview shows the tip, the first time', !tip.hidden && /hold ⋮⋮ and drag/.test(tip.textContent), tip.textContent);
    doc.getElementById('closeWorkoutPreview').click();
    await wait(20);
    doc.getElementById('recordBtn').click();
    await wait(950);
    const tip2 = doc.getElementById('logPerfReorderTip');
    check('...so does the workout, until it\'s closed or something\'s moved', !tip2.hidden);
    const h = doc.querySelectorAll('#logPerfExercisesList .ex-drag')[2];
    pointer(h, 'pointerdown', 2*BLOCK+15); pointer(h, 'pointermove', 10); pointer(h, 'pointerup', 10);
    await wait(20);
    check('After moving something: gone', doc.getElementById('logPerfReorderTip').hidden);
    doc.getElementById('closeLogPerf').click();
    await wait(20);
    doc.getElementById('changeExercisesBtn').click();
    await wait(20);
    check('...everywhere, for good', doc.getElementById('wpReorderTip').hidden && w.localStorage.getItem('altiro_tip_reorder')==='1');
    doc.getElementById('closeWorkoutPreview').click();
  }
  {
    // Closing it does the same.
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
    await wait(50);
    const w = dom.window, doc = w.document;
    const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
    goPill('adjust');
    for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
    doc.getElementById('applyAdjust').click();
    await wait(10);
    goPill('home');
    await wait(20);
    doc.getElementById('changeExercisesBtn').click();
    await wait(20);
    doc.querySelector('#wpReorderTip [data-close-tip]').click();
    check('Closing the tip: gone', doc.getElementById('wpReorderTip').hidden && w.localStorage.getItem('altiro_tip_reorder')==='1');
    check('...its close button is labelled', doc.querySelector('#wpReorderTip [data-close-tip]').getAttribute('aria-label')==='Close');
    doc.getElementById('closeWorkoutPreview').click();
    await wait(20);
    // ---- 5. The tour stops at Change exercises on a lifting day ----
    doc.querySelector('[data-i18n="tourReplayBtn"]').closest('button').click();
    await wait(30);
    let saw = false;
    for(let i=0; i<12 && !saw; i++){
      if(/Your order, your way/.test(doc.body.textContent)) saw = true;
      const next = [...doc.querySelectorAll('button')].find(b=> !b.closest('[hidden]') && /^Next$/i.test(b.textContent.trim()));
      if(!next) break;
      next.click();
      await wait(40);
    }
    check('The guided tour has a stop for rearranging and supersets', saw);
  }
  // ---- 3. Connect your watch ----
  {
    const {doc} = await signedIn({native:true});
    const card = doc.getElementById('watchCard');
    check('Store app, nothing connected: the card is on Today', !card.hidden && /Connect your watch/.test(card.textContent));
    check('...naming Health Connect and Strava', /through Health Connect or Strava/.test(doc.getElementById('watchCardSub').textContent), doc.getElementById('watchCardSub').textContent);
    doc.getElementById('watchCardBtn').click();
    await wait(20);
    check('Connect: opens Settings', !doc.getElementById('screen-settings').hidden);
  }
  {
    const {doc} = await signedIn({native:true, stravaFull:true});
    check('Strava full: just Health Connect', /through Health Connect\./.test(doc.getElementById('watchCardSub').textContent), doc.getElementById('watchCardSub').textContent);
  }
  {
    const {doc} = await signedIn({native:true, healthOn:true});
    check('Health Connect on: no card', doc.getElementById('watchCard').hidden);
  }
  {
    const {doc} = await signedIn({native:true, stravaConnected:true});
    check('Strava connected: no card', doc.getElementById('watchCard').hidden);
  }
  {
    const {doc} = await signedIn({});
    check('Website, Strava not connected: the card, for Strava', !doc.getElementById('watchCard').hidden && /from Strava/.test(doc.getElementById('watchCardSub').textContent));
    doc.getElementById('watchCardClose').click();
    check('Closed: gone', doc.getElementById('watchCard').hidden);
  }
  {
    const {doc} = await signedIn({closed:true});
    check('...and stays gone', doc.getElementById('watchCard').hidden);
  }
  {
    const {doc} = await signedIn({stravaFull:true});
    check('Website with Strava full: nothing to connect, no card', doc.getElementById('watchCard').hidden);
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
