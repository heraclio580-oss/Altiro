const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Running and lifting each have their own intensity -- a powerlifter can lift on High while their runs
// and walks start on Light, without one setting pulling the other along.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

function makeBackend(){
  const profileUpdates = [];
  function from(table){
    let op = 'select', payload = null;
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ return api; },
      update(p){ op = 'update'; payload = p; return api; }, upsert(){ op = 'upsert'; return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,1,2,3,4,5], focus_ratio:2, intensity_idx:1, level:'intermediate', weekly_miles:15, equipment:'gym', plan_start:'2026-09-14'} : null, error:null}); },
      then(res, rej){
        if(op==='update' && table==='profiles') profileUpdates.push(payload);
        return Promise.resolve({data: op==='select' ? [] : null, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { profileUpdates, createClient: () => ({
    auth: {
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async getSession(){ return {data:{session:{user:{id:'u1', email:'lifter@example.com'}}}}; },
      async signOut(){ return {error:null}; },
    },
    from,
  })};
}

(async () => {
  const backend = makeBackend();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(200);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const pick = (id, idx) => doc.querySelector(`#${id} .tab-btn[data-idx="${idx}"]`).click();
  const sel = id => (doc.querySelector(`#${id} .tab-btn.sel .t`)||{}).textContent;
  const slide = async dir => { doc.getElementById('adjSliderThumb').dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:dir, bubbles:true})); await wait(5); };
  const meta = i => { const el = doc.querySelector(`.week-block[data-week-idx="${i}"] .week-block-meta`); return el ? el.textContent : ''; };
  const miles = i => parseFloat(meta(i).split('· ')[1]);
  // The average sets on accessory lifts (everything after the main lift) across next week's strength workouts.
  async function accessorySets(){
    go('week'); await wait(20);
    const all = [];
    for(let d=0; d<7; d++){
      const row = doc.querySelector(`.plan-row[data-week-idx="1"][data-day="${d}"]`);
      if(!row || !/Strength/.test(row.textContent)) continue;
      for(const t of ['pointerdown','pointerup']) row.dispatchEvent(new dom.window.PointerEvent(t, {bubbles:true}));
      await wait(20);
      [...doc.querySelectorAll('#wpExerciseList .wp-ex-rx')].slice(1).forEach(e=>{ const n = parseInt(e.textContent,10); if(!isNaN(n)) all.push(n); });
      doc.getElementById('closeWorkoutPreview').click(); await wait(10);
    }
    return all.length ? +(all.reduce((a,b)=>a+b,0)/all.length).toFixed(2) : null;
  }

  // ---- Adjust: two rows for a plan with both ----
  go('adjust'); await wait(20);
  console.log('A running + lifting plan shows Running intensity and Lifting intensity:',
    doc.getElementById('adjIntensityLabel').textContent==='Running intensity' && !doc.getElementById('adjLiftIntensitySection').hidden ? 'OK' : 'FAIL');
  console.log('...lifting follows running until it\'s set:', sel('adjLiftIntensityTabs')==='Moderate' ? 'OK' : `FAIL (${sel('adjLiftIntensityTabs')})`);
  const liftLabels = [...doc.querySelectorAll('#adjLiftIntensityTabs .s')].map(e=>e.textContent);
  console.log('...in lifting terms:', liftLabels.join()==='Lighter weights, fewer sets,Solid working sets,Heavier, more sets' ? 'OK' : `FAIL (${liftLabels})`);
  for(let i=0;i<2;i++) await slide('ArrowRight');
  console.log('Weights only: a single Intensity row, in lifting terms:', doc.getElementById('adjIntensityLabel').textContent==='Intensity' && doc.getElementById('adjLiftIntensitySection').hidden && /fewer sets/.test(doc.getElementById('adjIntensityTabs').textContent) ? 'OK' : 'FAIL');
  for(let i=0;i<4;i++) await slide('ArrowLeft');
  console.log('Running only: a single Intensity row:', doc.getElementById('adjIntensityLabel').textContent==='Intensity' && doc.getElementById('adjLiftIntensitySection').hidden ? 'OK' : 'FAIL');
  for(let i=0;i<2;i++) await slide('ArrowRight'); // back to balanced
  doc.getElementById('applyAdjust').click(); await wait(30);

  const baseSets = await accessorySets();
  go('week'); await wait(20);
  const baseMiles = miles(1);

  // ---- a powerlifter: lifting High, running Light ----
  go('adjust'); await wait(20);
  pick('adjIntensityTabs', 0);
  pick('adjLiftIntensityTabs', 2);
  console.log('Running Light and Lifting High, each on its own:', sel('adjIntensityTabs')==='Light' && sel('adjLiftIntensityTabs')==='High' ? 'OK' : `FAIL (${sel('adjIntensityTabs')} / ${sel('adjLiftIntensityTabs')})`);
  doc.getElementById('applyAdjust').click(); await wait(30);
  const saved = backend.profileUpdates[backend.profileUpdates.length-1];
  console.log('Saved to the profile:', saved && saved.intensity_idx===0 && saved.lift_intensity_idx===2 ? 'OK' : `FAIL (${saved && saved.intensity_idx} / ${saved && saved.lift_intensity_idx})`);
  go('week'); await wait(20);
  console.log('Running eases off (fewer miles):', miles(1) < baseMiles ? `OK (${baseMiles} -> ${miles(1)} mi)` : `FAIL (${baseMiles} -> ${miles(1)})`);
  const highSets = await accessorySets();
  console.log('...while lifting goes up (about a set more on accessory lifts):', highSets >= baseSets+0.75 ? `OK (${baseSets} -> ${highSets} sets on average)` : `FAIL (${baseSets} -> ${highSets})`);
  go('adjust'); await wait(20);
  console.log('Adjust shows both as set:', sel('adjIntensityTabs')==='Light' && sel('adjLiftIntensityTabs')==='High' ? 'OK' : 'FAIL');

  // ---- setup ----
  const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(50);
  const d2 = dom2.window.document;
  [...d2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'onb-intensity').click();
  await wait(20);
  d2.querySelector('#intensityList .option-card[data-idx="0"]').click();
  await wait(5);
  console.log('Setup (running + lifting plan): the cards are running\'s, with a Lifting intensity row:',
    !d2.getElementById('onbRunIntensityLabel').hidden && !d2.getElementById('onbLiftIntensitySection').hidden && (d2.querySelector('#onbLiftIntensityTabs .tab-btn.sel .t')||{}).textContent==='Light' ? 'OK' : 'FAIL');
  d2.querySelector('#onbLiftIntensityTabs .tab-btn[data-idx="2"]').click();
  await wait(5);
  console.log('...which can be set apart:', (d2.querySelector('#onbLiftIntensityTabs .tab-btn.sel .t')||{}).textContent==='High' && d2.querySelector('#intensityList .option-card.sel').getAttribute('data-idx')==='0' ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
