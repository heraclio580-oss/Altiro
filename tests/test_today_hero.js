const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Today opens with a welcoming card instead of the big red Record circle: a nudge that fits the day,
// this week's progress ring, and one clear Start button. The streak is worked out from what was really
// done (rest days don't break it, a skipped workout does) and opens its own sheet; the weather chip
// shows the real forecast where the user is, once they allow it.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

// Today is Friday Sep 18. The history, newest first:
//   Thu 17 run, done · Wed 16 rest · Tue 15 lift, marked done · Mon 14 run, done · Sun 13 rest
//   Sat 12 run, SKIPPED · Fri 11 run, done
// -> a 3-day streak (17, 15, 14); the skipped Saturday ends it, so Friday the 11th doesn't count.
function makeBackend(opts = {}){
  const logs = {};
  let n = 1;
  const addLog = (log_date, f) => { const id = 'l'+(n++); logs[id] = {id, user_id:'u1', log_date, completed_override:null, ...f}; };
  addLog('2026-09-10', {planned_type:'strength', planned_title:'Push Day', planned_detail:'40 min', completed_override:true});
  addLog('2026-09-11', {planned_type:'run', planned_title:'Easy Run', planned_detail:'3 mi', actual_run_distance:3});
  addLog('2026-09-12', {planned_type:'run', planned_title:'Long Run', planned_detail:'6 mi'});
  addLog('2026-09-13', {planned_type:'rest', planned_title:'Rest Day', planned_detail:''});
  addLog('2026-09-14', {planned_type:'run', planned_title:'Easy Run', planned_detail:'3 mi', performance:{distance:3, time:30}});
  addLog('2026-09-15', {planned_type:'strength', planned_title:'Push Day', planned_detail:'40 min', completed_override: opts.oneThisWeek ? null : true});
  addLog('2026-09-16', {planned_type:'rest', planned_title:'Rest Day', planned_detail:''});
  addLog('2026-09-17', {planned_type:'run', planned_title:'Tempo Run', planned_detail:'4 mi', actual_run_distance: opts.oneThisWeek ? null : 4});
  addLog('2026-09-18', opts.todayRest ? {planned_type:'rest', planned_title:'Rest Day', planned_detail:''} : {planned_type:'run', planned_title:'Easy Run', planned_detail:'3 mi'});
  addLog('2026-09-19', {planned_type:'strength', planned_title:'Leg Day', planned_detail:'45 min'});
  const db = { profiles: {u1: {id:'u1', full_name:'Sam', goal:'general', level:'intermediate', training_days:[0,1,3,4,5], focus_ratio:2, intensity_idx:1, plan_start:'2026-09-07', weight_unit: opts.kg ? 'kg' : 'lb', streak: 9, best_streak: 12, total_workouts: 40}}, workout_logs: logs };
  function from(table){
    let filters = [], op = 'select';
    const api = {
      select(){ return api; }, order(){ return api; }, in(){ return api; }, is(){ return api; }, gte(){ return api; }, lte(){ return api; },
      eq(c,v){ filters.push([c,v]); return api; },
      upsert(){ op='noop'; return api; }, update(p){ op='update'; api.payload = p; return api; }, insert(){ op='noop'; return api; }, delete(){ op='noop'; return api; },
      maybeSingle(){ return run(true); }, single(){ return run(true); },
      then(res, rej){ return run(false).then(res, rej); },
    };
    async function run(single){
      const rows = db[table];
      if(op==='update' && rows){ Object.values(rows).filter(r=>filters.every(([c,v])=>r[c]===v)).forEach(r=>Object.assign(r, api.payload)); return {data:null, error:null}; }
      if(!rows || op!=='select') return {data: single ? null : [], error:null};
      const hit = Object.values(rows).filter(r=>filters.every(([c,v])=>r[c]===v));
      if(single) return {data: hit[0]||null, error:null};
      if(table==='workout_logs') return {data: hit.map(r=>({...r, manual_entries: []})), error:null};
      return {data: hit, error:null};
    }
    return api;
  }
  const user = {id:'u1', email:'sam@example.com'};
  return { db, createClient: () => ({
    auth: { async getSession(){ return {data:{session:{user}}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async signOut(){ return {}; } },
    from, functions: { async invoke(){ return {data:{connected:false}, error:null}; } },
  }) };
}

const HOURS = Array.from({length:48}, (_,i)=>`2026-09-${String(18+Math.floor(i/24)).padStart(2,'0')}T${String(i%24).padStart(2,'0')}:00`);
const FORECAST = {
  current: {time:'2026-09-18T08:15', temperature_2m:71.6, apparent_temperature:70.2, weather_code:0, wind_speed_10m:6.4, is_day:1},
  hourly: {time:HOURS, temperature_2m:HOURS.map((_,i)=>60+i%24), precipitation_probability:HOURS.map((_,i)=>i%24>=10 ? 60 : 5), weather_code:HOURS.map(()=>2), is_day:HOURS.map((_,i)=>i%24>=7 && i%24<19 ? 1 : 0)},
  daily: {temperature_2m_max:[78.4, 80], temperature_2m_min:[61.2, 63], precipitation_probability_max:[60, 10]},
};
function openSession(backend, opts = {}){
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/Altiro/',
    beforeParse(w){
      w.supabase = { createClient: () => backend.createClient() };
      w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      w.geoAsks = 0; w.fetched = [];
      Object.defineProperty(w.navigator, 'geolocation', { value: {
        getCurrentPosition(ok, fail){ w.geoAsks++; setTimeout(()=> opts.geoDenied ? fail({code:1, message:'denied'}) : ok({coords:{latitude:40.71284, longitude:-74.00601}}), 5); },
      }});
      if(opts.cached){
        w.localStorage.setItem('altiro_weather', JSON.stringify({at: Date.now()-10*60*1000, metric:false, data: FORECAST}));
        w.localStorage.setItem('altiro_weather_ok', '1');
      }
      w.fetch = async url => { w.fetched.push(String(url)); return {ok:true, status:200, json: async()=>FORECAST}; };
    },
  });
}

