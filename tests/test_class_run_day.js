const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A runner picked Sunday for the long run, but a hard class saved for Sundays by mistake kept moving it to
// Thursday -- and nothing said why. Now: adding (or removing) a class that moves the long run or faster
// run says so, with Undo; Adjust says where the run goes instead, and asks whether to put it on the class
// day anyway; and the calendar marks days with a class.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

(async () => {
  // Today is Sunday, Nov 1; next week is Nov 2-8.
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-11-01'; w.__ALTIRO_UNDO_MS__ = 60000; } });
  const w = dom.window, doc = w.document;
  await wait(50);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const click = async sel => { doc.querySelector(sel).click(); await wait(20); };
  const text = el => (el ? el.textContent : '').replace(/\s+/g,' ').trim();
  const toast = () => doc.getElementById('toastMsg').textContent;
  const cell = async key => {
    go('calendar'); await wait(20);
    for(let i=0; i<4 && !doc.querySelector(`.mo-cell[data-date="${key}"]`); i++){
      const shown = doc.querySelector('.mo-cell[data-date]').getAttribute('data-date');
      doc.getElementById(key < shown ? 'calPrev' : 'calNext').click(); await wait(20);
    }
    return doc.querySelector(`.mo-cell[data-date="${key}"]`);
  };
  const longOn = async key => /Long/.test(text((await cell(key)).querySelector('.mo-desc-t')));
  const longNote = () => text(doc.getElementById('adjLongRunNote'));
  const SUN = '2026-11-08';
  const openAdjust = async () => { go('adjust'); await wait(20); };

  go('home'); await wait(20);
  check('Today\'s date line has today\'s month (a week that began in October)', text(doc.getElementById('homeDateLine'))==='Sunday, Nov 1', text(doc.getElementById('homeDateLine')));
  // Running only, Mon-Thu and Sunday, the long run on Sunday.
  await openAdjust();
  for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
  for(let pass=0; pass<2; pass++) for(let d=0; d<7; d++){
    const chip = doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`);
    const want = [0,1,2,3,6].includes(d);
    if(chip.classList.contains('sel')!==want && (pass===0 ? !want : want)) chip.click();
  }
  await wait(10);
  doc.querySelector('#adjLongRunChips [data-long-day="6"]').click();
  check('Long run day Sunday: no class that day, so just the usual note', /Your long run goes on Sunday/.test(longNote()), longNote());
  await click('#applyAdjust');
  check('(set-up) next Sunday is the long run', await longOn(SUN));

  // ---- A hard class added on Sundays: the toast says what it moved, with Undo ----
  const addBasketball = async () => {
    go('home'); await wait(20);
    await click('#addTodayWorkoutBtn');
    await click('#manualTypeRow [data-type="class"]');
    const sel = doc.getElementById('classKindSelect');
    sel.value = 'basketball'; sel.dispatchEvent(new w.Event('change', {bubbles:true}));
    const days = [...doc.querySelectorAll('#classDaysRow .chip.sel')].map(c=> c.textContent.trim()).join();
    if(!/sun/i.test(days)) [...doc.querySelectorAll('#classDaysRow .chip')].find(c=> /sun/i.test(c.textContent)).click();
    doc.getElementById('classTimeInput').value = '10:00';
    await click('#saveManualEntry');
  };
  await addBasketball();
  check('Adding Basketball on Sundays says it moved the long run, and where', /^Basketball on Sundays: your long run moved to \w+day( and your faster run moved to \w+day)?\.$/.test(toast()), toast());
  check('...with Undo', !doc.getElementById('toastUndo').hidden);
  check('...and the long run is off Sunday now', !(await longOn(SUN)));
  check('The calendar marks Sunday\'s class with an icon', !!(await cell(SUN)).querySelector('.mo-class svg'));
  doc.getElementById('toastUndo').click(); await wait(20);
  check('Undo: the class is gone, and the long run is back on Sunday', /Undone/.test(toast()) && await longOn(SUN) && !(await cell(SUN)).querySelector('.mo-class'), toast());

  // ---- Adjust says where the long run goes instead, and asks ----
  await addBasketball();
  await openAdjust();
  check('Adjust says the class moves the long run, and where to', /^You have Basketball on Sundays, a hard class, so your long run goes on \w+day instead\.$/.test(longNote()), longNote());
  doc.querySelector('#adjLongRunChips [data-long-day="auto"]').click();
  doc.querySelector('#adjLongRunChips [data-long-day="6"]').click();
  check('Picking Sunday again asks: put the long run there anyway?', /Put your long run there anyway\?/.test(longNote()) && /Yes, Sunday/.test(longNote()), longNote());
  doc.querySelector('#adjLongRunNote [data-run-day-no]').click();
  check('No: back to saying where it goes instead', /goes on \w+day instead/.test(longNote()), longNote());
  doc.querySelector('#adjLongRunChips [data-long-day="auto"]').click();
  doc.querySelector('#adjLongRunChips [data-long-day="6"]').click();
  doc.querySelector('#adjLongRunNote [data-run-day-yes]').click();
  check('Yes: on Sunday, with the class', /^Your long run goes on Sunday, along with your Basketball class\.$/.test(longNote()), longNote());
  await click('#applyAdjust');
  check('Applied: the long run is on Sunday, class and all', await longOn(SUN) && !!(await cell(SUN)).querySelector('.mo-class'));
  await openAdjust();
  check('Adjust remembers it', /along with your Basketball class/.test(longNote()), longNote());
  doc.getElementById('adjustSheetClose') ? doc.getElementById('adjustSheetClose').click() : null;

  // In Spanish.
  doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
  await openAdjust();
  check('In Spanish', /junto con tu clase de/.test(longNote()), longNote());

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
