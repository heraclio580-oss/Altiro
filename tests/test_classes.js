const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Classes: set up once from Create Workout (Class -> which class, days, time, length, every week), they
// show on those days next to the plan, and doing one is timed by the workout clock and counts as a
// workout -- without touching the day's own planned workout.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

(async () => {
  // Today is Friday, Sep 18.
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  const w = dom.window, doc = w.document;
  await wait(50);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const click = async sel => { doc.querySelector(sel).click(); await wait(20); };
  const text = el => (el ? el.textContent : '').replace(/\s+/g,' ').trim();
  // A day on the calendar, moving to its month first.
  const openCalDay = async key => {
    for(let i=0; i<4 && !doc.querySelector(`.mo-cell[data-date="${key}"]`); i++){
      const shown = doc.querySelector('.mo-cell[data-date]').getAttribute('data-date');
      doc.getElementById(key < shown ? 'calPrev' : 'calNext').click(); await wait(20);
    }
    doc.querySelector(`.mo-cell[data-date="${key}"]`).click(); await wait(20);
  };
  const classRows = sel => [...doc.querySelectorAll(sel+' .class-entry')].map(text);
  go('home'); await wait(20);
  const planned = text(doc.querySelector('#sessionCard .title'));

  // ---- set one up: Jiu-Jitsu, Fridays at 3 PM, 1h 30m ----
  await click('#addTodayWorkoutBtn');
  await click('#manualTypeRow [data-type="class"]');
  check('Create Workout has a Class type with its own form', !doc.getElementById('createClassSection').hidden && doc.getElementById('manualVolumeSection').hidden && doc.getElementById('createCompletedSection').hidden);
  const opts = [...doc.querySelectorAll('#classKindSelect option')].map(o=>o.textContent);
  check('...a list of classes to pick from', ['Spin Class','Pilates','Yoga','Jiu-Jitsu','Wrestling','Rock Climbing','Other'].every(o=>opts.includes(o)), opts.join(', '));
  const sel = doc.getElementById('classKindSelect');
  sel.value = 'jiujitsu'; sel.dispatchEvent(new w.Event('change', {bubbles:true}));
  check('...picking one names it', doc.getElementById('manualNameInput').value==='Jiu-Jitsu');
  const selDays = [...doc.querySelectorAll('#classDaysRow .chip.sel')].map(c=>c.textContent).join();
  check('...on the day it was opened for (Friday)', /^fri$/i.test(selDays), selDays);
  doc.getElementById('classTimeInput').value = '15:00';
  doc.getElementById('classLenHInput').value = '1';
  doc.getElementById('classLenMInput').value = '30';
  check('...repeating every week', doc.getElementById('classRepeatToggle').classList.contains('on'));
  await click('#saveManualEntry');

  check('Today: the class shows under Classes, with its time and a Start button', classRows('#homeClassesWrap').length===1 && /Jiu-Jitsu\s*3:00 PM · 1h 30m\s*Start class/.test(classRows('#homeClassesWrap')[0]), classRows('#homeClassesWrap').join(' | '));
  check('...next to today\'s planned workout, which stays the day\'s workout', text(doc.querySelector('#sessionCard .title'))===planned);
  check('...and not doubled under Additional Workouts', !doc.getElementById('homeExtraWorkoutsWrap'));

  // ---- every Friday after ----
  go('calendar'); await wait(20);
  await openCalDay('2026-09-25');
  check('Next Friday has it too', !doc.getElementById('dayDetailClassSection').hidden && /Jiu-Jitsu/.test(classRows('#dayDetailClasses')[0]||''));
  check('...with nothing to start yet (it\'s in the future)', !doc.querySelector('#dayDetailClasses [data-class-start]'));
  await click('#dayDetailClasses [data-class-skip]');
  check('The trash on a weekly class asks: just this day, or every week', /Remove Jiu-Jitsu/.test(text(doc.querySelector('.class-remove-chooser'))) && !!doc.querySelector('[data-class-remove-scope="all"]'));
  await click('[data-class-remove-cancel]');
  check('...Cancel keeps it', !doc.querySelector('.class-remove-chooser') && classRows('#dayDetailClasses').length===1);
  await click('#dayDetailClasses [data-class-skip]');
  await click('[data-class-remove-scope="day"]');
  check('Just this day takes it off that Friday only', doc.getElementById('dayDetailClassSection').hidden);
  await click('#closeDayDetail');
  await openCalDay('2026-10-02');
  check('...the Friday after still has it', /Jiu-Jitsu/.test(classRows('#dayDetailClasses')[0]||''));
  await click('#closeDayDetail');
  await openCalDay('2026-09-17');
  check('A Thursday doesn\'t', doc.getElementById('dayDetailClassSection').hidden);
  await click('#closeDayDetail');

  // ---- doing it: the clock runs through class ----
  go('home'); await wait(20);
  await click('#homeClassesWrap [data-class-start]');
  check('Start class opens the workout clock', !doc.getElementById('logPerfOverlay').hidden && !doc.getElementById('logPerfTimeSection').hidden && !doc.getElementById('logPerfTimeNote').hidden);
  check('...the clock\'s start is kept in case the app closes mid-class', !!w.localStorage.getItem('altiro_workout_start'));
  const realNow = w.Date.now.bind(w.Date);
  w.Date.now = () => realNow() + 85*60*1000;
  await wait(1100);
  check('...and counts the time in class', doc.getElementById('logPerfTimeHInput').value==='1' && doc.getElementById('logPerfTimeMInput').value==='25', doc.getElementById('logPerfTimeHInput').value+':'+doc.getElementById('logPerfTimeMInput').value);
  await click('#saveLogPerf');
  w.Date.now = realNow;
  if(!doc.getElementById('reviewOverlay')?.hidden) await click('#submitReviewBtn');
  go('home'); await wait(20);
  check('Done: the class shows its time', /Jiu-Jitsu.*Done · 1h 25m/.test(classRows('#homeClassesWrap')[0]||''), classRows('#homeClassesWrap')[0]);
  check('...today\'s planned workout is still to do', !doc.getElementById('recordBtn').classList.contains('done'));
  go('progress'); await wait(20);
  doc.querySelector('[data-act-day="2026-09-18"]')?.click(); await wait(10);
  const act = text(doc.querySelector('#progActivity .act-detail'));
  check('...and Progress counts its 85 minutes for today', /1h 25m|85 min/.test(act) && /Jiu-Jitsu/.test(act), act);

  // ---- just once, on a past day ----
  go('calendar'); await wait(20);
  await openCalDay('2026-09-16');
  await click('#addWorkoutBtn');
  await click('#manualTypeRow [data-type="class"]');
  sel.value = 'yoga'; sel.dispatchEvent(new w.Event('change', {bubbles:true}));
  doc.getElementById('classTimeInput').value = '07:00';
  await click('#classRepeatToggle');
  await click('#saveManualEntry');
  check('A one-time class on a past day is filed as done, with its length', /Yoga\s*7:00 AM · 1h.*Done · 1h/.test(classRows('#dayDetailClasses')[0]||''), classRows('#dayDetailClasses').join(' | '));
  await click('#closeDayDetail');
  await openCalDay('2026-09-23');
  check('...and isn\'t on the next Wednesday', doc.getElementById('dayDetailClassSection').hidden);
  await click('#closeDayDetail');

  // ---- My classes ----
  go('settings'); await wait(20);
  const mine = [...doc.querySelectorAll('#myClassesList .manual-entry')].map(text);
  check('Settings lists the weekly class', mine.length===1 && /Jiu-Jitsu\s*Every Fri · 3:00 PM · 1h 30m/.test(mine[0]), mine.join(' | '));
  await click('#myClassesList [data-remove-class]');
  check('...and removing it there takes it off the schedule', /No classes yet/.test(text(doc.getElementById('myClassesList'))));
  go('calendar'); await wait(20);
  await openCalDay('2026-10-02');
  check('...every Friday', doc.getElementById('dayDetailClassSection').hidden);
  await click('#closeDayDetail');

  // ---- a whole class off the calendar in one go (a membership cancelled) ----
  go('home'); await wait(20);
  await click('#addTodayWorkoutBtn');
  await click('#manualTypeRow [data-type="class"]');
  sel.value = 'pilates'; sel.dispatchEvent(new w.Event('change', {bubbles:true}));
  [...doc.querySelectorAll('#classDaysRow .chip')].filter(c=>/^(mon|wed)$/i.test(c.textContent)).forEach(c=>c.click());
  await click('#saveManualEntry');
  go('calendar'); await wait(20);
  await openCalDay('2026-09-28');
  check('(set-up) Pilates is on Mondays', /Pilates/.test(classRows('#dayDetailClasses')[0]||''));
  await click('#dayDetailClasses [data-class-skip]');
  await click('[data-class-remove-scope="all"]');
  check('Every week takes it off that day...', doc.getElementById('dayDetailClassSection').hidden);
  await click('#closeDayDetail');
  const pilatesLeft = [];
  for(const k of ['2026-09-18','2026-09-30','2026-10-05','2026-10-09']){ await openCalDay(k); if(classRows('#dayDetailClasses').some(r=>/Pilates/.test(r))) pilatesLeft.push(k); await click('#closeDayDetail'); }
  check('...and off every other day it was on', !pilatesLeft.length, pilatesLeft.join(', '));
  go('settings'); await wait(20);
  check('...and out of My classes', !/Pilates/.test(text(doc.getElementById('myClassesList'))));

  // ---- in Spanish ----
  go('settings'); await wait(10);
  doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
  go('home'); await wait(20);
  await click('#addTodayWorkoutBtn');
  await click('#manualTypeRow [data-type="class"]');
  sel.value = 'wrestling'; sel.dispatchEvent(new w.Event('change', {bubbles:true}));
  check('In Spanish, the classes are named in Spanish', doc.getElementById('manualNameInput').value==='Lucha' && [...doc.querySelectorAll('#classKindSelect option')].some(o=>o.textContent==='Escalada'));
  await click('#saveManualEntry');
  check('...and so is the class on Home (after today\'s 3 PM one, by time)', /Lucha\s*18:00 · 1h\s*Empezar clase/.test(classRows('#homeClassesWrap')[1]||''), classRows('#homeClassesWrap').join(' | '));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
