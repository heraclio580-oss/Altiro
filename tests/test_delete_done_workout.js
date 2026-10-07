const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Taking a finished workout off a rest day leaves a plain, not-done rest day -- not "Completed today"
// next to nothing, and not the deleted workout still scheduled.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const TODAY = '2026-09-19'; // a Saturday: a rest day in the default plan

async function app(){
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = TODAY; } });
  await wait(60);
  const doc = dom.window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  return doc;
}
const flat = el => el.textContent.replace(/\s+/g,' ').trim();
const openToday = async doc => { doc.querySelector('#weekStrip .day-cell.today').click(); await wait(20); };

(async () => {
  // 1. Planned on the rest day, recorded, then taken off with "Reset to Suggested Plan".
  {
    const doc = await app();
    doc.getElementById('addTodayWorkoutBtn').click();
    await wait(20);
    doc.getElementById('manualNameInput').value = 'Chest/back';
    doc.querySelector('#createExercisesList .ex-name').value = 'Bench Press';
    doc.getElementById('saveManualEntry').click();
    await wait(30);
    doc.getElementById('recordBtn').click();
    await wait(950);
    doc.getElementById('saveLogPerf').click();
    await wait(60);
    [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(20);
    await openToday(doc);
    check('(set-up) the recorded workout shows as completed', /Completed today/.test(flat(doc.getElementById('dayDetailActions'))) && /Chest\/back/.test(flat(doc.getElementById('dayDetailPlanRow'))), flat(doc.getElementById('dayDetailActions')));
    doc.getElementById('ddResetPlanBtn').click();
    await wait(20);
    check('After taking it off, the day is a plain rest day again', flat(doc.getElementById('dayDetailPlanRow'))==='Rest Day', flat(doc.getElementById('dayDetailPlanRow')));
    check('...not marked "Completed today"', !/Completed today/.test(flat(doc.getElementById('dayDetailActions'))), flat(doc.getElementById('dayDetailActions')));
    doc.getElementById('closeDayDetail').click();
    await wait(10);
    check('...and Home is back to its rest-day card', /Rest Day/.test(flat(doc.getElementById('sessionCard'))) && !/Completed/.test(flat(doc.getElementById('sessionCard'))), flat(doc.getElementById('sessionCard')).slice(0,100));
  }
  // 2. Logged as already done on the rest day, then deleted.
  {
    const doc = await app();
    doc.getElementById('addTodayWorkoutBtn').click();
    await wait(20);
    doc.getElementById('manualNameInput').value = 'Morning lift';
    doc.getElementById('createCompletedToggle').click();
    doc.getElementById('saveManualEntry').click();
    await wait(30);
    await openToday(doc);
    check('(set-up) the logged workout became the day\'s workout', /Morning lift/.test(flat(doc.getElementById('dayDetailPlanRow'))), flat(doc.getElementById('dayDetailPlanRow')));
    doc.querySelector('#dayDetailOverlay [data-del]').click();
    await wait(10);
    doc.getElementById('confirmDeleteOk').click();
    await wait(30);
    check('Deleting it puts the rest day back (not the deleted workout as scheduled)', flat(doc.getElementById('dayDetailPlanRow'))==='Rest Day', flat(doc.getElementById('dayDetailPlanRow')));
    check('...and nothing says it was completed', !/Completed today/.test(flat(doc.getElementById('dayDetailActions'))), flat(doc.getElementById('dayDetailActions')));
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
