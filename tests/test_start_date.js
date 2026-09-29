const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Users choose when their plan starts -- today, tomorrow, next Monday or a date -- in setup and in
// Adjust. Nothing is planned before that day, and the plan's week 1 is the week it starts.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

function makeBackend(){
  const profileUpdates = [];
  function from(table){
    let op = 'select', payload = null;
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ return api; },
      update(p){ op = 'update'; payload = p; return api; }, upsert(p){ op = 'upsert'; payload = p; return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, level:'intermediate', weekly_miles:15, equipment:'gym', plan_start:'2026-09-07'} : null, error:null}); },
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
      async getSession(){ return {data:{session:{user:{id:'u1', email:'athlete@example.com'}}}}; },
      async signOut(){ return {error:null}; },
    },
    from,
  })};
}

(async () => {
  // ---- setup: the Days step asks ----
  const dom0 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(50);
  const d0 = dom0.window.document;
  const chips0 = [...d0.querySelectorAll('#onbStartChips .chip')].map(c=>c.textContent);
  console.log('Setup asks when to start: Today, Tomorrow, Next Monday, Pick a date:', chips0.join()==='Today,Tomorrow,Next Monday,Pick a date' ? 'OK' : `FAIL (${chips0})`);
  console.log('...Today by default:', (d0.querySelector('#onbStartChips .chip.sel')||{}).textContent==='Today' && /Friday, Sep 18/.test(d0.getElementById('onbStartNote').textContent) ? 'OK' : `FAIL (${d0.getElementById('onbStartNote').textContent})`);
  [...d0.querySelectorAll('#onbStartChips .chip')].find(c=>c.textContent==='Pick a date').click();
  await wait(5);
  const dateEl = d0.getElementById('onbStartDate');
  console.log('"Pick a date" shows a date picker, from today on:', !dateEl.hidden && dateEl.min==='2026-09-18' ? 'OK' : `FAIL (${dateEl.hidden} ${dateEl.min})`);
  dateEl.value = '2026-10-05'; dateEl.dispatchEvent(new dom0.window.Event('input', {bubbles:true}));
  await wait(5);
  console.log('...and says when the plan will start:', d0.getElementById('onbStartNote').textContent==='Your plan starts Monday, Oct 5.' ? 'OK' : `FAIL (${d0.getElementById('onbStartNote').textContent})`);

  // ---- Adjust: start the plan next Monday ----
  const backend = makeBackend();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(200);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  go('adjust');
  await wait(20);
  const chips = [...doc.querySelectorAll('#adjStartChips .chip')].map(c=>c.textContent);
  console.log('Adjust offers Keep my plan, Today, Next Monday, Pick a date:', chips.join()==='Keep my plan,Today,Next Monday,Pick a date' ? 'OK' : `FAIL (${chips})`);
  console.log('...keeping the plan by default:', (doc.querySelector('#adjStartChips .chip.sel')||{}).textContent==='Keep my plan' && /started Monday, Sep 7/.test(doc.getElementById('adjStartNote').textContent) ? 'OK' : `FAIL (${doc.getElementById('adjStartNote').textContent})`);
  [...doc.querySelectorAll('#adjStartChips .chip')].find(c=>c.textContent==='Next Monday').click();
  await wait(5);
  console.log('Next Monday: "starts over Monday, Sep 21"', /starts over Monday, Sep 21/.test(doc.getElementById('adjStartNote').textContent) ? 'OK' : `FAIL (${doc.getElementById('adjStartNote').textContent})`);
  doc.getElementById('applyAdjust').click();
  await wait(30);
  const saved = backend.profileUpdates[backend.profileUpdates.length-1];
  console.log('Saved to the profile (start day and its week):', saved && saved.plan_start_date==='2026-09-21' && saved.plan_start==='2026-09-21' ? 'OK' : `FAIL (${saved && saved.plan_start_date} ${saved && saved.plan_start})`);

  go('home');
  await wait(20);
  const card = doc.getElementById('sessionCard').textContent.replace(/\s+/g,' ');
  console.log('Today (Friday) has nothing planned; it says when the plan starts:', /Rest Day/.test(card) && /Plan starts Monday, Sep 21/.test(card) ? 'OK' : `FAIL (${card.slice(0,120)})`);
  go('week');
  await wait(20);
  const row = (w,d) => doc.querySelector(`.plan-row[data-week-idx="${w}"][data-day="${d}"]`).textContent.replace(/\s+/g,' ');
  console.log('...nor on the weekend before it:', /Rest Day/.test(row(0,5)) && /Rest Day/.test(row(0,6)) ? 'OK' : `FAIL (${row(0,5)} | ${row(0,6)})`);
  console.log('The plan begins Monday the 21st:', !/Rest Day/.test(row(1,0)) ? `OK (${row(1,0).slice(0,40)})` : `FAIL (${row(1,0)})`);
  const meta = i => { const el = doc.querySelector(`.week-block[data-week-idx="${i}"] .week-block-meta`); return el ? el.textContent : ''; };
  // (it used to be in week 3 of a plan started Sep 7, whose deload would have fallen on Sep 28)
  console.log('...as week 1 of the plan: three build weeks ahead, no deload yet:', [1,2,3].every(i=>/^Build week/.test(meta(i))) ? 'OK' : `FAIL (${[1,2,3].map(meta).join(' | ')})`);

  // ---- a date a couple of weeks out ----
  go('adjust');
  await wait(20);
  [...doc.querySelectorAll('#adjStartChips .chip')].find(c=>c.textContent==='Pick a date').click();
  await wait(5);
  const adjDate = doc.getElementById('adjStartDate');
  adjDate.value = '2026-10-07'; adjDate.dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  await wait(5);
  doc.getElementById('applyAdjust').click();
  await wait(30);
  go('week');
  await wait(20);
  console.log('Weeks before a later start say when it begins:', meta(1)==='Plan starts Wednesday, Oct 7' ? 'OK' : `FAIL (${meta(1)})`);
  console.log('...and its first days stay open until then:', /Rest Day/.test(row(3,0)) && /Rest Day/.test(row(3,1)) && !/Rest Day/.test(row(3,2)) ? 'OK' : `FAIL (${[0,1,2].map(d=>row(3,d).slice(0,30)).join(' | ')})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
