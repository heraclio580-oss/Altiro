const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// The Today card's "Workouts" tile counts against the workouts this week's plan actually holds -- the
// training days (a missed one still counts), minus any the user skipped, plus any other day they
// logged or planned a workout on -- not a fixed 5.
(async () => {
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const tile = () => doc.getElementById('ovWorkoutsVal').textContent;
  const home = async () => { go('home'); await wait(20); };

  await home();
  console.log('Mon/Wed/Fri plan: the goal is 3 (Monday and Wednesday were missed, still counted):', tile()==='0/3' ? 'OK' : `FAIL (${tile()})`);

  // A run logged on Tuesday, which isn't a training day, adds to both.
  go('calendar');
  await wait(20);
  doc.querySelector('.mo-cell[data-date="2026-09-15"]').click();
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
  if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('manualNameInput').value = 'Bonus Run';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('manualDistanceInput').value = '3';
  doc.getElementById('manualDistanceInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  doc.getElementById('closeDayDetail').click();
  await home();
  console.log('A workout logged on an extra day counts toward both:', tile()==='1/4' ? 'OK' : `FAIL (${tile()})`);

  // Skipping today's workout takes it off the week.
  go('adjust');
  await wait(10);
  for(let i=0;i<2;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  doc.getElementById('applyAdjust').click();
  await home();
  console.log('Switching focus alone doesn\'t change the goal:', tile()==='1/4' ? 'OK' : `FAIL (${tile()})`);
  doc.getElementById('changeExercisesBtn').click();
  await wait(20);
  doc.getElementById('wpSkipWorkoutBtn').click();
  await home();
  console.log('Skipping today\'s workout takes it off the goal:', tile()==='1/3' ? 'OK' : `FAIL (${tile()})`);

  // Five training days: Monday-Friday (Tuesday already has its logged run; Friday stays skipped).
  go('adjust');
  await wait(10);
  doc.querySelector('#adjDayCountChips .chip[data-count="5"]').click();
  doc.getElementById('applyAdjust').click();
  await home();
  console.log('Five training days: the goal follows (Friday still skipped):', tile()==='1/4' ? 'OK' : `FAIL (${tile()})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
