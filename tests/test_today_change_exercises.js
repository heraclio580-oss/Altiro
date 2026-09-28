const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Today's lifting workout can have its exercises changed too -- from a "Change exercises" button on
// the Today card, and from inside Log Performance while recording it (which then shows the new list).
(async () => {
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const wpNames = () => [...doc.querySelectorAll('#wpExerciseList .wp-ex-name')].map(el=>el.textContent);
  const logKeys = () => [...doc.querySelectorAll('#logPerfExercisesList .exercise-log-row')].map(r=>r.getAttribute('data-exercise-key'));
  const click = async sel => { doc.querySelector(sel).click(); await wait(20); };

  // A weights-only plan, so today (Friday, a training day) is a lifting day.
  go('adjust');
  for(let i=0;i<2;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  doc.getElementById('applyAdjust').click();
  await wait(10);
  go('home');
  await wait(20);

  // ---- from the Today card ----
  const btn = doc.getElementById('changeExercisesBtn');
  console.log("Today's lifting workout has a Change exercises button:", btn ? 'OK' : 'FAIL');
  await click('#changeExercisesBtn');
  console.log("...which opens today's workout with its exercises:", !doc.getElementById('workoutPreviewOverlay').hidden && wpNames().length>=4 ? `OK (${wpNames().join(', ')})` : 'FAIL');
  console.log('...where the whole workout can still be skipped:', !doc.getElementById('wpSkipWorkoutBtn').hidden ? 'OK' : 'FAIL');
  const original = wpNames();
  await click('#wpExerciseList [data-change="0"]');
  const alt = doc.querySelector('.wp-chooser [data-alt]:not([data-alt="skip"])').getAttribute('data-alt');
  await click(`.wp-chooser [data-alt="${alt}"]`);
  await click('.wp-chooser [data-scope="one"]');
  await click('#closeWorkoutPreview');
  const cardList = [...doc.querySelectorAll('#sessionCard .r-exercise-list li')].map(li=>li.firstChild.textContent.trim());
  console.log('The Today card shows the swapped exercise:', cardList[0]===alt && !cardList.includes(original[0]) ? 'OK' : `FAIL (${cardList})`);

  // ---- from Log Performance, while recording ----
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  console.log('Log Performance opens with the swapped exercise:', !doc.getElementById('logPerfOverlay').hidden && logKeys()[0]===alt ? 'OK' : `FAIL (${logKeys()})`);
  console.log('...and a Change exercises button:', !doc.getElementById('logPerfChangeExercisesBtn').hidden ? 'OK' : 'FAIL');
  await click('#logPerfChangeExercisesBtn');
  console.log('It opens the workout over Log Performance:', !doc.getElementById('workoutPreviewOverlay').hidden && !doc.getElementById('logPerfOverlay').hidden ? 'OK' : 'FAIL');
  console.log("...without Skip workout / day options mid-workout:", doc.getElementById('wpSkipWorkoutBtn').hidden && doc.getElementById('wpDayOptionsBtn').hidden ? 'OK' : 'FAIL');
  const skippedKey = logKeys()[1];
  await click('#wpExerciseList [data-change="1"]');
  await click('.wp-chooser [data-alt="skip"]');
  await click('.wp-chooser [data-scope="one"]');
  await click('#closeWorkoutPreview');
  console.log('Back in Log Performance, the skipped exercise is gone:', !doc.getElementById('logPerfOverlay').hidden && !logKeys().includes(skippedKey) && logKeys().length===original.length-1 ? 'OK' : `FAIL (${logKeys()})`);

  // Closing the sheet without changing anything leaves Log Performance (and what was typed) alone.
  const firstWeight = doc.querySelector('#logPerfExercisesList [data-field="weight"]');
  if(firstWeight) firstWeight.value = '123';
  await click('#logPerfChangeExercisesBtn');
  await click('#closeWorkoutPreview');
  const stillTyped = doc.querySelector('#logPerfExercisesList [data-field="weight"]');
  console.log('Opening and closing it without a change keeps what was typed:', !firstWeight || (stillTyped && stillTyped.value==='123') ? 'OK' : `FAIL (${stillTyped && stillTyped.value})`);

  // Recording saves the changed workout's exercises.
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  console.log('Recording it goes on to the Summary as usual:', !doc.getElementById('screen-summary').hidden ? 'OK' : 'FAIL');
  go('home');
  await wait(20);
  console.log('Once done, the Today card no longer offers Change exercises:', !doc.getElementById('changeExercisesBtn') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
