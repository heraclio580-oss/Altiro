const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  await wait(50);
  const doc = window.document;

  console.log('Welcome screen shows "See How It Works" button:', !!doc.getElementById('openTutorialBtn') ? 'OK' : 'FAIL');
  doc.getElementById('openTutorialBtn').click();
  await wait(10);
  console.log('Tutorial overlay opens:', doc.getElementById('tutorialOverlay').hidden===false ? 'OK' : 'FAIL');

  const slides = () => [...doc.querySelectorAll('.tut-slide')];
  console.log('There are now 5 tutorial slides:', slides().length===5 ? 'OK' : `FAIL (${slides().length})`);
  console.log('5th slide is the navigation slide with 4 nav items:', doc.querySelector('.tut-slide[data-slide="4"] .tut-navitem') ? doc.querySelectorAll('.tut-slide[data-slide="4"] .tut-navitem').length===4 ? 'OK' : `FAIL (count=${doc.querySelectorAll('.tut-slide[data-slide="4"] .tut-navitem').length})` : 'FAIL (not found)');
  console.log('5 dots rendered:', doc.querySelectorAll('#tutorialDots .tut-dot').length===5 ? 'OK' : `FAIL (${doc.querySelectorAll('#tutorialDots .tut-dot').length})`);
  console.log('Back button hidden on first slide:', doc.getElementById('tutorialBack').style.visibility==='hidden' ? 'OK' : 'FAIL');
  console.log('Next button says "Next" on first slide:', doc.getElementById('tutorialNext').textContent==='Next' ? 'OK' : `FAIL (${doc.getElementById('tutorialNext').textContent})`);

  const nextBtn = doc.getElementById('tutorialNext');
  for(let i=0;i<3;i++){ nextBtn.click(); await wait(10); }
  console.log('After 3 clicks, on slide 3 (0-indexed):', doc.querySelector('.tut-slide[data-slide="3"]').hidden===false ? 'OK' : 'FAIL');

  nextBtn.click(); // -> slide 4, the new navigation slide
  await wait(10);
  console.log('After 4th click, on the new navigation slide (index 4):', doc.querySelector('.tut-slide[data-slide="4"]').hidden===false ? 'OK' : 'FAIL');
  console.log('Headline text is the nav slide headline:', doc.querySelector('.tut-slide[data-slide="4"] .tut-headline').textContent==="Everything's a tap away" ? 'OK' : `FAIL (${doc.querySelector('.tut-slide[data-slide="4"] .tut-headline').textContent})`);
  console.log('Nav slide labels match real bottom nav labels:', [...doc.querySelectorAll('.tut-slide[data-slide="4"] .lbl')].map(e=>e.textContent).join(',')==='Today,Plan,Calendar,Settings' ? 'OK' : `FAIL (${[...doc.querySelectorAll('.tut-slide[data-slide="4"] .lbl')].map(e=>e.textContent).join(',')})`);
  console.log('On last slide, Next button now reads "Get Started":', nextBtn.textContent==='Get Started' ? 'OK' : `FAIL (${nextBtn.textContent})`);

  nextBtn.click();
  await wait(10);
  console.log('Clicking "Get Started" on the last slide closes tutorial and moves to onboarding goal screen:', doc.getElementById('tutorialOverlay').hidden===true && doc.getElementById('screen-onb-goal').hidden===false ? 'OK' : 'FAIL');

  // --- Re-open and check ES translation of the new slide ---
  doc.getElementById('openTutorialBtn').click();
  await wait(10);
  const esBtn = doc.querySelector('.lang-btn[data-lang="es"]');
  if (esBtn) esBtn.click();
  await wait(10);
  for(let i=0;i<4;i++){ doc.getElementById('tutorialNext').click(); await wait(10); }
  console.log('ES headline for nav slide is translated (not English fallback):', doc.querySelector('.tut-slide[data-slide="4"] .tut-headline').textContent==='Todo a un toque de distancia' ? 'OK' : `FAIL (${doc.querySelector('.tut-slide[data-slide="4"] .tut-headline').textContent})`);
  console.log('ES nav slide labels also localized:', [...doc.querySelectorAll('.tut-slide[data-slide="4"] .lbl')].map(e=>e.textContent).join(',')==='Hoy,Plan,Calendario,Ajustes' ? 'OK' : `FAIL (${[...doc.querySelectorAll('.tut-slide[data-slide="4"] .lbl')].map(e=>e.textContent).join(',')})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
