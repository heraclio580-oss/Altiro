const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The Summary after a workout ends with how to recover for the next one: one tip to rehydrate, one to
// refuel, one to rest, for that kind of workout (a long run: the electrolyte one), a different tip from
// day to day -- in place of the old one-liner ("Nice work -- that's another session logged...").
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

check('The old line is gone', !/another session logged/.test(html));
const start = html.indexOf('const RECOVERY_TIPS = {'), end = html.indexOf('\n}', html.indexOf('function recoveryTips(')) + 2;
const R = new Function(`let state = {lang:'en'}; ${html.slice(start, end)} return {RECOVERY_TIPS, recoveryTips, setLang: l=> { state.lang = l; }};`)();
const run = {t:'run'}, lift = {t:'strength'}, cls = {t:'class'};
const tips = (s, logged, key)=> R.recoveryTips(s, logged, key);
const a = tips(run, {distance: 5.01, time: 52.4}, '2026-10-15');
check('A run: Rehydrate, Refuel, Rest', a.map(t=> t.label).join('|')==='Rehydrate|Refuel|Rest' && a.every(t=> t.text.length > 20), JSON.stringify(a));
check('...the same tips each time that day\'s Summary is opened', JSON.stringify(tips(run, {distance: 5.01, time: 52.4}, '2026-10-15'))===JSON.stringify(a));
const days = new Set(['2026-10-15','2026-10-16','2026-10-17','2026-10-18'].map(k=> tips(run, {distance: 3, time: 30}, k).map(t=> t.text).join('|')));
check('...and different ones from day to day', days.size > 1, days.size);
const long = tips(run, {distance: 8, time: 80}, '2026-10-15');
check('A long run (an hour, or 6+ mi): replace salt as well as water', /electrolyte/.test(long[0].text), long[0].text);
const l = tips(lift, {}, '2026-10-15');
check('Lifting: its own tips (protein, rest for the muscles, sleep)', R.RECOVERY_TIPS.strength.eat.some(t=> t.en===l[1].text) && R.RECOVERY_TIPS.strength.rest.some(t=> t.en===l[2].text), JSON.stringify(l));
check('A class or anything else: general ones', tips(cls, null, '2026-10-15').length===3);
R.setLang('es');
const es = tips(run, {distance: 5, time: 50}, '2026-10-15');
check('In Spanish: Hidrátate, Recarga, Descansa', es.map(t=> t.label).join('|')==='Hidrátate|Recarga|Descansa' && /[áéíóúñ]/.test(es.map(t=> t.text).join('')), JSON.stringify(es));
const all = ['run','strength','other'].flatMap(k=> Object.values(R.RECOVERY_TIPS[k]).flat());
check('Every tip in English and Spanish', all.length >= 15 && all.every(t=> t.en && t.es));

(async () => {
  // In the app: finishing today's workout shows them under its stats.
  const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/',
    beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-10-14'; }}); // a Wednesday: a workout day
  await wait(60);
  const doc = dom.window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p=> p.dataset.navId==='home').click(); await wait(20);
  doc.getElementById('recordBtn').click(); await wait(950);
  const lp = doc.getElementById('logPerfOverlay');
  if(!lp.hidden) doc.getElementById('saveLogPerf').click();
  await wait(300);
  check('(set-up) the Summary is showing', !doc.getElementById('screen-summary').hidden);
  const items = [...doc.querySelectorAll('#summaryRecoveryList li')].map(li=> li.textContent);
  check('The Summary: "Recover for your next workout", with its three tips', doc.getElementById('summaryRecoveryHead').textContent==='Recover for your next workout'
    && items.length===3 && /^Rehydrate:/.test(items[0]) && /^Refuel:/.test(items[1]) && /^Rest:/.test(items[2]), JSON.stringify(items));
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