(async () => {
  const backend = makeBackend();
  const dom = openSession(backend);
  const w = dom.window, doc = w.document;
  await wait(300);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const text = id => doc.getElementById(id).textContent.trim();
  go('home'); await wait(30);

  // ---- the hero ----
  check('The big red Record circle is gone', !doc.querySelector('.record-circle') && !doc.querySelector('.record-hero'));
  check('Today opens with a welcoming card', !!doc.getElementById('todayHero') && text('thEyebrow')==='Ready when you are' && text('thTitle')==='Time to run.', `${text('thEyebrow')} | ${text('thTitle')}`);
  check('...that cheers on the streak (this week already has its 2)', text('thSub')==='This week counts. Keep your 2-week streak going.', text('thSub'));
  check('...shows this week\'s progress as a ring', /^\d+\/\d+this week$/.test(text('thRing')) && doc.querySelectorAll('#thRing circle').length>=2, text('thRing'));
  check('...and one clear Start button', text('recordBtn')==='Start Workout' && !doc.getElementById('recordBtn').classList.contains('disabled'), text('recordBtn'));
  doc.getElementById('recordBtn').click();
  await wait(450);
  check('Start opens today\'s workout to log', !doc.getElementById('logPerfOverlay').hidden);
  doc.getElementById('saveLogPerf').click(); await wait(60);
  go('home'); await wait(30);
  check('Done: the card says so', doc.getElementById('todayHero').classList.contains('done') && text('thTitle')==='Nice work.' && text('thSub')==="That's 2 weeks in a row.", `${text('thTitle')} | ${text('thSub')}`);
  check('...shows what\'s next', text('thNext')==='Next up: Leg Day · tomorrow', text('thNext'));
  check('...and the button is a done badge, not an action', doc.getElementById('recordBtn').classList.contains('done') && text('recordBtn')==='Completed');

  // ---- the streak ----
  const chip = doc.getElementById('streakChip');
  check('Streak chip: weeks in a row with a workout', chip.textContent.trim()==='2 WEEK STREAK', chip.textContent.trim());
  check('...saved to the profile too', backend.db.profiles.u1.streak===2, backend.db.profiles.u1.streak);
  chip.click(); await wait(10);
  const sk = doc.getElementById('streakOverlay');
  check('Tapping it opens the streak', !sk.hidden && sk.querySelector('.sk-num').textContent.startsWith('2'));
  const stats = [...sk.querySelectorAll('.sk-stat')].map(x=>x.querySelector('b').textContent+' '+x.querySelector('span').textContent);
  check('...with the best streak (in weeks, from the history) and workouts done', stats[0]==='2 Best streak' && stats[1]==='41 Workouts done', stats.join(' / '));
  const weeks = [...sk.querySelectorAll('.sk-weeks .sk-day')].map(d=>{ const dot = d.querySelector('.sk-dot'); return dot.className.replace('sk-dot ','')+':'+dot.textContent+':'+d.textContent.replace(dot.textContent,''); });
  check('...and the last 8 weeks, with how many workouts each', weeks.length===8 && weeks.slice(-2).join(',')==='done:2:Sep 7,done:4:Sep 14' && weeks.slice(0,6).every(w=>w.startsWith('rest')), weeks.join(' | '));
  doc.getElementById('closeStreak').click();

  // ---- the weather ----
  const wx = doc.getElementById('weatherChip');
  check('Weather: no made-up forecast, and nobody is asked for their location yet', wx.textContent.trim()==='Add weather' && w.geoAsks===0 && !wx.textContent.includes('72°F'), wx.textContent.trim());
  wx.click(); await wait(10);
  const wxBody = () => doc.getElementById('weatherBody').textContent.replace(/\s+/g,' ').trim();
  check('Tapping it explains, before asking', !doc.getElementById('weatherOverlay').hidden && /only to look up the forecast/.test(wxBody()));
  doc.getElementById('weatherAllowBtn').click(); await wait(60);
  check('Allowing: the real forecast is fetched for where they are (rounded)', w.geoAsks===1 && w.fetched.length===1 && /api\.open-meteo\.com\/v1\/forecast\?latitude=40\.71&longitude=-74\.01/.test(w.fetched[0]) && /temperature_unit=fahrenheit/.test(w.fetched[0]), w.fetched[0]);
  check('...the chip shows it', wx.textContent.trim()==='72°F · Clear', wx.textContent.trim());
  check('...and the sheet: now, feels like, high/low, rain, wind', doc.querySelector('.wx-temp').textContent==='72°F' && doc.querySelector('.wx-cond').textContent==='Clear' && /Feels like 70°F · High 78°F · Low 61°F · Rain 60% · Wind 6 mph/.test(wxBody()), wxBody());
  const hours = [...doc.querySelectorAll('.wx-hour')].map(h=>h.textContent.replace(/\s+/g,' ').trim());
  check('...the next few hours', hours.length===5 && hours[0].startsWith('Now') && hours[1].startsWith('9am'), hours.join(' | '));
  check('...with a tip for training in it', doc.querySelector('.wx-tip').textContent==='Rain is likely: a light jacket helps, or swap in an indoor workout.', doc.querySelector('.wx-tip').textContent);
  doc.getElementById('closeWeather').click();

  // Next visit: shown straight away from the last half hour, without asking again.
  const dom2 = openSession(backend, {cached: true});
  await wait(300);
  [...dom2.window.document.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(30);
  check('Next visit: the recent forecast shows right away, without asking again', dom2.window.document.getElementById('weatherChip').textContent.trim()==='72°F · Clear' && dom2.window.geoAsks===0, dom2.window.document.getElementById('weatherChip').textContent.trim());

  // Location refused
  const dom3 = openSession(makeBackend(), {geoDenied:true});
  await wait(300);
  const d3 = dom3.window.document;
  [...d3.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(30);
  d3.getElementById('weatherChip').click(); await wait(10);
  d3.getElementById('weatherAllowBtn').click(); await wait(60);
  check('Location refused: says how to allow it, with Try again', /Location is off for Altiro/.test(d3.getElementById('weatherBody').textContent) && d3.getElementById('weatherAllowBtn').textContent==='Try again' && dom3.window.fetched.length===0);

  // kg users get Celsius
  const dom4 = openSession(makeBackend({kg:true}));
  await wait(300);
  const d4 = dom4.window.document;
  [...d4.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(30);
  d4.getElementById('weatherChip').click(); await wait(10);
  d4.getElementById('weatherAllowBtn').click(); await wait(60);
  check('Metric users get Celsius and km/h', /temperature_unit=celsius/.test(dom4.window.fetched[0]) && /wind_speed_unit=kmh/.test(dom4.window.fetched[0]) && d4.getElementById('weatherChip').textContent.includes('°C'));

  // Rest day
  const dom5 = openSession(makeBackend({todayRest:true}));
  await wait(300);
  const d5 = dom5.window.document;
  [...d5.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(30);
  check('Rest day: a calm card, no Start button to press, and what\'s next', d5.getElementById('todayHero').classList.contains('rest') && d5.getElementById('thTitle').textContent==='Recover and recharge.' && d5.getElementById('recordBtn').classList.contains('disabled') && d5.getElementById('thNext').textContent==='Next up: Leg Day · tomorrow', d5.getElementById('thNext').textContent);
  check('...and the streak still counts this week and last', d5.getElementById('streakChip').textContent.trim()==='2 WEEK STREAK', d5.getElementById('streakChip').textContent.trim());

  // Spanish
  go('settings'); await wait(10);
  [...doc.querySelectorAll('.lang-btn')].filter(b=>b.dataset.lang==='es').forEach(b=>b.click()); await wait(10);
  go('home'); await wait(30);
  check('Spanish: the card and chips are translated', text('thTitle')==='Buen trabajo.' && doc.getElementById('weatherChip').textContent.trim()==='72°F · Despejado' && /SEMANAS SEGUIDAS/.test(doc.getElementById('streakChip').textContent), `${text('thTitle')} | ${doc.getElementById('weatherChip').textContent.trim()}`);

  // A week with no workout ends it: runs in the week of Aug 24, nothing the week of Aug 31.
  const b8 = makeBackend();
  b8.db.workout_logs.old = {id:'old', user_id:'u1', log_date:'2026-08-26', completed_override:null, planned_type:'run', planned_title:'Easy Run', planned_detail:'3 mi', actual_run_distance:3};
  const dom8 = openSession(b8);
  await wait(300);
  const d8 = dom8.window.document;
  [...d8.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(30);
  check('A week with no workouts ends the streak', d8.getElementById('streakChip').textContent.trim()==='2 WEEK STREAK', d8.getElementById('streakChip').textContent.trim());
  d8.getElementById('streakChip').click(); await wait(10);
  const w8 = [...d8.querySelectorAll('.sk-weeks .sk-dot')].map(x=>x.className.replace('sk-dot ',''));
  check('...shown as a missed week (and one workout alone doesn\'t count a week)', w8.slice(-4).join(',')==='partial,missed,done,done', w8.join(','));
  check('...with "this week" progress', /This week: 2 of 2 workouts/.test(d8.getElementById('streakBody').textContent), d8.getElementById('streakBody').textContent);

  // One workout so far this week: the second keeps the streak going.
  const b9 = makeBackend({oneThisWeek:true});
  const dom9 = openSession(b9);
  await wait(300);
  const d9 = dom9.window.document;
  [...d9.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(30);
  check('One workout this week: the week doesn\'t count yet, and the card says what will', d9.getElementById('streakChip').textContent.trim()==='1 WEEK STREAK' && d9.getElementById('thSub').textContent==='1 more workout this week makes it 2 weeks in a row.', d9.getElementById('streakChip').textContent.trim()+' | '+d9.getElementById('thSub').textContent);
  d9.getElementById('recordBtn').click(); await wait(450);
  d9.getElementById('saveLogPerf').click(); await wait(60);
  [...d9.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(30);
  check('...the second workout counts the week', d9.getElementById('streakChip').textContent.trim()==='2 WEEK STREAK' && d9.getElementById('thSub').textContent==="That's 2 weeks in a row.", d9.getElementById('streakChip').textContent.trim()+' | '+d9.getElementById('thSub').textContent);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
