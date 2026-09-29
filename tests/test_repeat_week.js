const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Someone following their own program plans one week and repeats it into the weeks ahead instead of
// adding every day by hand: their workouts (and Additional Workouts) land on the same weekdays, and the
// days in between keep Altiro's plan or become rest days, their choice.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function click(el){ el.dispatchEvent(new window.Event('click', {bubbles:true, cancelable:true})); }

(async () => {
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const row = (w, d) => doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`);
  const title = (w, d) => row(w, d).querySelector('.prow-title').textContent;
  async function addWorkout(w, d, name, volume){
    click(row(w, d).querySelector('.prow-add'));
    await wait(10);
    doc.getElementById('manualNameInput').value = name;
    doc.getElementById('manualVolumeInput').value = volume;
    click(doc.getElementById('saveManualEntry'));
    await wait(20);
  }

  // Next week (Sep 21-27): Push / Pull / Legs, plus a core finisher on Monday.
  go('week');
  await wait(20);
  console.log('No Repeat button before the user has planned anything of their own:', !doc.querySelector('[data-repeat-week="1"]') ? 'OK' : 'FAIL');
  await addWorkout(1, 0, 'Push Day', '60 min');
  await addWorkout(1, 0, 'Core Finisher', '10 min');
  await addWorkout(1, 2, 'Pull Day', '60 min');
  await addWorkout(1, 4, 'Leg Day', '60 min');
  console.log('Their week is planned:', title(1,0)==='Push Day' && title(1,2)==='Pull Day' && title(1,4)==='Leg Day' ? 'OK' : `FAIL (${[0,2,4].map(d=>title(1,d))})`);
  // The week after already has two workouts of the user's own, on days the copy will cover.
  await addWorkout(2, 1, 'Swim', '30 min');        // Tue Sep 29 -- a day the copies make a rest day
  await addWorkout(2, 2, 'Partner WOD', '45 min'); // Wed Sep 30 -- where Pull Day gets copied
  const btn = doc.querySelector('[data-repeat-week="1"]');
  console.log('The week now has a Repeat button:', btn && /Repeat/.test(btn.textContent) ? 'OK' : 'FAIL');
  console.log('...weeks without their own workouts don\'t:', !doc.querySelector('[data-repeat-week="3"]') ? 'OK' : 'FAIL');

  click(btn);
  await wait(10);
  const overlay = doc.getElementById('repeatOverlay');
  const listed = [...doc.querySelectorAll('#repeatDays .repeat-day')].map(el=>[...el.children].map(c=>c.textContent).join(' '));
  console.log('Repeat sheet lists what will be copied:', !overlay.hidden && listed.join('|')==='MON Push Day + Core Finisher|WED Pull Day|FRI Leg Day' ? 'OK' : `FAIL (${listed.join('|')})`);
  const spans = [...doc.querySelectorAll('#repeatSpanChips .chip')].map(c=>c.textContent);
  console.log('Copy to: next week, 2, 4, 8 weeks or until a date (4 by default):', spans.join()==='Next week,Next 2 weeks,Next 4 weeks,Next 8 weeks,Until a date' && doc.querySelector('#repeatSpanChips .chip.sel').textContent==='Next 4 weeks' ? 'OK' : `FAIL (${spans})`);
  console.log('...and says where it goes:', /4 workouts a week, copied into 4 weeks \(Sep 28 – Oct 25\)/.test(doc.getElementById('repeatNote').textContent) ? 'OK' : `FAIL (${doc.getElementById('repeatNote').textContent})`);
  console.log('Days in between: keep Altiro\'s plan by default:', doc.querySelector('#repeatOtherChips .chip.sel').textContent==="Keep Altiro's plan" ? 'OK' : 'FAIL');
  [...doc.querySelectorAll('#repeatOtherChips .chip')].find(c=>c.textContent==='Make them rest days').click();
  await wait(5);

  // "Until a date" shows a calendar
  [...doc.querySelectorAll('#repeatSpanChips .chip')].find(c=>c.textContent==='Until a date').click();
  await wait(5);
  console.log('"Until a date" opens a calendar:', !doc.getElementById('repeatCal').hidden && doc.getElementById('applyRepeatBtn').disabled ? 'OK' : 'FAIL');
  doc.querySelector('#repeatCal [data-cal-step="1"]').click();
  await wait(5);
  doc.querySelector('#repeatCal [data-date="2026-10-18"]').click();
  await wait(5);
  console.log('...up to Sunday Oct 18 = 3 weeks:', /copied into 3 weeks \(Sep 28 – Oct 18\)/.test(doc.getElementById('repeatNote').textContent) ? 'OK' : `FAIL (${doc.getElementById('repeatNote').textContent})`);
  [...doc.querySelectorAll('#repeatSpanChips .chip')].find(c=>c.textContent==='Next 4 weeks').click();
  await wait(5);
  click(doc.getElementById('applyRepeatBtn'));
  await wait(30);
  console.log('Applied:', overlay.hidden && /Copied into 4 weeks/.test(doc.getElementById('toastMsg').textContent) ? 'OK' : `FAIL (${doc.getElementById('toastMsg').textContent})`);

  go('week');
  await wait(20);
  const wk = w => [0,1,2,3,4,5,6].map(d=>title(w,d)).join(',');
  console.log('The next weeks match it, rest days between:', wk(3)==='Push Day,Rest Day,Pull Day,Rest Day,Leg Day,Rest Day,Rest Day' ? 'OK' : `FAIL (${wk(3)})`);
  console.log('Workouts already there are never replaced or made rest days:', wk(2)==='Push Day,Swim,Partner WOD,Rest Day,Leg Day,Rest Day,Rest Day' ? 'OK' : `FAIL (${wk(2)})`);

  // Further out, on the calendar: Oct 19-25 copied, Oct 26 on is Altiro's plan again.
  go('calendar');
  await wait(20);
  doc.getElementById('calNext').click();
  await wait(20);
  const cell = key => (doc.querySelector(`.mo-cell[data-date="${key}"]`)||{}).textContent || '';
  console.log('4th week out (Oct 19-25) is copied too:', /Leg/.test(cell('2026-10-23')) && /Push/.test(cell('2026-10-19')) ? 'OK' : `FAIL (${cell('2026-10-19')} / ${cell('2026-10-23')})`);
  console.log('...and the week after is left alone:', !/Leg|Push|Pull/.test(cell('2026-10-26')+cell('2026-10-28')+cell('2026-10-30')) ? 'OK' : `FAIL (${cell('2026-10-26')})`);
  doc.getElementById('calPrev').click();
  await wait(20);
  doc.querySelector('.mo-cell[data-date="2026-09-30"]').click();
  await wait(20);
  const wed = doc.getElementById('dayDetailOverlay').textContent;
  console.log('...the copy goes alongside instead:', /Partner WOD/.test(wed) && /Pull Day/.test(wed) ? 'OK' : `FAIL (${wed.replace(/\s+/g,' ').slice(0,160)})`);
  doc.getElementById('closeDayDetail').click();
  doc.getElementById('calNext').click();
  await wait(20);
  doc.querySelector('.mo-cell[data-date="2026-10-05"]').click();
  await wait(20);
  const dd = doc.getElementById('dayDetailOverlay').textContent;
  console.log('A copied Monday has its Additional Workout too:', /Push Day/.test(dd) && /Core Finisher/.test(dd) ? 'OK' : `FAIL (${dd.replace(/\s+/g,' ').slice(0,160)})`);
  doc.getElementById('closeDayDetail').click();

  // Repeating again doesn't double up the Additional Workouts.
  go('week');
  await wait(20);
  click(doc.querySelector('[data-repeat-week="1"]'));
  await wait(10);
  [...doc.querySelectorAll('#repeatSpanChips .chip')].find(c=>c.textContent==='Next week').click();
  click(doc.getElementById('applyRepeatBtn'));
  await wait(30);
  go('calendar');
  await wait(20);
  doc.getElementById('calPrev').click(); // back to September
  await wait(20);
  doc.querySelector('.mo-cell[data-date="2026-09-28"]').click();
  await wait(20);
  const cores = (doc.getElementById('dayDetailOverlay').textContent.match(/Core Finisher/g)||[]).length;
  console.log('Repeating again doesn\'t add a second copy:', cores===1 ? 'OK' : `FAIL (${cores})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
