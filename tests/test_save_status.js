const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Saving, saved, or not saved: every change sent to the cloud goes through the app's own fetch, which shows
// a small "Saved" at the top when it lands, and says plainly when it didn't (offline or a failed save).
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const flat = el => el ? el.textContent.replace(/\s+/g,' ').trim() : '';

(async () => {
  let opts = null, online = true, next = 'ok';
  const fetches = [];
  function from(){ const api = { select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; }, in(){ return api; },
    insert(){ return api; }, delete(){ return api; }, update(){ return api; }, upsert(){ return api; },
    maybeSingle(){ return Promise.resolve({data:null, error:null}); }, then(r, j){ return Promise.resolve({data:[], error:null}).then(r, j); } }; return api; }
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){
    w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
    Object.defineProperty(w.navigator, 'onLine', { get: ()=> online });
    w.fetch = (url, init)=>{ fetches.push([url, (init||{}).method||'GET']);
      if(next==='down') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ok: next==='ok', status: next==='ok' ? 201 : next==='500' ? 500 : 400}); };
    w.supabase = { createClient: (u, k, o)=>{ opts = o; return { auth:{ onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:null}}; } }, from }; } };
  } });
  await wait(400);
  const doc = dom.window.document, chip = doc.getElementById('saveChip'), bar = doc.getElementById('netBar');
  const f = opts && opts.global && opts.global.fetch;
  check('The cloud client sends everything through the app\'s own fetch', typeof f==='function');

  await f('https://x.supabase.co/rest/v1/workout_logs?select=id', {method:'GET'});
  check('Reading data shows nothing', chip.hidden && bar.hidden);

  await f('https://x.supabase.co/rest/v1/manual_entries', {method:'POST', body:'{}'});
  check('A change that lands: a small "Saved" at the top', !chip.hidden && /Saved/.test(flat(chip)), flat(chip));
  await wait(1600);
  check('...that goes away by itself', chip.hidden);

  next = 'down';
  await f('https://x.supabase.co/rest/v1/manual_entries', {method:'POST'}).catch(()=>{});
  check('A change that fails: it says so plainly, and it stays', !bar.hidden && /didn't save/.test(flat(bar)) && chip.hidden, flat(bar));
  await wait(1600);
  check('...still there a moment later', !bar.hidden);

  next = 'ok';
  await f('https://x.supabase.co/rest/v1/manual_entries', {method:'PATCH'});
  check('The next change that lands clears it', bar.hidden && /Saved/.test(flat(chip)));

  next = '400';
  await f('https://x.supabase.co/rest/v1/profiles', {method:'PATCH'});
  check('A request the app retries itself (e.g. a column this database lacks) isn\'t called a failure', bar.hidden);

  // Offline.
  online = false;
  dom.window.dispatchEvent(new dom.window.Event('offline'));
  check('(signed out: no offline bar on the welcome screen)', bar.hidden);
  next = 'down';
  await f('https://x.supabase.co/rest/v1/manual_entries', {method:'POST'}).catch(()=>{});
  check('Offline, a change says it won\'t be saved until back online', !bar.hidden && /offline/.test(flat(bar)), flat(bar));
  online = true; next = 'ok';
  dom.window.dispatchEvent(new dom.window.Event('online'));
  check('Back online, it still says the last change didn\'t save', !bar.hidden && /didn't save/.test(flat(bar)), flat(bar));
  doc.getElementById('netBarClose').click();
  check('The bar can be closed', bar.hidden);

  // In Spanish.
  doc.querySelector('.lang-btn[data-lang="es"]').click();
  await f('https://x.supabase.co/rest/v1/manual_entries', {method:'POST'});
  check('In Spanish too', /Guardado/.test(flat(chip)), flat(chip));
  check('(every request went to the network)', fetches.length===7, fetches.length);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
