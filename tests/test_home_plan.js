const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // --- HOME: week strip click opens Day Detail (not Plan) ---
  goPill('home');
  await wait(20);
  const strip = doc.getElementById('weekStrip');
  const mondayCell = strip.querySelector('.day-cell[data-day="0"]');
  mondayCell.click();
  await wait(10);
  console.log('Home: clicking Monday cell opens Day Detail:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Home: Plan screen NOT auto-shown:', doc.getElementById('screen-home').hidden===false ? 'OK (still on home)' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // --- HOME: today cell opens Day Detail with toggle hidden ---
  const todayCell = strip.querySelector('.day-cell[data-day="4"]');
  todayCell.click();
  await wait(10);
  console.log('Home: today cell opens Day Detail:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Home: complete toggle now shown for today:', doc.getElementById('dayDetailCompleteSection').hidden===false ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // --- HOME: "+ Add a Workout" quick action on session card logs directly to today ---
  const addTodayBtn = doc.getElementById('addTodayWorkoutBtn');
  console.log('Home: addTodayWorkoutBtn exists:', !!addTodayBtn);
  addTodayBtn.click();
  await wait(10);
  console.log('Home: manual entry overlay opened directly (no day-detail needed):', doc.getElementById('manualEntryOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Home: day detail overlay stayed closed:', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');
  doc.getElementById('manualNameInput').value = 'Push-ups';
  doc.getElementById('manualVolumeInput').value = '10 x 10';
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  console.log('Home: manual entry overlay closed after save:', doc.getElementById('manualEntryOverlay').hidden===true ? 'OK' : 'FAIL');
  // verify it landed on today by reopening today's day detail
  todayCell.click();
  await wait(10);
  console.log('Home: logged entry shows up under today:', doc.getElementById('dayDetailEntries').textContent.includes('Push-ups') ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // Past days default to blank/rest now (no fabricated content), so a real missed Monday plan has
  // to be established through the app's own affordances before the reschedule flow below has
  // anything to reschedule.
  goPill('home');
  await wait(20);
  mondayCell.click();
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Monday Strength';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
  if(doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // --- PLAN: rows are now compact (single line); reschedule now lives inside Day Detail ---
  goPill('week');
  await wait(20);
  const weekList = doc.getElementById('weekList');
  const mondayRow = weekList.querySelector('.plan-row[data-day="0"][data-week-idx="0"]');
  console.log('Plan: Monday row status class (expect missed):', mondayRow.className);
  console.log('Plan: no inline shift button on the compact row:', !mondayRow.querySelector('[data-shift]') ? 'OK' : 'FAIL');

  function firePointer(el, type, opts){
    el.dispatchEvent(new window.PointerEvent(type, Object.assign({bubbles:true, cancelable:true, pointerId:1}, opts)));
  }
  // Tapping the missed row opens Day Detail, where the reschedule action now lives.
  firePointer(mondayRow, 'pointerdown', {clientX:50, clientY:50});
  await wait(20);
  firePointer(mondayRow, 'pointerup', {clientX:50, clientY:50});
  await wait(10);
  console.log('Plan: tapping missed row opens Day Detail:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  const shiftBtn = doc.getElementById('ddShiftBtn');
  console.log('Plan: Shift button now lives inside Day Detail:', !!shiftBtn ? 'OK' : 'FAIL');
  shiftBtn.click();
  await wait(10);
  console.log('Plan: Day Detail closes itself after completing the reschedule:', doc.getElementById('dayDetailOverlay').hidden===true ? 'OK' : 'FAIL');

  // Now tap elsewhere on a plain row (not the missed one) to open Day Detail again.
  const anyRow = doc.getElementById('weekList').querySelector('.plan-row');
  firePointer(anyRow, 'pointerdown', {clientX:50, clientY:50});
  await wait(20);
  firePointer(anyRow, 'pointerup', {clientX:50, clientY:50});
  await wait(10);
  console.log('Plan: clicking row body opens Day Detail:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
