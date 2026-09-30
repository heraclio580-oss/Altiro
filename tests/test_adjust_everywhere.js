const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The adjust-plan wrench sits in the top-right corner of Today, Plan, Progress and Calendar, so the plan
// can be changed from wherever the user is. Applying a change keeps them on the page they were on.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

(async () => {
  await wait(50);
  const doc = window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const overlay = doc.getElementById('adjustOverlay');

  for(const [id, name] of [['home','Today'], ['week','Plan'], ['progress','Progress'], ['calendar','Calendar']]){
    go(id); await wait(20);
    const btn = doc.querySelector(`#screen-${id} [data-open-adjust]`);
    check(`${name}: a wrench button`, !!btn);
    if(!btn) continue;
    const bar = btn.parentElement;
    check(`...in the top-right corner`, bar.lastElementChild===btn && (id==='home' || /space-between/.test(bar.getAttribute('style')||'')));
    btn.click(); await wait(10);
    check(`...that opens Adjust`, overlay.hidden===false);
    doc.getElementById('closeAdjust').click(); await wait(10);
    check(`...and closing it leaves you on ${name}`, overlay.hidden && !doc.getElementById(`screen-${id}`).hidden);
  }

  // Apply a change from the calendar: the calendar redraws with the new plan, and you stay there.
  go('calendar'); await wait(20);
  doc.getElementById('calNext').click(); await wait(10);
  const cell = () => doc.querySelector('.mo-cell[data-date="2026-10-05"]').textContent.replace(/\s+/g,' ').trim();
  const before = cell();
  doc.querySelector('#screen-calendar [data-open-adjust]').click(); await wait(10);
  for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  doc.getElementById('applyAdjust').click(); await wait(20);
  check('Applying from the Calendar keeps you on the Calendar', !doc.getElementById('screen-calendar').hidden && overlay.hidden);
  check('...and the calendar shows the new plan', cell()!==before, `${before} -> ${cell()}`);

  go('progress'); await wait(20);
  doc.querySelector('#screen-progress [data-open-adjust]').click(); await wait(10);
  doc.getElementById('applyAdjust').click(); await wait(20);
  check('Applying from Progress keeps you on Progress', !doc.getElementById('screen-progress').hidden && overlay.hidden);

  check('The tour mentions the wrench on every page', doc.querySelector('[data-i18n="tourNavB"]').textContent.includes('Today, Plan, Progress or Calendar'));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
