const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Someone "New to running" starts with 20-minute walks that end in a jog, then jog/walk blocks built from
// the longest jog they held -- all by
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

  // ---- Today (Friday of week 1: a walk that ends with 5 minutes of jogging) ----
  const card = text('sessionCard');
  console.log('Today is a timed walk + jog:', /Walk \+ Jog, 20 min · walk 15 min, then jog the last 5 min a touch quicker/.test(card) ? 'OK' : `FAIL (${card.replace(/\s+/g,' ').slice(0,120)})`);
  console.log('...with an effort to go by instead of a pace:', card.includes('Effort: Easy — you can still talk') && noPace(card) ? 'OK' : `FAIL (${card})`);
  console.log('The weekly tile counts minutes, not miles:', text('ovDistanceLabel')==='Time' && /^0\/\d+ min$/.test(text('ovDistanceVal')) ? 'OK' : `FAIL (${text('ovDistanceLabel')} ${text('ovDistanceVal')})`);

  // ---- The plan ahead ----
  go('week');
  await wait(20);
  const tap = async (w, d) => {
    const row = doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`);
    for(const type of ['pointerdown','pointerup']) row.dispatchEvent(new window.PointerEvent(type, {bubbles:true}));
    await wait(20);
  };
  const bd = () => [...doc.querySelectorAll('#wpBreakdown .wp-ex')].map(el=>el.textContent.replace(/\s+/g,' ').trim());
  await tap(1, 0);
  console.log('Next week: walk 10, then jog 3 / walk 1 to the end:', text('wpTitle')==='Walk + Jog' && text('wpDetail')==='20 min · walk 10 min, then jog 3 min / walk 1 min to the end' ? 'OK' : `FAIL (${text('wpTitle')} ${text('wpDetail')})`);
  const steps = bd();
  console.log('...broken down: walk 10, (jog 3 + walk 1) twice, jog the last 2:',
    steps.length===3 && /^Walk 10 min/.test(steps[0]) && /^Jog \+ walk 2 × \(3 \+ 1 min\)/.test(steps[1]) && /^Jog to the end 2 min/.test(steps[2]) ? 'OK' : `FAIL (${steps.join(' | ')})`);
  console.log('...described by feel:', /go by feel/.test(text('wpRunHow')) ? 'OK' : `FAIL (${text('wpRunHow')})`);
  console.log('...with an effort instead of a target pace:', text('wpPace')==='Effort: Easy — you can still talk' && noPace(text('workoutPreviewOverlay')) ? 'OK' : `FAIL (${text('wpPace')})`);
  doc.getElementById('closeWorkoutPreview').click();
  const header = doc.querySelector('.week-block[data-week-idx="2"] .week-block-meta').textContent;
  console.log('Plan week headers show no miles for timed weeks:', header==='Build week' ? 'OK' : `FAIL (${header})`);

  // ---- Logging today's walk + jog ----
  go('home');
  await wait(10);
  doc.querySelector('#weekStrip .day-cell.today').click();
  await wait(20);
  doc.getElementById('dayDetailPlanRow').click();
  await wait(20);
  const hms = ['logPerfTimeHInput','logPerfTimeMInput','logPerfTimeSInput'].map(id=>doc.getElementById(id).value).join(':');
  console.log('Log Performance: distance is optional (empty), time starts at the planned 20 min:',
    doc.getElementById('logPerfDistanceInput').value==='' && hms==='0:20:0' ? 'OK' : `FAIL (${doc.getElementById('logPerfDistanceInput').value} / ${hms})`);
  console.log('...and asks for the longest steady jog, starting at the planned 5:', !doc.getElementById('logPerfJogSection').hidden && doc.getElementById('logPerfJogInput').value==='5' ? 'OK' : `FAIL (${doc.getElementById('logPerfJogInput').value})`);
  doc.getElementById('logPerfJogInput').value = '2';
  doc.getElementById('saveLogPerf').click();
  await wait(30);
  const stats = text('summaryStats');
  console.log('The summary shows time and effort, no pace or pace target:', /20:00/.test(stats) && /Easy/.test(stats) && noPace(stats) && !/Pace/i.test(stats) ? 'OK' : `FAIL (${stats})`);
  doc.getElementById('submitReviewBtn').click();
  await wait(20);
  const msg = text('summaryProgressMsg');
  console.log('...and encouragement instead of a "next time" pace:', /Keep it easy/.test(msg) && noPace(msg) ? 'OK' : `FAIL (${msg})`);
  go('home');
  await wait(20);
  console.log('The weekly tile counts the 20 minutes done:', /^20\/\d+ min$/.test(text('ovDistanceVal')) ? 'OK' : `FAIL (${text('ovDistanceVal')})`);

  // ---- Next week builds from what they held: 2 minutes ----
  go('week');
  await wait(20);
  await tap(1, 0);
  console.log('Next week\'s jog blocks are now the 2 minutes they held:', text('wpDetail')==='20 min · walk 10 min, then jog 2 min / walk 1 min to the end' ? 'OK' : `FAIL (${text('wpDetail')})`);
  doc.getElementById('closeWorkoutPreview').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
