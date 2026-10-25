const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Court sports in the class list: basketball and handball count as hard classes (no long run or fast
// run alongside them), racquetball as hard on the legs, and padel and pickleball don't change the plan.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const text = el => (el ? el.textContent : '').replace(/\s+/g,' ').trim();

// Today is Friday Sep 18, a long run day: add a weekly class of `kind` today, and see today's workout.
async function withClassToday(kind){
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  const w = dom.window, doc = w.document;
  await wait(50);
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click(); await wait(20);
  const before = text(doc.querySelector('#sessionCard .title'));
  doc.getElementById('addTodayWorkoutBtn').click(); await wait(20);
  doc.querySelector('#manualTypeRow [data-type="class"]').click(); await wait(20);
  const opts = [...doc.querySelectorAll('#classKindSelect option')].map(o=> o.textContent);
  const sel = doc.getElementById('classKindSelect');
  sel.value = kind; sel.dispatchEvent(new w.Event('change', {bubbles:true}));
  const name = doc.getElementById('manualNameInput').value;
  doc.getElementById('classTimeInput').value = '18:00';
  doc.getElementById('classLenHInput').value = '1';
  doc.getElementById('saveManualEntry').click(); await wait(30);
  const after = text(doc.querySelector('#sessionCard .title'));
  const classes = [...doc.querySelectorAll('#homeClassesWrap .class-entry')].map(text);
  dom.window.close();
  return {before, after, opts, name, classes};
}

(async () => {
  const b = await withClassToday('basketball');
  check('The class list has the court sports', ['Basketball','Handball','Racquetball','Padel','Pickleball'].every(o=> b.opts.includes(o)), b.opts.join(', '));
  check('...before "Other", which stays last', b.opts[b.opts.length-1]==='Other');
  check('Picking Basketball names it and shows it today', b.name==='Basketball' && /Basketball/.test(b.classes[0]||''), `${b.name} / ${b.classes.join(' | ')}`);
  check('(set-up) today was a long run', /Long Run/.test(b.before), b.before);
  check('Basketball is a hard class: no long run alongside it', !/Long Run|Tempo|Interval/.test(b.after) && b.after!=='Rest Day', `${b.before} -> ${b.after}`);
  const h = await withClassToday('handball');
  check('Handball too', !/Long Run|Tempo|Interval/.test(h.after), h.after);
  const p = await withClassToday('pickleball');
  check("Pickleball doesn't change the plan: today's long run stays", p.after===p.before && /Pickleball/.test(p.classes[0]||''), `${p.before} -> ${p.after}`);
  const pd = await withClassToday('padel');
  check('...nor does padel', pd.after===pd.before, pd.after);
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
