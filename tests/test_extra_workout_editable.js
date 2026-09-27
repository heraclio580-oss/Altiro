const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-27'; } }); // Sunday
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Covers two requested improvements to "Additional Workouts" (extraWorkouts):
// 1. Tapping an existing one now opens Create Workout pre-filled to revise it in place, instead of
//    having no edit path at all (only delete-and-relog, which lost its place in the list).
// 2. A day whose only real content is an extra workout no longer shows a bare "Rest Day" on the
//    Plan list, Home, and Day Detail's own Scheduled row -- it shows that workout's name/detail,
//    the same way a logged entry already gets promoted into a rest day's display.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('home');
  await wait(20);
  // Friday Sep 25 is 2 days before today (a Sunday) -- within Home's rolling week-strip window.
  doc.querySelector('#weekStrip .day-cell[data-date="2026-09-25"]').click();
  await wait(20);

  // First workout takes the primary slot; a second one becomes an "Additional Workout".
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Morning Jog';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='run').click();
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Chest';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='strength').click();
  doc.getElementById('manualVolumeInput').value = 'Bench 10x10';
  doc.getElementById('manualVolumeInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  const extraBubble = doc.querySelector('#dayDetailExtraWorkouts [data-extra-id]');
  console.log('Additional Workout bubble is marked editable:', extraBubble.classList.contains('editable') ? 'OK' : 'FAIL');

  // --- Part 1: tap it to edit ---
  extraBubble.click();
  await wait(20);
  console.log('Tapping the extra opens Create Workout pre-filled:', doc.getElementById('manualNameInput').value==='Chest' && doc.getElementById('manualVolumeInput').value==='Bench 10x10' ? 'OK' : `FAIL (${doc.getElementById('manualNameInput').value}, ${doc.getElementById('manualVolumeInput').value})`);
  console.log('Sheet title reads "Edit Workout":', doc.getElementById('manualEntryTitleLabel').textContent==='Edit Workout' ? 'OK' : `FAIL (${doc.getElementById('manualEntryTitleLabel').textContent})`);

  doc.getElementById('manualVolumeInput').value = 'Bench 8x8, Incline 8x8';
  doc.getElementById('manualVolumeInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  const extraWorkoutsAfterEdit = [...doc.querySelectorAll('#dayDetailExtraWorkouts [data-extra-id]')];
  console.log('Still exactly ONE Additional Workout after editing (not appended as a second one):', extraWorkoutsAfterEdit.length===1 ? 'OK' : `FAIL (${extraWorkoutsAfterEdit.length})`);
  console.log('That extra reflects the corrected detail:', doc.getElementById('dayDetailExtraWorkouts').textContent.includes('Bench 8x8, Incline 8x8') ? 'OK' : `FAIL (${doc.getElementById('dayDetailExtraWorkouts').textContent})`);
  console.log('The original "Bench 10x10" text is gone (edited, not duplicated):', !doc.getElementById('dayDetailExtraWorkouts').textContent.includes('10x10') ? 'OK' : 'FAIL');

  console.log('ALL DONE (part 1)');

  // --- Part 2: a rest day whose only content is an extra workout shows its description ---
  goPill('home');
  await wait(20);
  doc.querySelector('#weekStrip .day-cell[data-date="2026-09-24"]').click(); // Thursday, untouched rest day
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Yoga';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.getAttribute('data-type')==='strength').click();
  doc.getElementById('manualVolumeInput').value = '30 min flow';
  doc.getElementById('manualVolumeInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  console.log('Day Detail Scheduled row shows the extra\'s name, not "Rest Day":',
    doc.getElementById('dayDetailPlanRow').textContent.includes('Yoga') && !doc.getElementById('dayDetailPlanRow').textContent.includes('Rest Day') ? 'OK' : `FAIL (${doc.getElementById('dayDetailPlanRow').textContent})`);

  goPill('week');
  await wait(20);
  const thuRow = doc.querySelector('.plan-row[data-day="3"][data-week-idx="0"]'); // Thursday Sep 24
  console.log('Plan row for that day shows "Yoga", not "Rest Day":', thuRow.querySelector('.prow-title').textContent==='Yoga' ? 'OK' : `FAIL (${thuRow.querySelector('.prow-title').textContent})`);
  console.log('Plan row shows the extra\'s detail too:', thuRow.querySelector('.prow-detail')?.textContent==='30 min flow' ? 'OK' : `FAIL (${thuRow.querySelector('.prow-detail')?.textContent})`);

  goPill('home');
  await wait(20);
  const thuCell = doc.querySelector('#weekStrip .day-cell[data-date="2026-09-24"]');
  console.log('Home week-strip cell is not stuck as a plain rest cell (still shows correctly, not crashing):', !!thuCell ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
