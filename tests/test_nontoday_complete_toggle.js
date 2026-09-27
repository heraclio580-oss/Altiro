const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Regression test for a reported bug: toggling "Mark as Completed" off for a day that is in the
// current week but is NOT today appeared to do nothing -- the user had to refresh the browser to
// see the change. Root cause: the toggle's click handler wrote the new value to
// state.week[idx].completed for this branch, instead of ensureDayLog(key).completedOverride like
// the today/outside-current-week branches do. getDayData() computes `completed` as
// `planCompleted || manualEntries.length>0 || ...` and only THEN applies completedOverride, so a
// day with a real logged entry stayed "done" no matter what state.week[idx].completed was set to --
// only completedOverride can actually win. A refresh "fixed" it only because reloading from the
// cloud re-derives completedOverride correctly (cloudSetCompletedOverride was, and still is, called
// unconditionally regardless of branch).
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);

  // Monday is in the current week but not today (today is Friday per the fixed test date).
  const monCell = doc.querySelector('#weekStrip .day-cell[data-day="0"]');
  monCell.click();
  await wait(20);

  // Log a real workout on Monday -- this is what makes manualEntries.length>0 true and previously
  // masked the bug (a day with no logged entry at all happened to toggle fine).
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('manualNameInput').value = 'Monday Run';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  const toggle = doc.getElementById('dayCompleteToggle');
  console.log('Toggle starts ON after logging a workout on Monday:', toggle.classList.contains('on') ? 'OK' : 'FAIL');

  // The actual repro: toggle OFF without any refresh/reload in between.
  toggle.click();
  await wait(20);
  console.log('Toggle flips OFF immediately, no refresh needed:', !doc.getElementById('dayCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');

  goPill('week');
  await wait(20);
  const monRow = doc.querySelector('.plan-row[data-day="0"][data-week-idx="0"]');
  console.log('Plan row for Monday no longer shows done immediately:', !monRow.classList.contains('done') ? 'OK' : `FAIL (${monRow.className})`);

  goPill('calendar');
  await wait(20);
  const monDateCell = doc.querySelector('#calGrid .mo-cell[data-date="2026-09-14"]');
  console.log('Calendar cell for Monday no longer shows done immediately:', monDateCell && !monDateCell.classList.contains('done') ? 'OK' : `FAIL (${monDateCell ? monDateCell.className : 'not found'})`);

  // Toggle back ON -- should also take effect immediately, and should survive a subsequent
  // getDayData() recompute (i.e. really set the override, not just a transient render flag).
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-day="0"]').click();
  await wait(20);
  doc.getElementById('dayCompleteToggle').click();
  await wait(20);
  console.log('Toggle flips back ON immediately:', doc.getElementById('dayCompleteToggle').classList.contains('on') ? 'OK' : 'FAIL');
  goPill('week');
  await wait(20);
  const monRowAgain = doc.querySelector('.plan-row[data-day="0"][data-week-idx="0"]');
  console.log('Plan row for Monday shows done again immediately:', monRowAgain.classList.contains('done') ? 'OK' : `FAIL (${monRowAgain.className})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
