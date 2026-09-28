const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Someone "New to running" on Light intensity starts with timed brisk walks, then run/walk -- all by
// feel: no pace targets, pace suggestions or pace-based progression anywhere, and no miles to hit.
(async () => {
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const text = id => doc.getElementById(id).textContent;
  const noPace = str => !/\d:\d\d\s*\/\s*mi/.test(str);

  go('adjust');
  await wait(10);
  for(let i=0;i<2;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
  doc.querySelector('#adjIntensityTabs .tab-btn[data-idx="0"]').click();
  await wait(5);
  doc.querySelector('#adjMilesChips .chip[data-key="0"]').click();
  await wait(5);
  doc.getElementById('applyAdjust').click();
  await wait(20);
  go('home');
  await wait(20);

  // ---- Today (week 1 of the plan: brisk walks) ----
  const card = text('sessionCard');
  console.log('Today is a timed brisk walk:', /Brisk Walk, 30 min/.test(card) ? 'OK' : `FAIL (${card.slice(0,80)})`);
  console.log('...with an effort to go by instead of a pace:', card.includes('Effort: Easy — you can still talk') && noPace(card) ? 'OK' : `FAIL (${card})`);
  console.log('The weekly tile counts minutes, not miles:', text('ovDistanceLabel')==='Time' && text('ovDistanceVal')==='0/30 min' ? 'OK' : `FAIL (${text('ovDistanceLabel')} ${text('ovDistanceVal')})`);

  // ---- The plan ahead ----
  go('week');
  await wait(20);
  const tap = async (w, d) => {
    const row = doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`);
    for(const type of ['pointerdown','pointerup']) row.dispatchEvent(new window.PointerEvent(type, {bubbles:true}));
    await wait(20);
  };
  await tap(1, 0);
  console.log('Next week: brisk walks get longer (25 min):', text('wpTitle')==='Brisk Walk' && text('wpDetail')==='25 min' ? 'OK' : `FAIL (${text('wpTitle')} ${text('wpDetail')})`);
  doc.getElementById('closeWorkoutPreview').click();
  await tap(2, 0);
  console.log('The week after: run/walk begins, timed:', text('wpTitle')==='Run/Walk' && /^\d+ min · run 1 min, walk 2 min × 6$/.test(text('wpDetail')) ? `OK (${text('wpDetail')})` : `FAIL (${text('wpDetail')})`);
  console.log('...described by feel:', /Go by feel, not pace/.test(text('wpRunHow')) ? 'OK' : `FAIL (${text('wpRunHow')})`);
  console.log('...with an effort instead of a target pace:', text('wpPace')==='Effort: Easy — you can still talk' && noPace(text('workoutPreviewOverlay')) ? 'OK' : `FAIL (${text('wpPace')})`);
  doc.getElementById('closeWorkoutPreview').click();
  const header = doc.querySelector('.week-block[data-week-idx="2"] .week-block-meta').textContent;
  console.log('Plan week headers show no miles for timed weeks:', header==='Build week' ? 'OK' : `FAIL (${header})`);

  // ---- Logging today's walk ----
  go('home');
  await wait(10);
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  const hms = ['logPerfTimeHInput','logPerfTimeMInput','logPerfTimeSInput'].map(id=>doc.getElementById(id).value).join(':');
  console.log('Log Performance: distance is optional (empty), time starts at the planned 30 min:',
    doc.getElementById('logPerfDistanceInput').value==='' && hms==='0:30:0' ? 'OK' : `FAIL (${doc.getElementById('logPerfDistanceInput').value} / ${hms})`);
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  const stats = text('summaryStats');
  console.log('The summary shows time and effort, no pace or pace target:', /30:00/.test(stats) && /Easy/.test(stats) && noPace(stats) && !/Pace/i.test(stats) ? 'OK' : `FAIL (${stats})`);
  doc.getElementById('submitReviewBtn').click();
  await wait(20);
  const msg = text('summaryProgressMsg');
  console.log('...and encouragement instead of a "next time" pace:', /Keep it easy/.test(msg) && noPace(msg) ? 'OK' : `FAIL (${msg})`);
  go('home');
  await wait(20);
  console.log('The weekly tile counts the 30 minutes done:', text('ovDistanceVal')==='30/30 min' ? 'OK' : `FAIL (${text('ovDistanceVal')})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
