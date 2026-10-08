const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Settings -> Text size: three sizes; every font size in the app follows it (on this device), and it's
// remembered. The faintest grey is readable and trash buttons are a full finger wide.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

(async () => {
  const css = html.slice(0, html.indexOf('</style>'));
  const fixed = (css.match(/font-size:\s*\d+(\.\d+)?px/g) || []).length;
  check('Every font size in the stylesheet follows the text size', fixed===0, fixed+' fixed');
  // (The tutorial's miniature screens are meant to be tiny; the ring's label is the one small word left.)
  const rules = css.split('\n').filter(l=> !/^\.(tm-|tut-|th-ring-label)/.test(l));
  const smallest = Math.min(...rules.flatMap(l=> [...l.matchAll(/font-size:calc\((\d+(?:\.\d+)?)px/g)].map(m=> +m[1])));
  check('...and nothing is smaller than 9px', smallest>=9, smallest);
  check('The faintest grey is lighter (dark) and darker (light) than before', /--text-3:#9A9AA0;/.test(css) && /--text-3:#6B7079;/.test(css));
  check('Trash buttons are at least 40px to tap', /\.del\{[^}]*min-width:40px;min-height:40px;/.test(css));

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(50);
  const doc = dom.window.document, root = doc.documentElement;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'settings').click();
  await wait(20);
  const btns = [...doc.querySelectorAll('#textSizeToggle [data-text-size]')];
  check('Settings has Text size with three sizes, standard picked', btns.length===3 && btns[0].classList.contains('active') && root.style.getPropertyValue('--fs')==='1');
  btns[2].click();
  await wait(10);
  check('Picking the largest makes the text bigger', root.style.getPropertyValue('--fs')==='1.25' && btns[2].classList.contains('active') && !btns[0].classList.contains('active'));
  check('...and it\'s remembered', dom.window.localStorage.getItem('altiro_text_size')==='1.25');

  const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; w.localStorage.setItem('altiro_text_size', '1.12'); } });
  await wait(50);
  check('Opening the app again keeps the size', dom2.window.document.documentElement.style.getPropertyValue('--fs')==='1.12');
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
