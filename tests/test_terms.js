const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Training words get a small (i): tapping it explains the word in plain words, and only that -- it never
// also opens the card or row it sits in.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const flat = el => el ? el.textContent.replace(/\s+/g,' ').trim() : '';

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-16'; } });
  await wait(50);
  const doc = dom.window.document, ov = doc.getElementById('termOverlay');
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Plan: the week says Build or Deload, with an (i).
  go('week');
  await wait(30);
  const weekTip = doc.querySelector('.week-block-meta [data-term]');
  check('Plan: the week\'s Build/Deload label has an (i)', !!weekTip && /build|deload/.test(weekTip.dataset.term));
  check('...and it adds no text of its own', !/What/.test(flat(doc.querySelector('.week-block-meta'))));
  weekTip.click();
  await wait(10);
  check('Tapping it explains the word', !ov.hidden && /week/i.test(flat(doc.getElementById('termTitle'))) && flat(doc.getElementById('termText')).length > 40, flat(doc.getElementById('termTitle')));
  doc.getElementById('termOk').click();
  check('"Got it" closes it', ov.hidden);

  // Today: an (i) inside the card explains without opening the day.
  let found = null;
  for(const day of ['2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20']){
    const d2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = day; } });
    await wait(40);
    const doc2 = d2.window.document;
    [...doc2.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
    await wait(20);
    const tip = doc2.querySelector('#sessionCard [data-term]');
    if(tip){ found = {doc2, tip}; break; }
  }
  check('Today: a training word on the card has an (i)', !!found);
  if(found){
    const {doc2, tip} = found;
    tip.click();
    await wait(10);
    check('...tapping it explains it', !doc2.getElementById('termOverlay').hidden && flat(doc2.getElementById('termText')).length > 40);
    check('...without opening the day or a lift', doc2.getElementById('dayDetailOverlay').hidden && doc2.getElementById('workoutPreviewOverlay')?.hidden !== false);
  }

  // In Spanish.
  go('settings');
  await wait(10);
  doc.querySelector('.lang-btn[data-lang="es"]').click();
  await wait(20);
  go('week');
  await wait(20);
  doc.querySelector('.week-block-meta [data-term]').click();
  await wait(10);
  check('In Spanish too', /Semana de (progresión|descarga)/.test(flat(doc.getElementById('termTitle'))) && doc.getElementById('termOk').textContent==='Entendido', flat(doc.getElementById('termTitle')));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
