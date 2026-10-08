const fs = require('fs');
const path = require('path');
const http = require('http');

// Three things, in a real browser with a fake clock:
//  - Kilometres: the app in km shows and takes distances in km everywhere (plan text, Log Performance,
//    Progress, the GPS run and its splits, the share card), the km/mi switch in Settings flips it all, and
//    distances are still saved in miles underneath.
//  - Voice during GPS runs: "Run started", each mile (or km) with the time and that split's pace,
//    paused/resumed, and "Run complete" -- in the app's language; the speaker button turns it off.
//  - The rest timer: checking off a set starts a rest at the bottom of Log Performance; -15/+15 change it
//    (and the new length is remembered), the last seconds beep, the end says "Go" and buzzes; none after
//    the last set; Skip ends it.
// Skipped where Playwright/Chromium isn't installed.
let chromium;
for(const p of ['playwright', '/opt/node22/lib/node_modules/playwright']){ try{ ({ chromium } = require(p)); break; }catch(e){} }
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f=> fs.existsSync(f));
if(!chromium){ console.log('(Playwright not installed -- skipped)'); process.exit(0); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const www = path.join(__dirname, '..', 'www');
const LAT0 = 37.7749, LNG0 = -122.4194, M_LAT = 1/111195;

(async () => {
  const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.wav':'audio/wav', '.png':'image/png'};
  const server = http.createServer((req, res)=>{
    const f = path.join(www, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if(!f.startsWith(www) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, {'Content-Type': types[path.extname(f)] || 'application/octet-stream'});
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=> server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });

  async function openApp(opts){
    opts = opts || {};
    const ctx = await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true, locale: opts.locale || 'en-US' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e=> errors.push(e.message));
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    await page.route(/maplibre-gl\.js$/, r=> r.abort());
    await page.clock.install({time: new Date('2026-09-19T08:00:00')});
    await page.addInitScript(o=>{
      window.__ALTIRO_TEST_TODAY__ = o.today || '2026-09-19';
      if(o.unit) localStorage.setItem('altiro_dist_unit', o.unit);
      if(o.lang) localStorage.setItem('altiro_lang', o.lang);
      window.__said = [];
      window.speechSynthesis.speak = u=> window.__said.push({text: u.text, lang: u.lang});
      window.speechSynthesis.cancel = ()=>{};
      window.__geo = {cb:null};
      navigator.geolocation.watchPosition = cb=>{ window.__geo.cb = cb; return 7; };
      navigator.geolocation.clearWatch = ()=>{ window.__geo.cb = null; };
      window.__fix = (lat, lng)=>{ if(window.__geo.cb) window.__geo.cb({coords:{latitude:lat, longitude:lng, accuracy:6}, timestamp: Date.now()}); };
      window.__buzz = [];
      navigator.vibrate = p=>{ window.__buzz.push(p); return true; };
      window.__tones = 0;
      const osc = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function(){ window.__tones++; return osc.call(this); };
    }, opts);
    await page.goto(base + 'index.html?proto');
    await sleep(400);
    await page.clock.pauseAt(new Date('2026-09-19T08:05:00'));
    await page.evaluate(()=>{ [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='home').click(); document.documentElement.classList.remove('proto-on'); });
    await sleep(200);
    return {page, errors};
  }
  const txt = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g,' ').trim() : null; }, sel);
  const shown = (page, sel)=> page.evaluate(s=>{ const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]'); }, sel);
  const goto = (page, id)=> page.evaluate(i=>{ document.documentElement.classList.add('proto-on'); [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId===i).click(); document.documentElement.classList.remove('proto-on'); }, id);
  const run = async (page, from, to)=>{ for(let i=from; i<=to; i++){ await page.clock.fastForward(2000); await page.evaluate(([la, ln])=> window.__fix(la, ln), [LAT0 + i*10*M_LAT, LNG0]); } };
  const said = page=> page.evaluate(()=> window.__said.map(s=> s.text));
  const milesShown = /\d\s*mi\b|\/mi\b/;
  // On a day that isn't a run, the GPS button is under the Today card's More.
  const tapTrack = async (page)=>{ if(!(await page.evaluate(()=>{ const e = document.getElementById('trackRunBtn'); return !!e && !e.closest('[hidden]'); }))) await page.tap('#homeMoreBtn'); await page.tap('#trackRunBtn'); };

  // ---- Kilometres ----
  {
    const {page, errors} = await openApp({unit: 'km'});
    await goto(page, 'week'); await sleep(150);
    const plan = await txt(page, '#screen-week');
    check('In km, the Plan shows km (and no miles)', /\d km\b/.test(plan) && !milesShown.test(plan), plan.slice(0, 200));
    await goto(page, 'settings'); await sleep(150);
    check('Settings has a Distance switch, set to KM', await page.evaluate(()=> document.querySelector('#screen-settings [data-dist="km"]').classList.contains('active') && !document.querySelector('#screen-settings [data-dist="mi"]').classList.contains('active')));
    // Log a run: the field is in km, and what's saved is miles.
    await goto(page, 'home'); await sleep(150);
    await page.evaluate(()=>{
      const doc = document;
      doc.getElementById('addTodayWorkoutBtn').click();
      doc.getElementById('manualNameInput').value = 'Easy run';
      doc.getElementById('manualNameInput').dispatchEvent(new Event('input', {bubbles:true}));
      [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
      doc.getElementById('saveManualEntry').click();
    });
    await sleep(100);
    await page.tap('#recordBtn'); await page.clock.fastForward(500); await sleep(100);
    check('Log Performance asks for distance in km', /Distance \(km\)/.test(await txt(page, '#logPerfDistanceSection')), await txt(page, '#logPerfDistanceSection'));
    await page.evaluate(()=>{ const d = document.getElementById('logPerfDistanceInput'); d.value = '10'; d.dispatchEvent(new Event('input', {bubbles:true}));
      ['H','M','S'].forEach((k,i)=>{ const e = document.getElementById('logPerfTime'+k+'Input'); e.value = ['0','50','0'][i]; e.dispatchEvent(new Event('input', {bubbles:true})); }); });
    await page.tap('#saveLogPerf'); await sleep(300);
    const stats = await txt(page, '#summaryStats');
    check('10 km in 50:00 shows as 10.0 km at 5:00/km', /10(\.0)? km/.test(stats) && /5:00\/km/.test(stats) && !milesShown.test(stats), stats);
    await goto(page, 'progress'); await sleep(200);
    const prog = await txt(page, '#screen-progress');
    check('Progress counts it in km (6.21 mi underneath = 10 km)', /10(\.0)? km/.test(prog) && !milesShown.test(prog), prog.slice(0, 260));
    // The weekly distance question and the 1 km time.
    const chips = await page.evaluate(()=>{ const r = [...document.querySelectorAll('[id$="MilesChips"] .chip')].map(c=>c.textContent); return r; });
    check('The "how far do you run a week" choices are in km', chips.includes('10–16') && chips.includes('64+'), JSON.stringify(chips));
    check('...and the pace question asks for a 1 km time', await page.evaluate(()=> [...document.querySelectorAll('[data-i18n="mileTimeLabel"]')].some(e=> /1 km time/.test(e.textContent))));
    // Back to miles: everything flips back.
    await goto(page, 'settings'); await sleep(100);
    await page.tap('#screen-settings [data-dist="mi"]'); await sleep(200);
    await goto(page, 'week'); await sleep(150);
    const plan2 = await txt(page, '#screen-week');
    check('Switching to MI: the Plan is in miles again', /\d(\.\d)? mi\b/.test(plan2) && !/\d km\b/.test(plan2), plan2.slice(0, 200));
    check('...and it\'s remembered', await page.evaluate(()=> localStorage.getItem('altiro_dist_unit'))==='mi');
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- The MI | KM switch beside "how far do you run a week" in Adjust ----
  {
    const {page, errors} = await openApp();
    await page.evaluate(()=> document.querySelector('[data-open-adjust]').click());
    await sleep(150);
    const chipsNow = ()=> page.evaluate(()=> [...document.querySelectorAll('#adjMilesChips .chip')].map(c=> c.textContent));
    const sel = ()=> page.evaluate(()=> (document.querySelector('#adjMilesChips .chip.sel') || {}).textContent || null);
    check('Adjust has a MI | KM switch beside the weekly distance question, on MI', await shown(page, '#adjMilesSection [data-dist="km"]') && await page.evaluate(()=> document.querySelector('#adjMilesSection [data-dist="mi"]').classList.contains('active')));
    await page.evaluate(()=> [...document.querySelectorAll('#adjMilesChips .chip')].find(c=> c.textContent==='6–10').click());
    await sleep(100);
    const before = await sel();
    await page.tap('#adjMilesSection [data-dist="km"]'); await sleep(150);
    check('Tapping KM: the question and its choices switch to km, Adjust stays open', await shown(page, '#adjustOverlay') && (await chipsNow()).includes('10–16') && /Kilometers you run a week/.test(await txt(page, '#adjMilesSection')), JSON.stringify(await chipsNow()));
    check('...the same choice stays picked: 6–10 mi shows as 10–16 km', before==='6–10' && (await sel())==='10–16', `${before} -> ${await sel()}`);
    check('...and the whole app follows (Settings shows KM too)', await page.evaluate(()=> document.querySelector('#screen-settings [data-dist="km"]').classList.contains('active')));
    await page.tap('#adjMilesSection [data-dist="mi"]'); await sleep(150);
    check('Tapping MI switches back', (await chipsNow()).includes('6–10') && /Miles you run a week/.test(await txt(page, '#adjMilesSection')) && await page.evaluate(()=> localStorage.getItem('altiro_dist_unit'))==='mi');
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- A phone set to Spanish (Mexico) starts in km; a US phone in miles ----
  {
    const {page, errors} = await openApp({locale: 'es-MX'});
    check('A phone in es-MX starts in km', await page.evaluate(()=> document.querySelector('[data-dist="km"]').classList.contains('active')));
    await page.context().close();
    const us = await openApp({locale: 'en-US'});
    check('A phone in en-US starts in miles', await us.page.evaluate(()=> document.querySelector('[data-dist="mi"]').classList.contains('active')));
    check('No page errors', errors.length===0 && us.errors.length===0, errors.concat(us.errors).join(' | '));
    await us.page.context().close();
  }

  // ---- Voice during a GPS run (miles, English) ----
  {
    const {page, errors} = await openApp();
    await tapTrack(page);
    check('The tracker has a voice button, on to start with', await page.evaluate(()=> document.getElementById('gpsVoiceBtn').getAttribute('aria-pressed'))==='true');
    await page.evaluate(([la, ln])=> window.__fix(la, ln), [LAT0, LNG0]);
    await page.tap('#gpsStartBtn');
    await run(page, 1, 100);
    await page.tap('#gpsStartBtn');           // pause
    await page.tap('#gpsStartBtn');           // resume
    await run(page, 101, 180);
    const s1 = await said(page);
    check('It says "Run started", "Run paused", "Run resumed"', s1[0]==='Run started' && s1.includes('Run paused') && s1.includes('Run resumed'), JSON.stringify(s1));
    const mile = s1.find(t=> /^Mile 1\./.test(t));
    check('At the mile: "Mile 1. Time, 5 minutes ... Last mile, 5 minutes ..."', !!mile && /Time, 5 minutes \d+ seconds\. Last mile, 5 minutes( \d+)?\./.test(mile), mile);
    check('...spoken in English', await page.evaluate(()=> window.__said.every(s=> s.lang==='en-US')));
    await page.evaluate(()=> document.getElementById('gpsHoldFinish').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
    await page.clock.fastForward(1300); await sleep(100);
    const end = (await said(page)).pop();
    check('Finishing: "Run complete. 1.11 miles in 6 minutes ..."', /^Run complete\. 1\.1\d miles in 6 minutes/.test(end), end);
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- Voice in Spanish and km, and turned off ----
  {
    const {page, errors} = await openApp({unit: 'km', lang: 'es'});
    await tapTrack(page);
    check('In km, the tracker\'s distance reads Kilómetros', /Kilómetros/.test(await txt(page, '#gpsOverlay .gps-grid')), await txt(page, '#gpsOverlay .gps-grid'));
    await page.evaluate(([la, ln])=> window.__fix(la, ln), [LAT0, LNG0]);
    await page.tap('#gpsStartBtn');
    await run(page, 1, 105);
    const s = await said(page);
    const km = s.find(t=> /^Kilómetro 1\./.test(t));
    check('Spanish, km: "Kilómetro 1. Tiempo, 3 minutos ... Último kilómetro, ..."', !!km && /Tiempo, 3 minutos \d+ segundos\. Último kilómetro, 3 minutos/.test(km), JSON.stringify(s));
    check('...in Spanish', await page.evaluate(()=> window.__said.every(x=> /^es/.test(x.lang))));
    check('The tracker shows km: 1.04', (await txt(page, '#gpsDist'))==='1.04', await txt(page, '#gpsDist'));
    await page.tap('#gpsVoiceBtn');
    const before = (await said(page)).length;
    await run(page, 106, 205);
    check('Voice off: the next km is not announced', (await said(page)).length===before && await page.evaluate(()=> document.getElementById('gpsVoiceBtn').getAttribute('aria-pressed'))==='false');
    await page.evaluate(()=> document.getElementById('gpsHoldFinish').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})));
    await page.clock.fastForward(1300); await sleep(100);
    await page.tap('#saveLogPerf'); await sleep(300);
    const sp = await txt(page, '#summarySplits');
    check('Splits are per km, labelled Km', /Km 1\s*3:\d\d\/km/.test(sp) && /Km 2/.test(sp), sp);
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  // ---- Rest timer ----
  {
    const {page, errors} = await openApp();
    await page.evaluate(async ()=>{
      const doc = document, wait = ms=> new Promise(r=>setTimeout(r,ms));
      const type = (el, v)=>{ el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); };
      doc.getElementById('addTodayWorkoutBtn').click();
      doc.getElementById('createLiveToggle').click();
      type(doc.getElementById('manualNameInput'), 'Push Day');
      doc.getElementById('saveManualEntry').click();
      type(doc.getElementById('logPerfAddExerciseInput'), 'Bench Press'); doc.getElementById('logPerfAddExerciseBtn').click();
      const row = doc.querySelector('#logPerfExercisesList .exercise-log-row');
      row.querySelector('[data-step="1"]').click();
    });
    await sleep(100);
    const dots = '#logPerfExercisesList .set-check-dot';
    check('(set-up) a lift with 2 sets, no rest running', await page.evaluate(d=> document.querySelectorAll(d).length, dots)===2 && !(await shown(page, '#restBar')));
    await page.locator(dots).first().tap();
    check('Checking off set 1 starts a 1:30 rest', await shown(page, '#restBar') && (await txt(page, '#restTime'))==='1:30', await txt(page, '#restTime'));
    await page.tap('#restPlus');
    check('+15 makes it 1:45', (await txt(page, '#restTime'))==='1:45', await txt(page, '#restTime'));
    await page.clock.fastForward(30000);
    check('It counts down', (await txt(page, '#restTime'))==='1:15', await txt(page, '#restTime'));
    await page.clock.fastForward(70000);             // to 0:05 left
    const tonesBefore = await page.evaluate(()=> window.__tones);
    await page.clock.runFor(3600);                    // step through 0:05 .. 0:01.4, tick by tick
    check('The last seconds beep', await page.evaluate(()=> window.__tones) - tonesBefore >= 2);
    await page.clock.runFor(1800);
    check('At zero: "Go!", a buzz', (await txt(page, '#restTime'))==='Go!' && await page.evaluate(()=> window.__buzz.length)===1, await txt(page, '#restTime'));
    await page.clock.fastForward(3000);
    check('...then the rest bar goes away', !(await shown(page, '#restBar')));
    await page.locator(dots).first().tap();           // untick
    await page.locator(dots).first().tap();           // tick again
    check('The next rest starts at the length chosen last time (1:45)', (await txt(page, '#restTime'))==='1:45', await txt(page, '#restTime'));
    await page.tap('#restSkip');
    check('Skip ends it', !(await shown(page, '#restBar')));
    await page.locator(dots).nth(1).tap();
    check('No rest after the last set of the workout', !(await shown(page, '#restBar')));
    check('No page errors', errors.length===0, errors.join(' | '));
    await page.context().close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
