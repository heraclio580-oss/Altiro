const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const visible = id => doc.getElementById(`screen-${id}`).hidden===false;
  const stepTagText = () => doc.querySelector('#device .screen:not([hidden]) .step-tag')?.textContent;

  // --- Forward walk via Days' real Continue button, not the dev pill shortcut ---
  goPill('onb-days');
  await wait(20);
  console.log('Start on Days:', visible('onb-days') ? 'OK' : 'FAIL');
  doc.querySelector('#screen-onb-days .footer-cta .btn-primary').click();
  await wait(10);
  console.log('Days -> Continue lands on Focus (not Info):', visible('onb-focus') ? 'OK' : `FAIL`);
  console.log('Focus step tag reads "Step 4 of 7":', stepTagText()==='Step 4 of 7' ? 'OK' : `FAIL (${stepTagText()})`);

  doc.querySelector('#screen-onb-focus .footer-cta .btn-primary').click();
  await wait(10);
  console.log('Focus -> Continue lands on Intensity:', visible('onb-intensity') ? 'OK' : 'FAIL');
  console.log('Intensity step tag reads "Step 5 of 7":', stepTagText()==='Step 5 of 7' ? 'OK' : `FAIL (${stepTagText()})`);

  // Intensity's continue is disabled until a tier is picked.
  const intensityCard = doc.querySelector('#intensityList .option-card');
  intensityCard.click();
  await wait(10);
  doc.getElementById('intensityNext').click();
  await wait(10);
  console.log('Intensity -> Continue lands on Info (not Account):', visible('onb-info') ? 'OK' : 'FAIL');
  console.log('Info step tag reads "Step 6 of 7":', stepTagText()==='Step 6 of 7' ? 'OK' : `FAIL (${stepTagText()})`);

  doc.querySelector('#screen-onb-info .footer-cta .btn-primary').click();
  await wait(10);
  console.log('Info -> Continue lands on Account:', visible('onb-account') ? 'OK' : 'FAIL');
  console.log('Account step tag still reads "Step 7 of 7":', stepTagText()==='Step 7 of 7' ? 'OK' : `FAIL (${stepTagText()})`);

  // --- Backward walk confirms the reverse wiring too ---
  doc.querySelector('#screen-onb-account .topbar .iconbtn').click();
  await wait(10);
  console.log('Account -> Back returns to Info:', visible('onb-info') ? 'OK' : 'FAIL');

  doc.querySelector('#screen-onb-info .topbar .iconbtn').click();
  await wait(10);
  console.log('Info -> Back returns to Intensity:', visible('onb-intensity') ? 'OK' : 'FAIL');

  doc.querySelector('#screen-onb-intensity .topbar .iconbtn').click();
  await wait(10);
  console.log('Intensity -> Back returns to Focus:', visible('onb-focus') ? 'OK' : 'FAIL');

  doc.querySelector('#screen-onb-focus .topbar .iconbtn').click();
  await wait(10);
  console.log('Focus -> Back returns to Days:', visible('onb-days') ? 'OK' : 'FAIL');

  // --- The "Skip for now" shortcut on Info must also land on Account, matching the Continue button ---
  goPill('onb-info');
  await wait(10);
  doc.getElementById('skipInfoBtn').click();
  await wait(10);
  console.log('Info "Skip for now" also lands on Account:', visible('onb-account') ? 'OK' : 'FAIL');

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
