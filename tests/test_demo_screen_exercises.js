const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// "Watch demo" on a lifting day lists the day's exercises, each opening its picture or steps, instead of
// the stand-in player; a run day keeps the run's screen.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

(async () => {
  let lift = null, run = null;
  for(let d = 14; d <= 20 && !(lift && run); d++){
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = `2026-09-${d}`; } });
    await wait(40);
    const doc = dom.window.document;
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(20);
    if(!doc.getElementById('watchDemoBtn')) continue;
    if(doc.querySelector('#sessionCard [data-lift-key]')){ if(!lift) lift = doc; }
    else if(doc.getElementById('trackRunBtn') && !doc.getElementById('trackRunBtn').closest('[hidden]')){ if(!run) run = doc; }
  }
  check('(found a lifting day and a run day)', !!lift && !!run);
  {
    const doc = lift;
    doc.getElementById('watchDemoBtn').click();
    await wait(20);
    const list = doc.getElementById('demoExercises'), rows = [...list.querySelectorAll('.demo-ex-row')];
    const planned = doc.querySelectorAll('#sessionCard [data-lift-key]').length;
    check('Lifting day: "Watch demo" lists the day\'s exercises', !doc.getElementById('screen-exercise-detail').hidden && !list.hidden && rows.length>0 && rows.length<=planned, `${rows.length} of ${planned}`);
    check('...instead of the stand-in player', doc.getElementById('demoPlayer').hidden && doc.getElementById('demoPlaceholderNote').hidden);
    check('...no button inside a button', !list.querySelector('.demo-ex-row button'));
    rows[0].click();
    await wait(20);
    check('Tapping one opens how to do it', !doc.getElementById('moveDemoOverlay').hidden && doc.querySelectorAll('#mdCues li').length>=3);
    doc.getElementById('closeMoveDemo').click();
  }
  {
    const doc = run;
    doc.getElementById('watchDemoBtn').click();
    await wait(20);
    check('Run day: the run\'s screen as before', doc.getElementById('demoExercises').hidden && !doc.getElementById('demoPlayer').hidden);
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
