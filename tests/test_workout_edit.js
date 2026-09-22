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

  // ---- Calendar ring: 'missed' (Monday 2026-09-14 is a past, non-rest, uncompleted day by default) ----
  goPill('calendar');
  await wait(20);
  const mondayCell = doc.querySelector('.mo-cell[data-date="2026-09-14"]');
  console.log('Missed day shows the missed ring class on the calendar grid:', mondayCell.classList.contains('missed') ? 'OK' : `FAIL (${mondayCell.className})`);

  mondayCell.click();
  await wait(20);
  console.log('Day Detail opened for the missed day:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  const planRow = doc.getElementById('dayDetailPlanRow');
  console.log('Default (non-custom) plan bubble is not marked editable:', !planRow.classList.contains('editable') ? 'OK' : 'FAIL');

  // Clicking a non-custom bubble should do nothing (no editor pop-up).
  planRow.click();
  await wait(20);
  console.log('Clicking a non-custom bubble does not open the Create Workout sheet:', doc.getElementById('manualEntryOverlay').hidden===true ? 'OK' : 'FAIL');

  // ---- Submit a custom workout for that missed day, then edit and clear it ----
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Retro Leg Day';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
  // Monday is in the past, so "Mark as Completed" smart-defaults ON -- flip it off to plan/submit it as a workout, not an instant log.
  if(doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
  doc.getElementById('createWeightInput').value = '150';
  doc.getElementById('createRepsInput').value = '8';
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  console.log('Plan bubble now shows the submitted workout title:', doc.getElementById('dayDetailPlanRow').textContent.includes('Retro Leg Day') ? 'OK' : 'FAIL');
  console.log('Plan bubble is now marked editable (a workout was submitted):', doc.getElementById('dayDetailPlanRow').classList.contains('editable') ? 'OK' : 'FAIL');

  {
    const cell = doc.querySelector('.mo-cell[data-date="2026-09-14"]');
    console.log('Calendar ring stays red/missed (still not completed) after submitting:', cell.classList.contains('missed') ? 'OK' : `FAIL (${cell.className})`);
  }

  // Click the bubble to reopen the editor -- fields should be pre-filled with what was submitted.
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  console.log('Editor reopened on bubble click:', doc.getElementById('manualEntryOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Sheet title switches to Edit Workout:', doc.getElementById('manualEntryTitleLabel').textContent.includes('Edit') ? 'OK' : `FAIL (${doc.getElementById('manualEntryTitleLabel').textContent})`);
  console.log('Name pre-filled:', doc.getElementById('manualNameInput').value==='Retro Leg Day' ? 'OK' : `FAIL (${doc.getElementById('manualNameInput').value})`);
  console.log('Type pre-selected (strength):', doc.querySelector('#manualTypeRow .type-btn.sel').dataset.type==='strength' ? 'OK' : 'FAIL');
  console.log('Weight target pre-filled:', doc.getElementById('createWeightInput').value==='150' ? 'OK' : `FAIL (${doc.getElementById('createWeightInput').value})`);
  console.log('Reps target pre-filled:', doc.getElementById('createRepsInput').value==='8' ? 'OK' : `FAIL (${doc.getElementById('createRepsInput').value})`);
  console.log('Clear Workout option is visible while editing:', doc.getElementById('clearWorkoutBtn').hidden===false ? 'OK' : 'FAIL');

  // Change the name and resubmit -- "change workout and submit" flow.
  doc.getElementById('manualNameInput').value = 'Retro Leg Day (Revised)';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  doc.getElementById('saveManualEntry').click();
  await wait(20);
  console.log('Editor closed after resubmitting:', doc.getElementById('manualEntryOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('Plan bubble reflects the revised title:', doc.getElementById('dayDetailPlanRow').textContent.includes('Retro Leg Day (Revised)') ? 'OK' : 'FAIL');

  // Reopen and this time Clear Workout instead of resubmitting.
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  doc.getElementById('clearWorkoutBtn').click();
  await wait(20);
  console.log('Editor closed after Clear Workout:', doc.getElementById('manualEntryOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('Plan bubble no longer shows the cleared custom title:', !doc.getElementById('dayDetailPlanRow').textContent.includes('Retro Leg Day') ? 'OK' : 'FAIL');
  console.log('Plan bubble is no longer editable after clearing:', !doc.getElementById('dayDetailPlanRow').classList.contains('editable') ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();
  await wait(10);

  // ---- Calendar ring: 'upcoming' -> 'done' transition on a future day ----
  doc.querySelector('#weekStrip .day-cell[data-day="5"]').click(); // Saturday, future
  await wait(20);
  doc.getElementById('addWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Weekend Ride';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
  doc.getElementById('saveManualEntry').click(); // future day -> "Mark as Completed" already smart-defaults off (planning mode)
  await wait(20);
  doc.getElementById('closeDayDetail').click();
  await wait(10);
  goPill('calendar');
  await wait(20);
  const satCellBefore = doc.querySelector('.mo-cell[data-date="2026-09-19"]');
  console.log('Future scheduled day shows the upcoming (yellow) ring:', satCellBefore.classList.contains('upcoming') ? 'OK' : `FAIL (${satCellBefore.className})`);

  satCellBefore.click();
  await wait(20);
  doc.getElementById('dayCompleteToggle').click();
  await wait(20);
  doc.getElementById('closeDayDetail').click();
  await wait(20);
  const satCellAfter = doc.querySelector('.mo-cell[data-date="2026-09-19"]');
  console.log('Marking it completed turns the ring green (done):', satCellAfter.classList.contains('done') ? 'OK' : `FAIL (${satCellAfter.className})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
