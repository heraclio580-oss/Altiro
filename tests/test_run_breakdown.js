const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// A structured run is broken down step by step -- warm-up, the main set (with its effort and pace),
// recovery between reps, cool-down -- in the workout preview and in Day Detail. Someone going by feel
// gets the steps without any pace.
(async () => {
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const adjust = async (fn) => { go('adjust'); await wait(10); fn(); doc.getElementById('applyAdjust').click(); await wait(20); };
  const tap = async (w, d) => {
    const row = doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`);
    for(const type of ['pointerdown','pointerup']) row.dispatchEvent(new window.PointerEvent(type, {bubbles:true}));
    await wait(20);
  };
  const steps = () => [...doc.querySelectorAll('#wpBreakdown .wp-ex')].map(el=>({
    label: el.querySelector('.wp-ex-name').firstChild.textContent.trim(),
    amount: (el.querySelector('.wp-step-amount')||{}).textContent || '',
    note: el.querySelector('.wp-ex-rx').textContent,
  }));
  // Find a run of a given kind in the coming weeks and preview it.
  async function previewFirst(title){
    for(let w=1; w<4; w++) for(let d=0; d<7; d++){
      const row = doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`);
      if(row && row.textContent.includes(title)){ await tap(w, d); return {w, d}; }
    }
    return null;
  }

  // Running only, 5 days (Tue-Thu, Sat, Sun), 21-30 mi a week, High intensity.
  await adjust(()=>{
    for(let i=0;i<2;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
    doc.querySelector('#adjDayCountChips .chip[data-count="5"]').click();
    for(const d of [0,4]) doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`).click();
    for(const d of [5,6]) doc.querySelector(`#adjWeekdayChips .chip[data-weekday="${d}"]`).click();
    doc.querySelector('#adjMilesChips .chip[data-key="25"]').click();
    doc.querySelector('#adjIntensityTabs .tab-btn[data-idx="2"]').click(); // High: two hard sessions a week
  });
  go('week');
  await wait(20);

  // ---- tempo ----
  const tempoAt = await previewFirst('Tempo Run');
  console.log('Found a tempo run to preview:', tempoAt && !doc.getElementById('workoutPreviewOverlay').hidden ? 'OK' : 'FAIL');
  const total = parseFloat(doc.getElementById('wpDetail').textContent);
  const tempoPart = parseFloat(doc.getElementById('wpDetail').textContent.split('· ')[1]);
  const t = steps();
  console.log('Tempo breakdown: warm-up, tempo, cool-down:', t.map(s=>s.label).join()==='Warm-up,Tempo,Cool-down' ? `OK (${doc.getElementById('wpDetail').textContent})` : `FAIL (${t.map(s=>s.label)})`);
  console.log('...the tempo part matches the plan:', parseFloat(t[1].amount)===tempoPart ? `OK (${t[1].amount})` : `FAIL (${t[1].amount} vs ${tempoPart})`);
  const sum = t.reduce((acc,s)=>acc+parseFloat(s.amount), 0);
  console.log('...and the three parts add up to the whole run:', Math.abs(sum-total) < 0.01 ? `OK (${t.map(s=>s.amount).join(' + ')} = ${total} mi)` : `FAIL (${sum} vs ${total})`);
  console.log('...each step says what to do -- start easy, pick up the pace, slow back down:',
    /^start easy/.test(t[0].note) && /^pick up the pace/.test(t[1].note) && /^slow back down/.test(t[2].note) ? 'OK' : `FAIL (${t.map(s=>s.note).join(' | ')})`);
  console.log('...warm-up and cool-down are easy:', /easy, conversational/.test(t[0].note) && /easy, conversational/.test(t[2].note) ? 'OK' : `FAIL (${t[0].note})`);
  const tempoPace = (t[1].note.match(/~(\d+):(\d\d)\/mi/)||[]);
  console.log('...the tempo is comfortably hard, with a pace faster than easy (9:30):',
    /comfortably hard/.test(t[1].note) && tempoPace.length && (+tempoPace[1] + tempoPace[2]/60) < 9.5 ? `OK (${t[1].note})` : `FAIL (${t[1].note})`);
  console.log('...no separate single "target pace" line competing with it:', doc.getElementById('wpPace').textContent==='' ? 'OK' : `FAIL (${doc.getElementById('wpPace').textContent})`);
  doc.getElementById('closeWorkoutPreview').click();

  // ---- intervals ----
  await previewFirst('Interval Run');
  const iv = steps();
  console.log('Interval breakdown: warm-up, repeats, recovery jogs, cool-down:',
    iv.map(s=>s.label).join()==='Warm-up,Repeats,Recovery,Cool-down' && /^\d+ × \d+m$/.test(iv[1].amount) ? `OK (${iv[1].amount}, ${iv[1].note})` : `FAIL (${iv.map(s=>s.label+' '+s.amount)})`);
  doc.getElementById('closeWorkoutPreview').click();

  // ---- an easy run has nothing to break down ----
  await previewFirst('Easy Run');
  console.log('A plain easy run has no breakdown (and keeps its target pace):',
    doc.getElementById('wpBreakdownSection').hidden && /Target pace/.test(doc.getElementById('wpPace').textContent) ? 'OK' : 'FAIL');
  doc.getElementById('closeWorkoutPreview').click();

  // ---- Day Detail shows it too ----
  const tempoDate = new Date(2026, 8, 14 + tempoAt.w*7 + tempoAt.d);
  const key = `${tempoDate.getFullYear()}-${String(tempoDate.getMonth()+1).padStart(2,'0')}-${String(tempoDate.getDate()).padStart(2,'0')}`;
  go('calendar');
  await wait(20);
  while(!doc.querySelector(`.mo-cell[data-date="${key}"]`)){ doc.getElementById('calNext').click(); await wait(10); }
  doc.querySelector(`.mo-cell[data-date="${key}"]`).click();
  await wait(20);
  const ddText = doc.querySelector('#dayDetailPlanRow .run-breakdown');
  console.log('Day Detail lists the same breakdown:', ddText && /Warm-up/.test(ddText.textContent) && /Tempo/.test(ddText.textContent) && /Cool-down/.test(ddText.textContent) ? 'OK' : `FAIL (${ddText && ddText.textContent})`);
  doc.getElementById('closeDayDetail').click();

  // ---- someone new to running: steps, no pace ----
  await adjust(()=>{ doc.querySelector('#adjMilesChips .chip[data-key="0"]').click(); });
  go('week');
  await wait(20);
  await previewFirst('Run/Walk');
  const rw = steps();
  console.log('Run/walk breakdown: walk warm-up, run + walk rounds, walk cool-down:',
    rw.map(s=>s.label).join()==='Warm-up,Run + walk,Cool-down' && rw[0].amount==='5 min' && /^\d+ × \(/.test(rw[1].amount) ? `OK (${rw[1].amount})` : `FAIL (${rw.map(s=>s.label+' '+s.amount)})`);
  console.log('...by feel, with no pace anywhere:', !/\d:\d\d\/mi/.test(doc.getElementById('workoutPreviewOverlay').textContent) ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
