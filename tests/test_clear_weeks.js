const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The way back from Repeat: "Clear" on a week in Plan takes the workouts the user planned or repeated
// off that week, or that week and every week after. Each day goes back to Altiro's plan; anything done
// or logged stays.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function click(el){ el.dispatchEvent(new window.Event('click', {bubbles:true, cancelable:true})); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

(async () => {
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const row = (w, d) => doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`);
  const title = (w, d) => row(w, d).querySelector('.prow-title').textContent;
  async function addWorkout(w, d, name){
    click(row(w, d).querySelector('.prow-add'));
    await wait(10);
    doc.getElementById('manualNameInput').value = name;
    click(doc.getElementById('saveManualEntry'));
    await wait(20);
  }
  go('week');
  await wait(20);
  const planTitle = title(2, 0); // what Altiro's plan has on Mon Sep 28
  // Today (Fri Sep 18): their own workout, done.
  await addWorkout(0, 4, 'Friday Lift');
  // Next week: Push (+ a finisher) and Pull, repeated for 4 weeks with rest days in between.
  await addWorkout(1, 0, 'Push Day');
  await addWorkout(1, 0, 'Core Finisher');
  await addWorkout(1, 2, 'Pull Day');
  click(doc.querySelector('[data-repeat-week="1"]'));
  await wait(10);
  [...doc.querySelectorAll('#repeatOtherChips .chip')].find(c=>c.textContent==='Make them rest days').click();
  click(doc.getElementById('applyRepeatBtn'));
  await wait(30);
  go('home');
  await wait(20);
  doc.getElementById('homeCompleteToggle').click();
  await wait(10);
  go('week');
  await wait(20);
  check('(set-up) repeated into weeks 2-5', title(2,0)==='Push Day' && title(3,2)==='Pull Day' && title(3,1)==='Rest Day', [title(2,0), title(3,2), title(3,1)].join(','));

  check('Weeks with planned workouts get a Clear button', !!doc.querySelector('[data-clear-week="2"]') && doc.querySelector('[data-clear-week="2"]').getAttribute('aria-label')==='Clear planned workouts');
  check('...not this week, where the only one is already done', !doc.querySelector('[data-clear-week="0"]'));

  click(doc.querySelector('[data-clear-week="2"]'));
  await wait(10);
  const ov = doc.getElementById('clearWeeksOverlay');
  const chips = [...doc.querySelectorAll('#clearScopeChips .chip')].map(c=>c.textContent);
  check('The sheet offers just this week (picked) or this week and every week after', !ov.hidden && /^Just this week \(Sep 28 – Oct 4\)$/.test(chips[0]) && chips[1]==='This week and every week after' && /Just this week/.test(doc.querySelector('#clearScopeChips .chip.sel').textContent), chips.join(' | '));
  check('...and says what it will clear', /7 days will be cleared, Sep 28 to Oct 4\./.test(doc.getElementById('clearNote').textContent), doc.getElementById('clearNote').textContent);
  click(doc.getElementById('applyClearBtn'));
  await wait(30);
  check('Clearing one week puts it back to Altiro\'s plan', ov.hidden && title(2,0)===planTitle && !/Push Day|Pull Day/.test(doc.querySelector('.plan-row[data-week-idx="2"][data-day="2"]').textContent), title(2,0)+' vs '+planTitle);
  check('...its Additional Workouts go too', !/Core Finisher/.test(row(2,0).textContent));
  check('...other weeks keep theirs', title(1,0)==='Push Day' && title(3,0)==='Push Day' && title(3,2)==='Pull Day');
  check('...with a toast', /Cleared 7 days/.test(doc.getElementById('toastMsg').textContent), doc.getElementById('toastMsg').textContent);

  click(doc.querySelector('[data-clear-week="3"]'));
  await wait(10);
  [...doc.querySelectorAll('#clearScopeChips .chip')].find(c=>/every week after/.test(c.textContent)).click();
  await wait(5);
  check('"Every week after" covers the rest of the repeats', /21 days will be cleared, Oct 5 to Oct 25\./.test(doc.getElementById('clearNote').textContent), doc.getElementById('clearNote').textContent);
  click(doc.getElementById('applyClearBtn'));
  await wait(30);
  check('...and clears them all', ![3].some(w=>[0,1,2,3,4,5,6].some(d=>/Push Day|Pull Day|Core Finisher/.test(row(w,d).textContent))));
  check('...leaving the week before it alone', title(1,0)==='Push Day' && title(1,2)==='Pull Day');
  click(doc.querySelector('[data-clear-week="1"]'));
  await wait(10);
  [...doc.querySelectorAll('#clearScopeChips .chip')].find(c=>/every week after/.test(c.textContent)).click();
  await wait(5);
  check('...including the weeks further out (only the source week is left to clear)', /2 days will be cleared, Sep 21 to Sep 23\./.test(doc.getElementById('clearNote').textContent), doc.getElementById('clearNote').textContent);
  click(doc.getElementById('closeClearWeeks'));
  check('Today\'s done workout was never touched', title(0,4)==='Friday Lift');

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
