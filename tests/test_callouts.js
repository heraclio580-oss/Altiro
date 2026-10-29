const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Things people otherwise miss are outlined in the accent: Create Workout's "Log as you go", "Create my
// own workouts" (in Adjust, and when first setting up), and the wrench that opens Adjust on every screen.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=> m[1]).join('\n');
const doc = new JSDOM(html).window.document;
check('The outline rule', /\.toggle-row\.callout\{border-color:var\(--accent\);\}/.test(css));
check('"Log as you go" is outlined', !!doc.querySelector('#createLiveSection .toggle-row.callout #createLiveToggle'));
check('"Create my own workouts" in Adjust is outlined', !!doc.querySelector('#adjOwnSection .toggle-row.callout #adjOwnToggle'));
check('...and when first setting up', !!(doc.getElementById('onbOwnToggle') && doc.getElementById('onbOwnToggle').closest('.toggle-row.callout')));
check('The wrench is outlined', /\.iconbtn\[data-open-adjust\]\{border-color:var\(--accent\);\}/.test(css));
check('...on all four screens', doc.querySelectorAll('.iconbtn[data-open-adjust]').length===4, doc.querySelectorAll('.iconbtn[data-open-adjust]').length);
console.log(failures ? `${failures} FAILED` : 'ALL DONE');
process.exit(failures ? 1 : 0);
