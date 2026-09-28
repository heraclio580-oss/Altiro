const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Each calendar day shows its workout in brief -- a short name and its amount ("Long / 6 mi",
// "Full Body / 45 min"), "+1" when the day holds more, nothing on a rest day -- in the app's language.
(async () => {
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const cell = key => doc.querySelector(`.mo-cell[data-date="${key}"]`);
  const title = key => { const el = cell(key).querySelector('.mo-desc-t'); return el ? el.textContent : ''; };
  const amount = key => { const el = cell(key).querySelector('.mo-desc-a'); return el ? el.textContent : ''; };

  go('calendar');
  await wait(20);
  // Next week on the default Mon/Wed/Fri balanced plan.
  const training = ['2026-09-21','2026-09-23','2026-09-25'], rest = ['2026-09-22','2026-09-24','2026-09-26','2026-09-27'];
  const known = ['Easy','Long','Tempo','Intervals','Fartlek','Hills','Strides','Full Body','Upper','Lower','Push','Pull'];
  console.log('Every training day shows a short workout name:', training.every(k=>known.includes(title(k))) ? `OK (${training.map(title).join(', ')})` : `FAIL (${training.map(title)})`);
  console.log('...and its amount (miles or minutes):', training.every(k=>/^\d+(\.5)? (mi|min)$/.test(amount(k))) ? `OK (${training.map(amount).join(', ')})` : `FAIL (${training.map(amount)})`);
  console.log('Rest days show nothing:', rest.every(k=>title(k)==='' && amount(k)==='') ? 'OK' : `FAIL (${rest.map(title)})`);
  console.log('The date and status dot are still there:', cell('2026-09-21').querySelector('.mo-num').textContent==='21' && cell('2026-09-21').querySelector('.mo-dot') ? 'OK' : 'FAIL');

  // A second workout on a day adds "+1".
  cell('2026-09-16').click(); // Wednesday, past -- log a second workout alongside a first
  await wait(20);
  for(const name of ['Morning Lift','Evening Stretch']){
    doc.getElementById('addWorkoutBtn').click();
    await wait(20);
    [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='strength').click();
    if(!doc.getElementById('createCompletedToggle').classList.contains('on')) doc.getElementById('createCompletedToggle').click();
    doc.getElementById('manualNameInput').value = name;
    doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
    doc.getElementById('saveManualEntry').click();
    await wait(20);
  }
  doc.getElementById('closeDayDetail').click();
  await wait(10);
  console.log('A logged workout shows its own name, and "+1" for the second:', title('2026-09-16')==='Morning Lift' && /\+1$/.test(amount('2026-09-16')) ? 'OK' : `FAIL (${title('2026-09-16')} / ${amount('2026-09-16')})`);

  // In Spanish.
  go('settings');
  await wait(10);
  doc.querySelector('.lang-btn[data-lang="es"]').click();
  await wait(10);
  go('calendar');
  await wait(20);
  const esKnown = ['Suave','Larga','Tempo','Series','Fartlek','Cuestas','Progres.','Cuerpo compl.','Superior','Inferior','Empuje','Tracción'];
  console.log('Short names follow the language:', training.every(k=>esKnown.includes(title(k))) ? `OK (${training.map(title).join(', ')})` : `FAIL (${training.map(title)})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
