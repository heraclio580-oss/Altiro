const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Settings -> Appearance: with Light Mode on, a Color choice -- Green (Altiro's) or Lilac -- kept on the
// device. Dark mode has no choice.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

check('Lilac has its own light colors', /#device\[data-theme="light"\]\[data-accent="lilac"\]\{[^}]*--accent:#7650B8/.test(html));
(async () => {
  const open = async (store)=>{
    const dom = new JSDOM(html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/',
      beforeParse(w){ Object.entries(store || {}).forEach(([k, v])=> w.localStorage.setItem(k, v)); }});
    await wait(50);
    const doc = dom.window.document;
    [...doc.querySelectorAll('.proto-pill')].find(p=> p.dataset.navId==='settings').click(); await wait(20);
    return {dom, doc};
  };
  let {dom, doc} = await open();
  const dev = ()=> doc.getElementById('device');
  check('Dark mode: no color choice', doc.getElementById('accentRow').hidden && dev().getAttribute('data-theme')==='dark');
  doc.getElementById('themeToggle').click(); await wait(10);
  check('Light Mode on: Color, Green or Lilac (Green picked)', !doc.getElementById('accentRow').hidden && doc.querySelector('[data-accent-pick="green"]').classList.contains('on')
    && /Green/.test(doc.getElementById('accentRow').textContent) && /Lilac/.test(doc.getElementById('accentRow').textContent));
  doc.querySelector('[data-accent-pick="lilac"]').click(); await wait(10);
  check('Lilac: the app turns lilac, and remembers it', dev().getAttribute('data-accent')==='lilac' && dev().getAttribute('data-theme')==='light'
    && dom.window.localStorage.getItem('altiro_accent')==='lilac' && doc.querySelector('[data-accent-pick="lilac"]').getAttribute('aria-pressed')==='true');
  const store = {altiro_theme: dom.window.localStorage.getItem('altiro_theme'), altiro_accent: 'lilac'};
  dom.window.close();
  ({dom, doc} = await open(store));
  check('Opened again: still light, in lilac', dev().getAttribute('data-theme')==='light' && dev().getAttribute('data-accent')==='lilac' && doc.querySelector('[data-accent-pick="lilac"]').classList.contains('on'));
  doc.getElementById('themeToggle').click(); await wait(10);
  check('Back to dark: the choice hides (dark mode looks as always)', dev().getAttribute('data-theme')==='dark' && doc.getElementById('accentRow').hidden);
  doc.getElementById('themeToggle').click(); await wait(10);
  check('...and light again comes back in lilac', dev().getAttribute('data-accent')==='lilac' && !doc.getElementById('accentRow').hidden);
  [...doc.querySelectorAll('.lang-btn[data-lang="es"]')][0].click(); await wait(20);
  check('In Spanish: Verde, Lila', /Verde/.test(doc.getElementById('accentRow').textContent) && /Lila/.test(doc.getElementById('accentRow').textContent));
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
