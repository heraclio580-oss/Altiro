const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);

  console.log('Home shows a "Completed" toggle for today without opening Day Detail:', !!doc.getElementById('homeCompleteToggle') ? 'OK' : 'FAIL');
  console.log('Toggle starts OFF:', !doc.getElementById('homeCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');
  console.log('Home shows a "Logged Workouts" list on the main dashboard:', !!doc.getElementById('homeEntriesWrap') ? 'OK' : 'FAIL');
  console.log('Logged Workouts list starts empty ("Nothing logged" message):', doc.getElementById('homeEntriesWrap').textContent.includes('Nothing logged') ? 'OK' : 'FAIL');

  // --- Toggle Completed directly from Home ---
  const workoutsBefore = doc.getElementById('ovWorkoutsVal').textContent;
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  console.log('Clicking the Home toggle turns it ON:', doc.getElementById('homeCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');
  console.log('Today\'s week-strip cell flips to "done" from the Home toggle alone:', !!doc.querySelector('#weekStrip .day-cell.done[data-day="4"]') ? 'OK' : 'FAIL');
  console.log('"This Week" workouts count increments:', doc.getElementById('ovWorkoutsVal').textContent !== workoutsBefore ? 'OK' : `FAIL (stayed ${workoutsBefore})`);
  console.log('Record button reflects done state too:', doc.getElementById('recordBtn').classList.contains('done') ? 'OK' : 'FAIL');

  // Toggle back off.
  doc.getElementById('homeCompleteToggle').click();
  await wait(20);
  console.log('Toggling again from Home turns it back OFF:', !doc.getElementById('homeCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');
  console.log('Workouts count reverts:', doc.getElementById('ovWorkoutsVal').textContent === workoutsBefore ? 'OK' : 'FAIL');

  // --- Log a workout via Home's "+ Add a Workout", then confirm it shows in Home's own list (no Day Detail needed) ---
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Extra Cardio';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  console.log('Logged entry now shows directly in Home\'s dashboard list:', doc.getElementById('homeEntriesWrap').textContent.includes('Extra Cardio') ? 'OK' : 'FAIL');
  console.log('Home\'s Completed toggle auto-reflects done (from the manual log):', doc.getElementById('homeCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');

  // --- Delete that entry directly from Home, without opening Day Detail ---
  const delBtn = doc.querySelector('#homeEntriesWrap [data-del]');
  console.log('Delete button is present on Home\'s entry:', !!delBtn ? 'OK' : 'FAIL');
  delBtn.click();
  await wait(20);
  console.log('Entry removed from Home\'s list after deleting from Home:', !doc.getElementById('homeEntriesWrap').textContent.includes('Extra Cardio') ? 'OK' : 'FAIL');
  console.log('List falls back to "Nothing logged" again:', doc.getElementById('homeEntriesWrap').textContent.includes('Nothing logged') ? 'OK' : 'FAIL');
  console.log('Completed toggle reverts to OFF once the only log is removed:', !doc.getElementById('homeCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');

  // --- None of this should have required opening Day Detail at all ---
  console.log('Day Detail overlay was never opened during any of this:', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
