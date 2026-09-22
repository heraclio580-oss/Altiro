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
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  goPill('settings');
  await wait(20);
  const originalName = doc.getElementById('profileName').textContent;
  console.log('Settings shows a profile name and email:', originalName.length>0 && doc.getElementById('profileEmail').textContent.length>0 ? 'OK' : 'FAIL');

  doc.getElementById('editNameBtn').click();
  await wait(20);
  console.log('Edit Name sheet opens:', doc.getElementById('editNameOverlay').hidden===false ? 'OK' : 'FAIL');
  console.log('Input is pre-filled with the current name:', doc.getElementById('editNameInput').value===originalName ? 'OK' : `FAIL (${doc.getElementById('editNameInput').value})`);

  // Blank name should be rejected -- sheet stays open, nothing changes.
  doc.getElementById('editNameInput').value = '   ';
  doc.getElementById('saveEditName').click();
  await wait(20);
  console.log('Blank/whitespace-only name is rejected (sheet stays open):', doc.getElementById('editNameOverlay').hidden===false ? 'OK' : 'FAIL');

  doc.getElementById('editNameInput').value = 'Alex Rivera';
  doc.getElementById('saveEditName').click();
  await wait(20);
  console.log('Sheet closes after saving a real name:', doc.getElementById('editNameOverlay').hidden===true ? 'OK' : 'FAIL');
  console.log('Settings now shows the new name:', doc.getElementById('profileName').textContent==='Alex Rivera' ? 'OK' : `FAIL (${doc.getElementById('profileName').textContent})`);
  console.log('Avatar initial updates to match the new name:', doc.getElementById('profileAvatar').textContent==='A' ? 'OK' : `FAIL (${doc.getElementById('profileAvatar').textContent})`);
  console.log('Email is untouched:', doc.getElementById('profileEmail').textContent.length>0 ? 'OK' : 'FAIL');

  goPill('home');
  await wait(20);
  console.log('Home greeting reflects the new first name:', doc.getElementById('homeGreeting').textContent.includes('Alex') ? 'OK' : `FAIL (${doc.getElementById('homeGreeting').textContent})`);

  // Reopening should now pre-fill with the updated name.
  goPill('settings');
  await wait(20);
  doc.getElementById('editNameBtn').click();
  await wait(20);
  console.log('Reopening the sheet pre-fills with the saved name:', doc.getElementById('editNameInput').value==='Alex Rivera' ? 'OK' : `FAIL (${doc.getElementById('editNameInput').value})`);
  doc.getElementById('closeEditName').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
