const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The Android test app doesn't update itself (it's installed from the android-test release, not a
// store). It compares its own code's fingerprint with the one the website's version.json lists and,
// when they differ, offers a Download of the newer build. Up to date, or the website: no such bar.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

async function open(opts){
  const fetched = [];
  const dom = new JSDOM(opts.stamp ? html.replace("'__ALTIRO_APK_ID__'", `'${opts.stamp}'`) : html, {runScripts:'dangerously', pretendToBeVisual:true, url:'https://localhost/',
    beforeParse(w){
      if(opts.native) w.Capacitor = {isNativePlatform: ()=> true, Plugins: {}};
      w.fetch = async (url)=>{ fetched.push(String(url)); return {ok:true, json: async()=> ({build:'x', apk: opts.latest})}; };
    }});
  await wait(50);
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
  await wait(50);
  return {dom, doc: dom.window.document, fetched};
}
(async () => {
  {
    const {dom, doc, fetched} = await open({native:true, stamp:'aaa111', latest:'bbb222'});
    check('A test app older than the latest build asks the website which build is latest', fetched.some(u=> u.startsWith('https://heraclio580-oss.github.io/Altiro/version.json')), fetched.join(', '));
    const bar = doc.getElementById('updateBar');
    check('...and shows "A new test version of the app is out" with Download', !bar.hidden && /new test version/.test(bar.textContent) && doc.getElementById('updateBtn').textContent==='Download', bar.textContent);
    let opened = null;
    dom.window.HTMLAnchorElement.prototype.click = function(){ opened = this.href; };
    doc.getElementById('updateBtn').click();
    check('Download opens the test app\'s download link', opened==='https://github.com/heraclio580-oss/Altiro/releases/download/android-test/Altiro-test.apk', opened);
    dom.window.close();
  }
  {
    const {dom, doc} = await open({native:true, stamp:'bbb222', latest:'bbb222'});
    check('An up-to-date test app shows nothing', doc.getElementById('updateBar').hidden);
    dom.window.close();
  }
  {
    const {dom, doc, fetched} = await open({native:false, stamp:'aaa111', latest:'bbb222'});
    check('The website doesn\'t offer the test app', doc.getElementById('updateBar').hidden && !fetched.some(u=> u.includes('github.io')), fetched.join(', '));
    dom.window.close();
  }
  {
    // The website's own update: a newer build loads as a new address, past any cached copy of the page.
    let went = null;
    const dom = new JSDOM(html.replace("const APP_BUILD = '__ALTIRO_BUILD__';", "const APP_BUILD = 'old1';"), {runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/Altiro/?v=old1#x',
      beforeParse(w){ w.fetch = async ()=> ({ok:true, json: async()=> ({build:'new2'})}); w.__ALTIRO_NAVIGATE__ = u=>{ went = u; }; }});
    await wait(50);
    const doc = dom.window.document;
    check('A ?v= in the address comes off once the page has loaded', dom.window.location.search==='' && dom.window.location.hash==='#x', dom.window.location.href);
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await wait(50);
    check('The website offers its update', !doc.getElementById('updateBar').hidden && doc.getElementById('updateBtn').textContent==='Update');
    doc.getElementById('updateBtn').click();
    check('...and Update loads the new build by its own address (not a cached copy)', went==='/Altiro/?v=new2#x', went);
    dom.window.close();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
