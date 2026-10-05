const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Terms of Use, with a health disclaimer (fitness apps get asked for one in store review): the page
// itself in English and Spanish, linked where an account is created and from Settings, next to the
// Privacy Policy -- in Spanish, to the Spanish terms.
const www = path.join(__dirname, '..', 'www');
const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
const terms = fs.readFileSync(path.join(www, 'terms.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}
(async () => {
  const t = new JSDOM(terms).window.document;
  const en = t.getElementById('en'), es = t.getElementById('es');
  check('The terms page has English and Spanish', !!en && !!es && /Terms of Use/.test(en.textContent) && /Términos de uso/.test(es.textContent));
  check('...each with the health disclaimer', /isn't medical advice/.test(en.textContent) && /Check with a doctor/.test(en.textContent) && /no es consejo médico/.test(es.textContent) && /Consulta a un médico/.test(es.textContent));
  check('...a minimum age matching the privacy policy', /at least 13/.test(en.textContent) && /under 13/.test(fs.readFileSync(path.join(www, 'privacy.html'), 'utf8')));
  const linked = [...t.querySelectorAll('a[href]')].map(a=>a.getAttribute('href').split(/[#?]/)[0]).filter(h=>/\.html$/.test(h));
  check('...and its links go to pages that exist', linked.length && linked.every(h=> fs.existsSync(path.join(www, h))), linked.join(', '));

  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(50);
  const doc = dom.window.document;
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const termsIn = id => doc.querySelector(`#${id} .terms-link`);
  check('Creating an account: says it means agreeing to the terms, with the link', /agree to Altiro's Terms of Use/.test(doc.getElementById('screen-onb-account').textContent) && termsIn('screen-onb-account')?.getAttribute('href')==='terms.html');
  check('Settings links the terms next to the privacy policy', termsIn('screen-settings')?.textContent==='Terms of use' && !!doc.querySelector('#screen-settings .legal-links a[href="privacy.html"]'));
  go('settings'); await wait(10);
  doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
  check('In Spanish, they go to the Spanish terms', termsIn('screen-settings').textContent==='Términos de uso' && termsIn('screen-settings').getAttribute('href')==='terms.html#es' && termsIn('screen-onb-account').getAttribute('href')==='terms.html#es');
  // The support page (the App Store's Support URL), linked from Settings -> Help.
  const sup = new JSDOM(fs.readFileSync(path.join(www, 'support.html'), 'utf8')).window.document;
  check('Support page: contact email and answers, in English and Spanish', /altiro580@gmail\.com/.test(sup.getElementById('en').textContent) && sup.querySelectorAll('#en details').length>=6 && sup.querySelectorAll('#es details').length===sup.querySelectorAll('#en details').length);
  const supLinks = [...sup.querySelectorAll('a[href]')].map(a=>a.getAttribute('href').split(/[#?]/)[0]).filter(h=>/\.html$/.test(h));
  check('...its links go to pages that exist', supLinks.every(h=> fs.existsSync(path.join(www, h))), supLinks.join(', '));
  check('Settings -> Help links to it (Spanish part in Spanish)', doc.getElementById('settingsSupportLink').getAttribute('href')==='support.html#es' && doc.getElementById('settingsSupportLink').textContent.trim()==='Ayuda y soporte');
  check('The privacy policy no longer lists a CDN the app doesn\'t use', !/jsDelivr/.test(fs.readFileSync(path.join(www, 'privacy.html'), 'utf8')));
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
