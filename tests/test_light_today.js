const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Light mode (green or lilac): today's day on Plan stands out -- its highlight is the accent every workout
// already has, so today also gets a tinted, outlined card, its date in a filled circle, and a Today tag
// (on a rest day too). Dark mode's blue today is left as it was. (jsdom has no layout: this checks the
// rules and the tag.)
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=> m[1]).join('\n');
(async () => {
  check('Light mode: today\'s card tinted and outlined in the accent', /#device\[data-theme="light"\] \.plan-row\.today \.prow-pill\{background:linear-gradient\(0deg,var\(--accent-tint\)[^}]*box-shadow:inset 0 0 0 1\.5px var\(--accent\)/.test(css));
  check('...its date in a filled accent circle', /#device\[data-theme="light"\] \.plan-row\.today \.prow-num\{[^}]*border-radius:50%;background:var\(--accent\);color:#FFFFFF/.test(css));
  check('...a solid Today tag', /#device\[data-theme="light"\] \.prow-status\.today\{color:#FFFFFF;background:var\(--accent\)/.test(css));
  check('The extra tag is light mode only', /\.prow-status\.light-only\{display:none;\}/.test(css) && /#device\[data-theme="light"\] \.prow-status\.light-only\{display:flex;\}/.test(css));
  // Today (Sunday, Nov 1) is a rest day on the default plan.
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-11-01'; } });
  await wait(50);
  const doc = dom.window.document;
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'week').click();
  await wait(30);
  const row = doc.querySelector('#weekList .plan-row.today');
  check('A rest day today still gets the Today tag', !!row && /rest/.test(row.className + row.querySelector('.prow-pill').className) && !!row.querySelector('.prow-status.today.light-only'), row && row.className);
  check('...and only today does', doc.querySelectorAll('#weekList .prow-status.today').length===1);
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
