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

  // Jump straight to the calendar tab (bypass onboarding) by calling showScreen directly.
  // showScreen is inside an IIFE closure, not global -- use the debug proto-pill nav instead.
  const calPill = [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'calendar');
  if(!calPill){ console.log('FAIL: no calendar proto pill found'); process.exit(1); }
  calPill.click();
  await wait(20);

  const calScreen = doc.getElementById('screen-calendar');
  console.log('calendar screen hidden?', calScreen.hidden);

  const range1 = doc.getElementById('calRange').textContent;
  console.log('initial month label:', range1);

  const grid = doc.getElementById('calGrid');
  const cellsBefore = grid.querySelectorAll('.mo-cell').length;
  console.log('grid cell count (should be multiple of 7):', cellsBefore, cellsBefore % 7 === 0 ? 'OK' : 'FAIL');

  const todayCell = grid.querySelector('.mo-cell.today');
  console.log('today cell found:', !!todayCell, todayCell ? todayCell.getAttribute('data-date') : null);

  // Page backward 2 months, then forward 3 (net +1 from start), verify label changes and no throw.
  const prevBtn = doc.getElementById('calPrev');
  const nextBtn = doc.getElementById('calNext');
  prevBtn.click(); prevBtn.click();
  await wait(10);
  const rangeBack2 = doc.getElementById('calRange').textContent;
  console.log('after 2x prev:', rangeBack2, rangeBack2 !== range1 ? 'OK (changed)' : 'FAIL (unchanged)');
  nextBtn.click(); nextBtn.click(); nextBtn.click();
  await wait(10);
  const rangeFwd1 = doc.getElementById('calRange').textContent;
  console.log('after net +1 month from start:', rangeFwd1);
  nextBtn.click(); // back to net 0 relative offset tracking not exact, just sanity nav
  await wait(10);

  // Go back to a definitely-past cell: click prev many times to land in a fully past month, open a day cell.
  for(let i=0;i<3;i++) prevBtn.click();
  await wait(10);
  const pastGrid = doc.getElementById('calGrid');
  const pastCell = pastGrid.querySelector('.mo-cell:not(.outside)');
  console.log('past-month cell to click:', pastCell ? pastCell.getAttribute('data-date') : 'NONE FOUND');
  pastCell.click();
  await wait(10);

  const detailOverlay = doc.getElementById('dayDetailOverlay');
  console.log('day detail overlay opened:', detailOverlay.hidden === false ? 'OK' : 'FAIL');
  console.log('day detail title:', doc.getElementById('dayDetailTitle').textContent);
  console.log('plan row html snippet:', doc.getElementById('dayDetailPlanRow').textContent.trim().slice(0,80));

  // Add a manual workout entry for this past day.
  const addBtn = doc.getElementById('addWorkoutBtn');
  addBtn.click();
  await wait(10);
  const entryOverlay = doc.getElementById('manualEntryOverlay');
  console.log('manual entry overlay opened:', entryOverlay.hidden === false ? 'OK' : 'FAIL');

  doc.getElementById('manualNameInput').value = '100 Push-ups <script>alert(1)</script>';
  doc.getElementById('manualVolumeInput').value = '10 x 10';
  doc.getElementById('manualNotesInput').value = 'Felt good';
  // pick the Cardio type (the 3-choice picker no longer has a separate "other")
  const cardioTypeBtn = [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run');
  cardioTypeBtn.click();
  await wait(10);
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  console.log('manual entry overlay closed after save:', doc.getElementById('manualEntryOverlay').hidden === true ? 'OK' : 'FAIL');
  const entries = doc.getElementById('dayDetailEntries');
  console.log('entries innerHTML contains escaped script tag (no raw <script>):', !entries.innerHTML.includes('<script>') ? 'OK (escaped)' : 'FAIL (XSS risk!)');
  console.log('entries text content:', entries.textContent.trim().replace(/\s+/g,' '));

  // Check the calendar grid now shows has-log ring for that date.
  const dateKeyOpened = pastCell.getAttribute('data-date');
  const cellAfter = doc.querySelector(`.mo-cell[data-date="${dateKeyOpened}"]`);
  console.log('cell has-log class present:', cellAfter.classList.contains('has-log') ? 'OK' : 'FAIL');

  // Toggle completed for this (non-today, past, outside current week) day.
  const toggle = doc.getElementById('dayCompleteToggle');
  const wasOn = toggle.classList.contains('on');
  toggle.click();
  await wait(10);
  console.log('toggle flipped:', toggle.classList.contains('on') !== wasOn ? 'OK' : 'FAIL');

  // Delete the manual entry.
  const delBtn = entries.querySelector('[data-del]');
  delBtn.click();
  await wait(10);
  console.log('entry removed after delete:', doc.getElementById('dayDetailEntries').textContent.includes('Push-ups') ? 'FAIL (still present)' : 'OK (removed)');

  doc.getElementById('closeDayDetail').click();
  await wait(10);
  console.log('day detail closed:', doc.getElementById('dayDetailOverlay').hidden === true ? 'OK' : 'FAIL');

  // Now test a CURRENT-WEEK day (open today's cell itself) -- toggle should be hidden.
  // Net offset is currently -1 (August) relative to today's month (September); +1 gets back to 0.
  nextBtn.click();
  await wait(10);
  const todayCell2 = doc.querySelector('.mo-cell.today');
  todayCell2.click();
  await wait(10);
  console.log('complete section now shown for today:', doc.getElementById('dayDetailCompleteSection').hidden === false ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();

  // Current-week, non-today day (Monday, 2026-09-14) -- toggling here must sync to the Plan/Week tab.
  // Past days default to blank/rest now (no fabricated content), and a blank/rest day hides its own
  // Completed toggle (nothing to mark done without saying what it was) -- so give Monday a real
  // planned workout first, left incomplete, the same way an end user would.
  const monCell = doc.querySelector('.mo-cell[data-date="2026-09-14"]');
  console.log('monday cell found:', !!monCell);
  monCell.click();
  await wait(10);
  doc.getElementById('addWorkoutBtn').click();
  await wait(10);
  doc.getElementById('manualNameInput').value = 'Monday Strength';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
  if(doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('saveManualEntry').click();
  await wait(10);
  console.log('complete section hidden for past in-week day:', doc.getElementById('dayDetailCompleteSection').hidden === false ? 'OK (visible)' : 'FAIL');
  const monToggle = doc.getElementById('dayCompleteToggle');
  const monWasOn = monToggle.classList.contains('on');
  monToggle.click();
  await wait(10);

  const mondayRow = [...doc.querySelectorAll('#weekList .plan-row')].find(r=>r.getAttribute('data-day')==='0' && r.getAttribute('data-week-idx')==='0');
  console.log('Plan tab Monday row class after toggle (expect done):', mondayRow ? mondayRow.className : 'NOT FOUND');
  console.log('Plan tab reflects toggle:', mondayRow && mondayRow.classList.contains('done') ? 'OK' : 'FAIL');

  doc.getElementById('closeDayDetail').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
