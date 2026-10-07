const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Supersets in Create Workout: "Superset with above" links an exercise to the one before it. Linked
// exercises show as A1 / A2 wherever the workout is listed, and while logging, a set of A1 leads
// straight to A2 with no rest -- the rest comes after the round.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const items = () => [...doc.querySelectorAll('#createExercisesList .exercise-edit-item')];
  const fill = (item, name, sets, reps) => { item.querySelector('.ex-name').value = name; item.querySelector('.ex-sets').value = sets; item.querySelector('.ex-reps').value = reps; };

  goPill('home');
  await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  const links = items().map(it=> it.querySelector('.ss-link'));
  check('Every row has a "Superset with above" toggle (hidden on the first)', links.length===3 && links.every(Boolean) && /Superset with above/.test(links[1].textContent));
  doc.getElementById('manualNameInput').value = 'Upper';
  fill(items()[0], 'Bench Press', 2, 8);
  fill(items()[1], 'Seated Row', 2, 10);
  fill(items()[2], 'Lateral Raise', 2, 15);
  items()[1].querySelector('.ss-link').click();
  await wait(5);
  check('Linking row 2 marks rows 1 and 2 as a superset', items()[0].classList.contains('ss-in') && items()[1].classList.contains('ss-in') && !items()[2].classList.contains('ss-in'));
  check('...and the toggle shows it is on', items()[1].querySelector('.ss-link').getAttribute('aria-pressed')==='true');
  doc.getElementById('saveManualEntry').click();
  await wait(30);

  const homeLines = [...doc.querySelectorAll('#homeExtraWorkoutsWrap .r-exercise-list li')].map(li=>li.textContent.replace(/\s+/g,' ').trim());
  check('Home lists them as A1 and A2', /^A1Bench Press/.test(homeLines[0]||'') && /^A2Seated Row/.test(homeLines[1]||'') && /^Lateral Raise/.test(homeLines[2]||''), homeLines.join(' | '));

  doc.querySelector('#homeExtraWorkoutsWrap [data-start-extra]').click();
  await wait(950);
  const head = doc.querySelector('#logPerfExercisesList .ss-head');
  check('Logging shows a Superset A heading', head && /Superset A · one set of each, then rest/.test(head.textContent), head && head.textContent);
  const row = key => doc.querySelector(`#logPerfExercisesList .exercise-log-row[data-exercise-key="${key}"]`);
  const current = () => doc.querySelector('#logPerfExercisesList .exercise-log-row.current-exercise').getAttribute('data-exercise-key');
  const restOn = () => !doc.getElementById('restBar').hidden;
  const tick = (key, i) => row(key).querySelectorAll('.set-check-dot')[i].click();
  check('Starts on A1 (Bench Press)', current()==='Bench Press', current());
  tick('Bench Press', 0);
  await wait(10);
  check('A set of A1 moves straight to A2, no rest', current()==='Seated Row' && !restOn(), current()+' rest:'+restOn());
  tick('Seated Row', 0);
  await wait(10);
  check('A set of A2 ends the round: rest, then back to A1', current()==='Bench Press' && restOn(), current()+' rest:'+restOn());
  tick('Bench Press', 1);
  await wait(10);
  check('Round 2: A1 -> A2 again', current()==='Seated Row', current());
  tick('Seated Row', 1);
  await wait(10);
  check('Superset done: on to the next exercise, after a rest', current()==='Lateral Raise' && restOn(), current()+' rest:'+restOn());
  doc.getElementById('restSkip').click();
  tick('Lateral Raise', 0);
  await wait(10);
  check('A normal exercise rests between its own sets as before', current()==='Lateral Raise' && restOn(), current()+' rest:'+restOn());

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
