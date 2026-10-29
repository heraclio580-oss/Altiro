const fs = require('fs');
const path = require('path');

// An iPhone tester: tapping a box (a lift's weight, say) zoomed the page in, and it was hard to zoom back
// out. Safari on iPhone zooms in on any box whose text is under 16px, and Altiro's were 14px -- so on
// iPhone and iPad (only), every box's text is at least 16px. Android and computers keep 14px.
// (jsdom has no @supports, so this reads the stylesheet.)
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const css = file => [...fs.readFileSync(path.join(__dirname, '..', 'www', file), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=> m[1]).join('\n');
function iosBlock(text){
  const i = text.indexOf('@supports (-webkit-touch-callout: none)');
  if(i<0) return '';
  let depth = 0, j = text.indexOf('{', i);
  for(let k = j; k<text.length; k++){ if(text[k]==='{') depth++; else if(text[k]==='}' && --depth===0) return text.slice(j, k+1); }
  return '';
}
const app = iosBlock(css('index.html'));
check('The app: an iPhone-only rule for its boxes', !!app);
check('...text boxes, text areas and pickers at 16px or more', /input:not\(\[type="checkbox"\]\)[^{]*,\s*textarea,\s*select\{font-size:max\(16px,/.test(app), app);
check('...and still larger with a bigger text size', /max\(16px, calc\(14px \* var\(--fs, 1\)\)\)/.test(app));
check('Everywhere else the boxes stay 14px', /\.text-input\{[^}]*font-size:calc\(14px \* var\(--fs, 1\)\)/.test(css('index.html')));
check('The Delete account page too', /input\{font-size:16px;\}/.test(iosBlock(css('delete-account.html'))));
check('The app still lets the page be zoomed (no maximum-scale)', !/maximum-scale|user-scalable/.test(fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8').match(/<meta name="viewport"[^>]*>/)[0]));
console.log(failures ? `${failures} FAILED` : 'ALL DONE');
process.exit(failures ? 1 : 0);
