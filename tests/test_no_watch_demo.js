const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// No "Watch demo" on a day's workout -- on Today's card, under its More, or in the day's own view: each
// exercise in a workout has its own picture or steps, right beside it.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const demoText = el => /Watch demo/i.test(el ? el.textContent : '');

(async () => {
  let checkedLift = false, checkedRun = false;
  for(let d = 14; d <= 20; d++){
    const day = `2026-09-${d}`;
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = day; } });
    await wait(40);
    const doc = dom.window.document;
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(20);
    const card = doc.getElementById('sessionCard');
    if(/rest/i.test((card.querySelector('.title') || {}).textContent || '')){ dom.window.close(); continue; }
    const lift = !!card.querySelector('[data-lift-key]');
    check(`${day} (${lift ? 'lifting' : 'run'} day): no "Watch demo" on Today's card or under More`, !doc.getElementById('watchDemoBtn') && !demoText(card) && !demoText(doc.getElementById('homeMorePanel')));
    doc.querySelector(`#weekStrip [data-date="${day}"]`).click();
    await wait(30);
    check('...nor in the day\'s own view', !doc.getElementById('ddWatchDemoBtn') && !demoText(doc.getElementById('dayDetailOverlay')));
    doc.getElementById('closeDayDetail').click();
    if(lift && !checkedLift){
      // Its exercises still show how they're done, each on its own.
      doc.getElementById('changeExercisesBtn').click();
      await wait(40);
      const rows = doc.querySelectorAll('#wpExerciseList .wp-ex'), demos = doc.querySelectorAll('#wpExerciseList .wp-ex .ex-demo-btn');
      check('A lifting day\'s exercises each still have their own demo or steps', rows.length>0 && demos.length===rows.length, `${demos.length} of ${rows.length}`);
      checkedLift = true;
    }
    if(!lift) checkedRun = true;
    dom.window.close();
  }
  check('(checked a lifting day and a run day)', checkedLift && checkedRun);
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
