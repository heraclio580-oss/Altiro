const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Users never see the prototype navigator above the app; a developer can bring it back with ?proto.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}
(async () => {
  for(const [url, shown] of [['https://example.com/', false], ['https://example.com/?proto', true]]){
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url, beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
    await wait(50);
    const w = dom.window, nav = w.document.querySelector('.proto-nav');
    const display = w.getComputedStyle(nav).display;
    check(shown ? 'With ?proto, the navigator shows' : 'The prototype navigator is hidden', shown ? display==='flex' : display==='none', display);
    w.close();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
