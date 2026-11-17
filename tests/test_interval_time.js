const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// An interval workout's time counts in Progress: "Jump rope", 5 rounds of 3:00 with 1:00 rest, done with
// the timer -- the Summary said 19 min, but Progress showed 0 min and "—" for the day (the timer kept only
// that it was done, no time). Now:
// - finished, it keeps its rounds, work, rest and time (19 min), and Progress counts it: Active time, the
//   day's bar and its line ("19 min · Jump rope");
// - ended early with the hold, it keeps the time actually done (not the whole workout's);
// - one done before (marked done, no time kept) counts its time from its rounds, work and rest.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const txt = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();

async function openWithInterval(name, rounds, work, rest){
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-11-16'; } });
  await wait(60);
  const w = dom.window, doc = w.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  for(const id of ['badgeOverlay', 'locPromptOverlay']){ const e = doc.getElementById(id); if(e) e.hidden = true; }
  go('home'); await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click(); await wait(20);
  doc.getElementById('manualNameInput').value = name;
  doc.getElementById('manualNameInput').dispatchEvent(new w.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=> b.dataset.type==='interval').click();
  doc.getElementById('createRoundsInput').value = String(rounds);
  doc.getElementById('createWorkDurationInput').value = work;
  doc.getElementById('createRestDurationInput').value = rest;
  doc.getElementById('saveManualEntry').click(); await wait(20);
  go('home'); await wait(20);
  return {dom, w, doc, go};
}
const progress = async ({doc, go})=>{
  go('progress'); await wait(30);
  const tiles = txt(doc.querySelector('#progActivity .act-tiles'));
  const day = txt(doc.querySelector('#progActivity .act-detail'));
  const bar = doc.querySelector('#progActivity .act-day.sel .min');
  return {tiles, day, bar: bar ? bar.textContent.trim() : ''};
};

(async () => {
  // ---- Finished with the timer ----
  {
    const app = await openWithInterval('Jump rope', 5, '3:00', '1:00');
    const {doc} = app;
    doc.getElementById('recordBtn').click(); await wait(20);
    check('The timer opens for "Jump rope"', !doc.getElementById('intervalTimerOverlay').hidden);
    doc.getElementById('timerFinishBtn').click(); await wait(40); // (as at the end of the last round)
    check('Finished: the Summary says 5 rounds, 19 min', !doc.getElementById('screen-summary').hidden && /Rounds\s*5/i.test(txt(doc.getElementById('summaryStats'))) && /19 min/.test(txt(doc.getElementById('summaryStats'))), txt(doc.getElementById('summaryStats')));
    const p = await progress(app);
    check('Progress: Active time 19 min (it was 0 min)', /Active time\s*19 min/i.test(p.tiles), p.tiles);
    check('...Monday\'s bar: 19', p.bar==='19', p.bar);
    check('...and its line: "19 min · Jump rope" (it was "—")', /19 min/.test(p.day) && /Jump rope/.test(p.day) && !/—/.test(p.day), p.day);
    app.dom.window.close();
  }

  // ---- Ended early with the hold ----
  {
    const app = await openWithInterval('Boxing Rounds', 6, '1:00', '1:00');
    const {doc, w} = app;
    doc.getElementById('recordBtn').click(); await wait(20);
    doc.getElementById('timerStartPauseBtn').click();
    await wait(5300 + 3000); // the 5-second countdown, then 3 seconds of round 1
    const hold = doc.getElementById('timerHoldEndBtn');
    hold.dispatchEvent(new w.PointerEvent('pointerdown', {bubbles:true, cancelable:true, pointerId:1}));
    await wait(1400);
    const stats = txt(doc.getElementById('summaryStats'));
    check('Ended early: the Summary has the time done (under a minute), not the whole 11 min', !doc.getElementById('screen-summary').hidden && /Rounds\s*1/i.test(stats) && /0 min|1 min/.test(stats) && !/11 min/.test(stats), stats);
    const p = await progress(app);
    check('...and Progress has that, not 11 min', !/11 min/.test(p.tiles), p.tiles);
    app.dom.window.close();
  }

  // ---- Done before (no time kept): marked done ----
  {
    const app = await openWithInterval('Jump rope', 5, '3:00', '1:00');
    const {doc, go} = app;
    go('calendar'); await wait(20);
    doc.querySelector('#screen-calendar .mo-cell[data-date="2026-11-16"]').click(); await wait(20);
    const t = doc.getElementById('dayCompleteToggle');
    if(!t.classList.contains('on')) t.click();
    await wait(30);
    doc.getElementById('closeDayDetail').click(); await wait(10);
    const p = await progress(app);
    check('An interval workout marked done (no time kept): Progress counts 19 min from its rounds', /Active time\s*19 min/i.test(p.tiles) && /Jump rope/.test(p.day), p.tiles + ' / ' + p.day);
    app.dom.window.close();
  }

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
