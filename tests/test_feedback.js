const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Settings -> "Send us feedback": a topic, how the plan feels, a message -- saved to the `feedback`
// table with the user's email and a snapshot of their plan setup. Saying the plan feels too hard (or
// too easy) offers to adjust it right away.
function makeBackend(opts){
  const inserts = [];
  function from(table){
    let op = 'select', payload = null;
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; },
      insert(p){ op = 'insert'; payload = p; return api; }, update(){ op = 'update'; return api; }, upsert(){ return api; }, delete(){ return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, level:'beginner', weekly_miles:8, equipment:'dumbbells', plan_start:'2026-09-07'} : null, error:null}); },
      then(res, rej){
        if(op==='insert' && table==='feedback'){
          if(opts.failFeedback) return Promise.resolve({data:null, error:{message:'relation "feedback" does not exist'}}).then(res, rej);
          inserts.push(payload);
        }
        return Promise.resolve({data: op==='select' ? [] : null, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { inserts, createClient: () => ({
    auth: {
      onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
      async getSession(){ return opts.signedOut ? {data:{session:null}} : {data:{session:{user:{id:'u1', email:'runner@example.com'}}}}; },
      async signOut(){ return {error:null}; },
    },
    from,
  })};
}
function open(backend){
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(window){ window.supabase = { createClient: () => backend.createClient() }; window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
}

(async () => {
  const backend = makeBackend({});
  const dom = open(backend);
  await wait(200);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const click = async sel => { doc.querySelector(sel).click(); await wait(20); };
  const type = (text) => { const el = doc.getElementById('feedbackMessageInput'); el.value = text; el.dispatchEvent(new dom.window.Event('input', {bubbles:true})); };

  go('settings');
  await wait(20);
  console.log('Settings has a Send us feedback button:', /Send us feedback/.test(doc.getElementById('openFeedbackBtn').textContent) ? 'OK' : 'FAIL');
  await click('#openFeedbackBtn');
  console.log('...which opens the feedback sheet:', !doc.getElementById('feedbackOverlay').hidden && !doc.getElementById('feedbackForm').hidden ? 'OK' : 'FAIL');
  console.log('...with topics and how the plan feels:',
    doc.querySelectorAll('#feedbackTopicChips .chip').length===4 && doc.querySelectorAll('#feedbackFeelChips .chip').length===3 ? 'OK' : 'FAIL');
  console.log('Send is disabled until there\'s something to send:', doc.getElementById('sendFeedbackBtn').disabled ? 'OK' : 'FAIL');

  await click('#feedbackTopicChips .chip[data-key="plan"]');
  await click('#feedbackFeelChips .chip[data-key="too_hard"]');
  type('The long runs are a lot right now.');
  await wait(5);
  console.log('...enabled once it has a message:', !doc.getElementById('sendFeedbackBtn').disabled ? 'OK' : 'FAIL');
  await click('#sendFeedbackBtn');
  await wait(20);

  const row = backend.inserts[0];
  console.log('It\'s saved with topic, feel, message and who sent it:',
    row && row.category==='plan' && row.plan_feel==='too_hard' && row.message==='The long runs are a lot right now.' && row.user_id==='u1' && row.email==='runner@example.com' ? 'OK' : `FAIL (${JSON.stringify(row)})`);
  console.log('...plus a snapshot of their plan setup:',
    row && row.context.level==='beginner' && row.context.weekly_miles===8 && row.context.equipment==='dumbbells' && JSON.stringify(row.context.training_days)==='[0,2,4]' && row.context.plan_week===2 && row.context.platform==='web'
      ? 'OK' : `FAIL (${row && JSON.stringify(row.context)})`);
  console.log('The sheet says thanks:', !doc.getElementById('feedbackThanks').hidden && doc.getElementById('feedbackForm').hidden ? 'OK' : 'FAIL');
  console.log('"Too hard" offers to adjust the plan:', !doc.getElementById('feedbackAdjustCard').hidden && /too much/.test(doc.getElementById('feedbackAdjustMsg').textContent) ? 'OK' : 'FAIL');
  await click('#feedbackAdjustBtn');
  console.log('...and Adjust my plan opens Adjust Plan:', doc.getElementById('feedbackOverlay').hidden && !doc.getElementById('adjustOverlay').hidden ? 'OK' : 'FAIL');
  doc.getElementById('closeAdjust').click();
  await wait(10);

  // A plain message with no feel: sent, no adjust offer.
  go('settings');
  await wait(10);
  await click('#openFeedbackBtn');
  console.log('Reopening starts fresh:', doc.getElementById('feedbackMessageInput').value==='' && !doc.querySelector('#feedbackTopicChips .chip.sel') ? 'OK' : 'FAIL');
  type('Love the calendar view!');
  await click('#sendFeedbackBtn');
  await wait(20);
  console.log('A message with no topic is sent as "other", with no adjust offer:',
    backend.inserts[1] && backend.inserts[1].category==='other' && backend.inserts[1].plan_feel===null && doc.getElementById('feedbackAdjustCard').hidden ? 'OK' : `FAIL (${JSON.stringify(backend.inserts[1])})`);
  await click('#feedbackDoneBtn');
  console.log('Done closes it:', doc.getElementById('feedbackOverlay').hidden ? 'OK' : 'FAIL');

  // ---- the table isn't there yet: a clear error, nothing lost ----
  const failing = makeBackend({failFeedback:true});
  const dom2 = open(failing);
  await wait(200);
  const doc2 = dom2.window.document;
  [...doc2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click();
  await wait(10);
  doc2.getElementById('openFeedbackBtn').click();
  await wait(10);
  const input = doc2.getElementById('feedbackMessageInput');
  input.value = 'Hello'; input.dispatchEvent(new dom2.window.Event('input', {bubbles:true}));
  doc2.getElementById('sendFeedbackBtn').click();
  await wait(30);
  console.log('If sending fails, it says so and keeps the message to retry:',
    !doc2.getElementById('feedbackError').hidden && !doc2.getElementById('feedbackForm').hidden && input.value==='Hello' && !doc2.getElementById('sendFeedbackBtn').disabled ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
