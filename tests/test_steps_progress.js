const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Progress -> Steps (store app, Apple Health / Health Connect on): today's steps and the last 7 days,
// weekly totals and monthly totals, each with its daily average; tap a bar to see it. Kept on the
// phone only; turning the connection off removes it. Not on the website.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

const key = d=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), TODAY = key(today);
// A step count for each of the last 200 days: 5,000 + 1,000 per weekday number; today 4,321.
const steps = {};
for(let i=0; i<200; i++){ const d = new Date(today); d.setDate(d.getDate()-i); steps[key(d)] = i===0 ? 4321 : 5000 + d.getDay()*1000; }
const sum = (from, to)=>{ let t = 0, n = 0; for(let d = new Date(from); d <= to; d.setDate(d.getDate()+1)){ if(steps[key(d)]){ t += steps[key(d)]; n++; } } return {t, avg: Math.round(t/n)}; };
const fmt = n=> n.toLocaleString('en-US');

const plugin = {
  isAvailable: async()=> ({available: true}),
  requestAuthorization: async(o)=> ({readAuthorized: o.read}),
  queryWorkouts: async()=> ({workouts: []}),
  queryAggregated: async(o)=>{
    // One sample per day from the start asked for, as Health Connect does (24-hour buckets from there).
    const out = [];
    for(let t = Date.parse(o.startDate); t < Date.parse(o.endDate); t += 86400000){
      const k = key(new Date(t + 12*3600000));
      if(steps[k]) out.push({startDate: new Date(t).toISOString(), endDate: new Date(t+86400000).toISOString(), value: steps[k], unit: 'count'});
    }
    return {samples: out};
  },
};

(async () => {
  {
    const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = TODAY; }});
    await wait(50);
    [...dom.window.document.querySelectorAll('.proto-pill')].find(p=> p.dataset.navId==='progress').click(); await wait(20);
    check('Website: no Steps on Progress', dom.window.document.getElementById('stepsSection').hidden);
    dom.window.close();
  }
  const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/',
    beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = TODAY; w.Capacitor = {isNativePlatform: ()=> true, getPlatform: ()=> 'android', Plugins: {Health: plugin}}; }});
  await wait(60);
  const { window } = dom, doc = window.document;
  const go = id=> [...doc.querySelectorAll('.proto-pill')].find(p=> p.dataset.navId===id).click();
  const text = id=> doc.getElementById(id).textContent.replace(/\s+/g,' ').trim();
  const nowText = ()=> [...doc.getElementById('stepsNow').children].map(e=> e.textContent.trim()).join(' ');
  go('progress'); await wait(20);
  check('App, Health not connected yet: no Steps', doc.getElementById('stepsSection').hidden);
  go('settings'); await wait(20);
  doc.getElementById('healthConnectBtn').click(); await wait(120);
  go('progress'); await wait(30);
  check('Connected: Progress shows Steps', !doc.getElementById('stepsSection').hidden);
  const last7 = []; for(let i=6; i>=0; i--){ const d = new Date(today); d.setDate(d.getDate()-i); last7.push(steps[key(d)]); }
  check('Day: today\'s steps, with the 7-day average', /^Today 4,321 7-day average: /.test(nowText()) && nowText().endsWith(fmt(Math.round(last7.reduce((a,b)=>a+b,0)/7))), nowText());
  check('...and a bar for each of the last 7 days, today picked', doc.querySelectorAll('#stepsChart .bar-col').length===7 && doc.querySelector('#stepsChart .bar-col:last-child').classList.contains('selected'));

  doc.querySelector('[data-step-view="week"]').click(); await wait(10);
  const mon = new Date(today); mon.setDate(mon.getDate() - (mon.getDay()+6)%7);
  const wk = sum(mon, today);
  check('Week: this week\'s total and its daily average', nowText()===`This week ${fmt(wk.t)} ${fmt(wk.avg)} a day on average`, nowText());
  check('...8 weeks of bars', doc.querySelectorAll('#stepsChart .bar-col').length===8);
  doc.querySelector('#stepsChart .bar-col').click(); await wait(10);
  const a = new Date(mon); a.setDate(a.getDate()-49); const b = new Date(a); b.setDate(b.getDate()+6);
  const w0 = sum(a, b);
  check('Tapping a bar shows that week', nowText().startsWith('Week of ') && nowText().includes(fmt(w0.t)), `${nowText()} | want ${fmt(w0.t)}`);

  doc.querySelector('[data-step-view="month"]').click(); await wait(10);
  const m = sum(new Date(today.getFullYear(), today.getMonth(), 1), today);
  const monthName = today.toLocaleDateString('en-US', {month:'long', year:'numeric'});
  check('Month: this month\'s total and its daily average', nowText()===`${monthName} ${fmt(m.t)} ${fmt(m.avg)} a day on average`, nowText());
  check('...6 months of bars', doc.querySelectorAll('#stepsChart .bar-col').length===6);

  check('Kept on the phone', Object.keys(window.localStorage).some(k=> /^altiro_health_steps_/.test(k)));
  go('settings'); await wait(20);
  doc.getElementById('healthOffBtn').click(); await wait(20);
  go('progress'); await wait(20);
  check('Turning the connection off: Steps go, and the phone forgets them', doc.getElementById('stepsSection').hidden && !Object.keys(window.localStorage).some(k=> /^altiro_health_steps_/.test(k)));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
