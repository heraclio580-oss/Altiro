const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Adjust -> "Long run day" and "Faster run day": which training day the week's long run, and its tempo /
// intervals / hills, go on. Auto lets the plan pick; a chosen day moves it there on Plan; one day can't be
// both; it only shows when the plan has runs. Training days are just the day chips (no count chips).
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-10-12'; } });
  const { window } = dom;
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const key = k => doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:k, bubbles:true}));
  const shown = id => !doc.getElementById(id).hidden;

  // Running only, Mon/Tue/Wed/Thu/Sat.
  go('adjust'); await wait(10);
  for(let i=0;i<4;i++) key('ArrowLeft');
  for(let pass=0; pass<2; pass++) for(let d=0; d<7; d++){
    const chip = doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`);
    const want = [0,1,2,3,5].includes(d);
    if(chip.classList.contains('sel')!==want && (pass===0 ? !want : want)) chip.click();
  }
  await wait(10);
  const chips = () => [...doc.querySelectorAll('#adjHardRunChips [data-hard-day]')].map(c=> c.textContent + (c.classList.contains('sel') ? '*' : ''));
  check('Adjust has "Faster run day": Auto, then each training day', shown('adjHardRunSection') && chips().join(',')==='Auto*,MON,TUE,WED,THU,SAT', chips().join(','));
  doc.querySelector('#adjHardRunChips [data-hard-day="1"]').click();
  check('Picking Tuesday selects it, and says what it does', chips().join(',')==='Auto,MON,TUE*,WED,THU,SAT' && /goes on Tuesday/.test(doc.getElementById('adjHardRunNote').textContent), doc.getElementById('adjHardRunNote').textContent);
  // The long run's day too (Thursday), right above it.
  const lchips = () => [...doc.querySelectorAll('#adjLongRunChips [data-long-day]')].map(c=> c.textContent + (c.classList.contains('sel') ? '*' : ''));
  check('Adjust has "Long run day" too: Auto, then each training day', lchips().join(',')==='Auto*,MON,TUE,WED,THU,SAT', lchips().join(','));
  doc.querySelector('#adjLongRunChips [data-long-day="3"]').click();
  check('Picking Thursday for it says so', lchips().includes('THU*') && /long run goes on Thursday/.test(doc.getElementById('adjLongRunNote').textContent), doc.getElementById('adjLongRunNote').textContent);
  doc.getElementById('applyAdjust').click(); await wait(20);

  go('week'); await wait(20);
  const row = (w, d) => (doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`) || {textContent:''}).textContent.replace(/\s+/g,' ');
  check('Next week on Plan: the faster run is on Tuesday', /Tempo|Interval|Fartlek|Hill/.test(row(1,1)) && !/Tempo|Interval|Fartlek|Hill/.test(row(1,0)), `Mon: ${row(1,0)} | Tue: ${row(1,1)}`);
  check('...and the week after too', /Tempo|Interval|Fartlek|Hill/.test(row(2,1)), row(2,1));
  check('...and the long run on Thursday', /Long Run/.test(row(1,3)) && !/Long Run/.test(row(1,5)), `Thu: ${row(1,3)} | Sat: ${row(1,5)}`);

  // Reopening Adjust remembers it; Auto goes back to the plan's own pick.
  go('adjust'); await wait(10);
  check('Reopening Adjust shows Tuesday chosen', chips().includes('TUE*'), chips().join(','));
  // The same day can't be both: choosing Thursday for the faster run takes it off the long run.
  doc.querySelector('#adjHardRunChips [data-hard-day="3"]').click();
  check('One day can\'t be both: Thursday for the faster run puts the long run back on Auto', chips().includes('THU*') && lchips()[0]==='Auto*', chips().join(',')+' / '+lchips().join(','));
  doc.querySelector('#adjHardRunChips [data-hard-day="auto"]').click();
  doc.querySelector('#adjLongRunChips [data-long-day="auto"]').click();
  doc.getElementById('applyAdjust').click(); await wait(20);
  go('week'); await wait(20);
  check('Back to Auto: the plan picks again (Monday here)', /Tempo|Interval|Fartlek|Hill/.test(row(1,0)), row(1,0));

  // Weights only: no runs, no choice.
  go('adjust'); await wait(10);
  for(let i=0;i<4;i++) key('ArrowRight');
  await wait(10);
  check('Weights only: no "Faster run day"', !shown('adjHardRunSection'));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
