const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// A runner can enter a recent mile time; their easy, long, tempo and interval paces are worked out
// from it -- as shares of the mile's speed: tempo 85-90%, easy under 80% -- instead of from the intensity
// setting alone.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
const secs = str => { const m = String(str).match(/(\d+):(\d\d)/); return m ? +m[1]*60 + +m[2] : null; };

// A signed-in account, so the profile save can be checked.
function makeBackend(){
  const profileUpdates = [];
  function from(table){
    let op = 'select', payload = null;
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ return api; },
      update(p){ op = 'update'; payload = p; return api; }, upsert(p){ op = 'upsert'; payload = p; return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[1,3,5,6], focus_ratio:0, intensity_idx:1, level:'intermediate', weekly_miles:15, plan_start:'2026-09-14'} : null, error:null}); },
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
      async getSession(){ return {data:{session:{user:{id:'u1', email:'runner@example.com'}}}}; },
      async signOut(){ return {error:null}; },
    },
    from,
  })};
}

(async () => {
  const backend = makeBackend();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){ window.supabase = { createClient: () => backend.createClient() }; window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  const { window } = dom;
  await wait(200);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const type = (id, v) => { const el = doc.getElementById(id); el.value = String(v); el.dispatchEvent(new window.Event('input', {bubbles:true})); };
  const tap = async (w, d) => {
    const row = doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`);
    for(const t of ['pointerdown','pointerup']) row.dispatchEvent(new window.PointerEvent(t, {bubbles:true}));
    await wait(20);
  };
  async function previewFirst(title){
    for(let w=1; w<4; w++) for(let d=0; d<7; d++){
      const row = doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`);
      if(row && row.textContent.includes(title)){ await tap(w, d); return true; }
    }
    return false;
  }

  go('adjust');
  await wait(20);
  const section = doc.getElementById('adjMileSection');
  console.log('Adjust asks for a mile time (optional):', !section.hidden && /mile time \(optional\)/i.test(section.textContent) ? 'OK' : `FAIL (${section.hidden})`);
  type('adjMileMinInput', 7); type('adjMileSecInput', '00');
  const paces = doc.getElementById('adjMilePaces').textContent;
  const [easy, tempoFast, tempoSlow, interval] = (paces.match(/\d+:\d\d/g)||[]).map(secs);
  console.log('A 7:00 mile: tempo at 85-90% of its speed (7:47-8:14), easy under 80% (9:20), intervals ~7:22:',
    tempoFast===467 && tempoSlow===494 && easy===560 && easy > 420/0.8 && interval===442 ? `OK (${paces})` : `FAIL (${paces})`);
  type('adjMileMinInput', 10);
  const ten = (doc.getElementById('adjMilePaces').textContent.match(/\d+:\d\d/g)||[]).map(secs);
  console.log('A 10:00 mile: tempo 11:07-11:46, easy 13:20 (slower than the 12:30 that 80% would be):',
    ten[1]===667 && ten[2]===706 && ten[0]===800 ? `OK (${doc.getElementById('adjMilePaces').textContent})` : `FAIL (${doc.getElementById('adjMilePaces').textContent})`);
  type('adjMileMinInput', 7);
  doc.querySelector('#adjMilesChips .chip[data-key="0"]').click();
  await wait(5);
  console.log('...not asked of someone new to running (they go by feel):', section.hidden ? 'OK' : 'FAIL');
  doc.querySelector('#adjMilesChips .chip[data-key="15"]').click();
  await wait(5);
  console.log('...and it kept what they typed:', doc.getElementById('adjMileMinInput').value==='7' && !section.hidden ? 'OK' : 'FAIL');
  doc.getElementById('applyAdjust').click();
  await wait(30);
  const saved = backend.profileUpdates[backend.profileUpdates.length-1];
  console.log('Saved to the profile:', saved && saved.mile_time_sec===420 ? 'OK' : `FAIL (${saved && saved.mile_time_sec})`);

  // ---- the plan's paces follow it ----
  go('week');
  await wait(20);
  await previewFirst('Easy Run');
  const easyTarget = secs(doc.getElementById('wpPace').textContent);
  console.log('An easy run\'s target pace comes from the mile time:', Math.abs(easyTarget-easy)<=2 ? `OK (${doc.getElementById('wpPace').textContent})` : `FAIL (${doc.getElementById('wpPace').textContent} vs ${easy})`);
  doc.getElementById('closeWorkoutPreview').click();
  await wait(10);
  await previewFirst('Long Run');
  const longTarget = secs(doc.getElementById('wpPace').textContent);
  console.log('...a long run a touch slower than easy:', longTarget>easyTarget && longTarget-easyTarget<=30 ? `OK (${doc.getElementById('wpPace').textContent})` : `FAIL (${longTarget} vs ${easyTarget})`);
  doc.getElementById('closeWorkoutPreview').click();
  await wait(10);
  const found = await previewFirst('Tempo Run') || await previewFirst('Interval Run');
  const main = [...doc.querySelectorAll('#wpBreakdown .wp-ex')][1];
  const mainPace = main && secs(main.querySelector('.wp-ex-rx').textContent.split('·')[1]);
  const wantMain = /Tempo/.test(doc.getElementById('wpTitle').textContent) ? tempoFast : interval;
  console.log('...and the fast part of a quality run too:', found && Math.abs(mainPace-wantMain)<=2 ? `OK (${doc.getElementById('wpTitle').textContent}: ${main.querySelector('.wp-ex-rx').textContent})` : `FAIL (${main && main.textContent} vs ${wantMain})`);
  doc.getElementById('closeWorkoutPreview').click();
  await wait(10);

  // ---- a faster mile moves every pace ----
  go('adjust');
  await wait(20);
  console.log('Adjust shows the saved mile time:', doc.getElementById('adjMileMinInput').value==='7' && doc.getElementById('adjMileSecInput').value==='00' ? 'OK' : 'FAIL');
  type('adjMileMinInput', 6); type('adjMileSecInput', 30);
  doc.getElementById('applyAdjust').click();
  await wait(30);
  go('week');
  await wait(20);
  await previewFirst('Easy Run');
  const faster = secs(doc.getElementById('wpPace').textContent);
  console.log('A faster mile (6:30) makes the easy pace faster:', faster < easyTarget ? `OK (${doc.getElementById('wpPace').textContent})` : `FAIL (${faster} vs ${easyTarget})`);
  doc.getElementById('closeWorkoutPreview').click();

  // ---- weights only: no mile time ----
  go('adjust');
  await wait(20);
  for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  await wait(10);
  console.log('Not asked on a weights-only plan:', doc.getElementById('adjMileSection').hidden ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
