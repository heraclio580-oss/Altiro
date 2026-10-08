const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Every exercise in the library says how it's done: with its picture and steps when it has a demo, or just
// its three steps when it doesn't yet -- in English and Spanish.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

(async () => {
  // The library: every exercise has steps, from its demo or its own.
  const lib = html.slice(html.indexOf('const EXERCISES = {'), html.indexOf('const MOBILITY_EXERCISES'));
  const keys = [...lib.matchAll(/^  '([^']+)': \{en:/gm)].map(m=>m[1]);
  const howBlock = html.slice(html.indexOf('const HOWTO = {'), html.indexOf('const hasDemo'));
  const how = new Set([...howBlock.matchAll(/^  '([^']+)': \{en:/gm)].map(m=>m[1]));
  const moves = new Set([...html.slice(html.indexOf('const MOVES = {'), html.indexOf('const DEMO_PHOTOS')).matchAll(/^  '([^']+)': \{\n    cues/gm)].map(m=>m[1]));
  const photoCues = new Set([...html.slice(html.indexOf('const DEMO_PHOTOS'), html.indexOf('const HOWTO = {')).matchAll(/\['([^']+)', \{[^\]]*cues:/g)].map(m=>m[1]));
  const missing = keys.filter(k=> !how.has(k) && !moves.has(k) && !photoCues.has(k));
  check(`All ${keys.length} exercises in the library have how-to steps`, keys.length>100 && !missing.length, missing.join(', '));
  const bad = [...howBlock.matchAll(/^  '([^']+)': \{en:\[(.*?)\],\n    es:\[(.*?)\]\}/gms)].filter(m=> (m[2].match(/', '|", '|', "/g)||[]).length!==2 || (m[3].match(/', '|", '|', "/g)||[]).length!==2).map(m=>m[1]);
  check('...three steps each, in English and Spanish', !bad.length && how.size>=100, bad.join(', '));

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(50);
  const doc = dom.window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  // A workout with one exercise that has a picture (Back Squat) and one that doesn't (Goblet Squat).
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Legs';
  doc.getElementById('manualNameInput').dispatchEvent(new dom.window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
  let row = doc.querySelector('#createExercisesList .exercise-edit-row');
  row.querySelector('.ex-name').value = 'Goblet Squat'; row.querySelector('.ex-sets').value = '3'; row.querySelector('.ex-reps').value = '10';
  doc.getElementById('addExerciseRow')?.click();
  const rows = doc.querySelectorAll('#createExercisesList .exercise-edit-row');
  if(rows[1]){ rows[1].querySelector('.ex-name').value = 'Back Squat'; rows[1].querySelector('.ex-sets').value = '3'; rows[1].querySelector('.ex-reps').value = '5'; }
  doc.getElementById('saveManualEntry').click();
  await wait(30);
  if(!doc.getElementById('dayDetailOverlay').hidden) doc.getElementById('closeDayDetail').click();
  doc.querySelector('#homeExtraWorkoutsWrap [data-start-extra]').click();
  await wait(30);
  const goblet = doc.querySelector('#logPerfExercisesList [data-exercise-key="Goblet Squat"]');
  const btn = goblet && goblet.querySelector('[data-demo]');
  check('Logging it: an exercise without a picture has a "How to" button', !!btn && btn.classList.contains('howto') && /How to/.test(btn.textContent));
  btn.click();
  await wait(20);
  const ov = doc.getElementById('moveDemoOverlay');
  const cues = [...doc.querySelectorAll('#mdCues li')].map(li=>li.textContent);
  check('...it opens its three steps, with no empty picture or play buttons', !ov.hidden && cues.length===3 && /chest/.test(cues[0]) && doc.getElementById('mdStage').hidden && doc.querySelector('#moveDemoOverlay .md-controls').hidden, cues.join(' / '));
  check('...titled with the exercise', /Goblet Squat/.test(doc.getElementById('mdTitle').textContent));
  doc.getElementById('closeMoveDemo').click();
  const squat = doc.querySelector('#logPerfExercisesList [data-exercise-key="Back Squat"] [data-demo]');
  if(squat){
    squat.click();
    await wait(20);
    check('One with a picture still shows it, with its play buttons', !doc.getElementById('mdStage').hidden && !!doc.querySelector('#mdStage svg, #mdStage img') && !doc.querySelector('#moveDemoOverlay .md-controls').hidden);
    doc.getElementById('closeMoveDemo').click();
  }
  // Spanish.
  doc.getElementById('closeLogPerf').click();
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click();
  doc.querySelector('.lang-btn[data-lang="es"]').click();
  await wait(20);
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  doc.querySelector('#homeExtraWorkoutsWrap [data-start-extra]').click();
  await wait(30);
  doc.querySelector('#logPerfExercisesList [data-exercise-key="Goblet Squat"] [data-demo]').click();
  await wait(20);
  check('In Spanish too', /pecho/.test(doc.querySelector('#mdCues li').textContent), doc.querySelector('#mdCues li').textContent);
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
