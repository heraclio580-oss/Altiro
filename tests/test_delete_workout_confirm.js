const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Every workout -- the plan's own, one the user created, an added or a logged one -- has a Delete
// workout button, and every delete asks "Delete this workout?" first.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const flat = el => el.textContent.replace(/\s+/g,' ').trim();

(async () => {
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('home');
  await wait(20);
  const title = flat(doc.querySelector('#sessionCard .title'));
  check('(set-up) today has a plan workout', !/Rest/.test(title), title);
  const del = doc.getElementById('deleteTodayWorkoutBtn');
  check('Home has a Delete workout button for today\'s workout', del && /Delete workout/.test(del.textContent));
  del.click();
  await wait(10);
  const ov = doc.getElementById('confirmDeleteOverlay');
  check('It asks first: "Delete this workout?"', !ov.hidden && /Delete this workout\?/.test(flat(ov)) && flat(doc.getElementById('confirmDeleteSub')).includes('from today'), flat(doc.getElementById('confirmDeleteSub')));
  doc.getElementById('confirmDeleteCancel').click();
  await wait(10);
  check('Cancel keeps it', ov.hidden && flat(doc.querySelector('#sessionCard .title'))===title);
  doc.getElementById('deleteTodayWorkoutBtn').click();
  await wait(10);
  doc.getElementById('confirmDeleteOk').click();
  await wait(20);
  check('Delete workout removes it: today is a rest day', /Rest Day/.test(flat(doc.querySelector('#sessionCard .title'))) && !doc.getElementById('deleteTodayWorkoutBtn'), flat(doc.querySelector('#sessionCard .title')));
  check('...with a toast', /Workout deleted/.test(doc.getElementById('toastMsg').textContent));

  // A future day's workout, from its day details.
  go('week');
  await wait(20);
  const row = doc.querySelector('.plan-row[data-week-idx="1"][data-day="0"]');
  const monTitle = row.querySelector('.prow-title').textContent;
  go('calendar');
  await wait(20);
  doc.querySelector('#calGrid .mo-cell[data-date="2026-09-21"]').click();
  await wait(20);
  const ddDel = doc.getElementById('ddDeleteWorkoutBtn');
  check('A day\'s details have Delete workout too', !!ddDel && /Delete workout/.test(ddDel.textContent));
  ddDel.click();
  await wait(10);
  check('...asking first, naming the workout and the day', !ov.hidden && flat(doc.getElementById('confirmDeleteSub'))===`${monTitle} will be removed from Monday, Sep 21.`, flat(doc.getElementById('confirmDeleteSub')));
  doc.getElementById('confirmDeleteOk').click();
  await wait(20);
  check('...and the day becomes a rest day', flat(doc.getElementById('dayDetailPlanRow'))==='Rest Day', flat(doc.getElementById('dayDetailPlanRow')));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
