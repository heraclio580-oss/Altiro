const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The Today card keeps one or two actions up front -- GPS on a run day, the demo on a lifting day, adding a
// workout on a rest day -- and the rest under More. Other workouts done today are one "Also today" list.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const visible = el => !!el && !el.closest('[hidden]');

async function openOn(day){
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = day; } });
  await wait(50);
  const doc = dom.window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  return {dom, doc};
}

(async () => {
  // Find a run day, a lifting day and a rest day in the default plan's first week.
  const days = {};
  for(let d = 14; d <= 20; d++){
    const day = `2026-09-${d}`, {doc} = await openOn(day);
    const t = (doc.querySelector('#sessionCard .title')||{}).textContent || '';
    const kind = /rest/i.test(t) ? 'rest' : doc.getElementById('trackRunBtn') && visible(doc.getElementById('trackRunBtn')) ? 'run' : 'other';
    if(!days[kind]) days[kind] = day;
  }
  check('(found a run day, another workout day and a rest day)', days.run && days.other && days.rest, JSON.stringify(days));

  {
    const {doc} = await openOn(days.run);
    const front = [...doc.querySelectorAll('#sessionCard .card-actions button')].map(b=>b.id);
    check('Run day: GPS up front, then More -- nothing else', front.join(',')==='trackRunBtn,homeMoreBtn', front.join(','));
    check('...the rest is tucked away', doc.getElementById('homeMorePanel').hidden && !visible(doc.getElementById('deleteTodayWorkoutBtn')) && !visible(doc.getElementById('addTodayWorkoutBtn')));
    doc.getElementById('homeMoreBtn').click();
    await wait(10);
    const more = [...doc.querySelectorAll('#homeMorePanel > *')].map(e=> e.id || (e.querySelector('.toggle')||{}).id);
    check('More opens: demo, add a workout, mark as done, delete (last)', !doc.getElementById('homeMorePanel').hidden && more.join(',')==='watchDemoBtn,addTodayWorkoutBtn,homeCompleteToggle,deleteTodayWorkoutBtn', more.join(','));
    check('...and says it\'s open', doc.getElementById('homeMoreBtn').getAttribute('aria-expanded')==='true');
    doc.getElementById('homeCompleteToggle').click();
    await wait(20);
    check('Marking it done keeps More open (the switch shows on)', !doc.getElementById('homeMorePanel').hidden && doc.getElementById('homeCompleteToggle').classList.contains('on'));
    doc.getElementById('homeMoreBtn').click();
    await wait(10);
    check('Tapping More again closes it', doc.getElementById('homeMorePanel').hidden);
    check('Nothing else done today: no "Also today" list', doc.getElementById('homeAlsoToday').hidden);
  }
  {
    const {doc} = await openOn(days.other);
    const front = [...doc.querySelectorAll('#sessionCard .card-actions button')].map(b=>b.id);
    check('Workout day: the demo up front, then More', front.join(',')==='watchDemoBtn,homeMoreBtn', front.join(','));
    // Add another workout from More: it's listed under "Also today".
    doc.getElementById('homeMoreBtn').click();
    doc.getElementById('addTodayWorkoutBtn').click();
    await wait(20);
    check('Choosing an action closes More', doc.getElementById('homeMorePanel').hidden);
    doc.getElementById('manualNameInput').value = 'Evening Walk';
    doc.getElementById('manualNameInput').dispatchEvent(new doc.defaultView.Event('input', {bubbles:true}));
    [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
    doc.getElementById('saveManualEntry').click();
    await wait(30);
    const also = doc.getElementById('homeAlsoToday');
    check('Another workout today shows under one "Also today" list', !also.hidden && /Also today/.test(also.textContent) && /Evening Walk/.test(also.textContent) && !/Additional Workouts|Logged Workouts/.test(doc.getElementById('sessionCard').textContent), also.textContent.replace(/\s+/g,' ').slice(0,80));
  }
  {
    const {doc} = await openOn(days.rest);
    const front = [...doc.querySelectorAll('#sessionCard .card-actions button')].map(b=>b.id);
    check('Rest day: adding a workout up front, then More (with GPS)', front.join(',')==='addTodayWorkoutBtn,homeMoreBtn' && !!doc.querySelector('#homeMorePanel #trackRunBtn') && !doc.getElementById('deleteTodayWorkoutBtn'), front.join(','));
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
