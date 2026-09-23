const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

// Progress used to be a toggle buried inside the Calendar screen (two taps deep, and easy to miss
// entirely). It now gets its own bottom-nav tab, centered among 5 tabs: Today, Plan, Progress,
// Calendar, Settings -- since streak/PRs/distance are core to why someone keeps using the app and
// deserve first-class, one-tap access rather than living inside another screen's toggle.
(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // --- Bottom nav has 5 tabs, with Progress centered between Plan and Calendar ---
  goPill('home');
  await wait(20);
  const navTabs = [...doc.querySelectorAll('#bottomNav .nav-tab')].map(b=>b.getAttribute('data-tab'));
  console.log('Bottom nav tabs:', navTabs);
  console.log('Exactly 5 tabs:', navTabs.length===5 ? 'OK' : `FAIL (${navTabs.length})`);
  console.log('Progress is the center (3rd of 5) tab:', navTabs[2]==='progress' ? 'OK' : `FAIL (${JSON.stringify(navTabs)})`);
  console.log('Order is Today, Plan, Progress, Calendar, Settings:',
    JSON.stringify(navTabs)===JSON.stringify(['home','week','progress','calendar','settings']) ? 'OK' : `FAIL (${JSON.stringify(navTabs)})`);

  // --- Progress is its own standalone screen now, not embedded inside Calendar ---
  console.log('#screen-progress exists as its own screen:', !!doc.getElementById('screen-progress') ? 'OK' : 'FAIL');
  console.log('#progBarChart lives inside #screen-progress, not #screen-calendar:',
    doc.querySelector('#screen-progress #progBarChart') && !doc.querySelector('#screen-calendar #progBarChart') ? 'OK' : 'FAIL');
  console.log('No leftover calendar/progress toggle control:', !doc.getElementById('calProgToggle') ? 'OK' : 'FAIL');

  // --- Tapping the Progress tab goes straight there in one tap, with stats already populated ---
  goPill('progress');
  await wait(20);
  console.log('Progress screen visible after one tap:', doc.getElementById('screen-progress').hidden===false ? 'OK' : 'FAIL');
  console.log('Calendar screen NOT visible:', doc.getElementById('screen-calendar').hidden===true ? 'OK' : 'FAIL');
  console.log('Progress tab marked active in the bottom nav:',
    doc.querySelector('#bottomNav .nav-tab[data-tab="progress"]').classList.contains('active') ? 'OK' : 'FAIL');
  console.log('Progress week-detail values populated:', doc.getElementById('progWeekDetail').textContent.length>0 ? 'OK' : 'FAIL');
  console.log('Progress bar chart populated:', doc.getElementById('progBarChart').children.length>0 ? 'OK' : 'FAIL');

  // --- Calendar, visited separately, is now a pure month-grid screen with no Progress content ---
  goPill('calendar');
  await wait(20);
  console.log('Calendar screen visible:', doc.getElementById('screen-calendar').hidden===false ? 'OK' : 'FAIL');
  console.log('Calendar tab marked active (not Progress):',
    doc.querySelector('#bottomNav .nav-tab[data-tab="calendar"]').classList.contains('active') &&
    !doc.querySelector('#bottomNav .nav-tab[data-tab="progress"]').classList.contains('active') ? 'OK' : 'FAIL');
  console.log('Month grid cells present:', doc.querySelectorAll('.mo-cell').length>0 ? 'OK' : 'FAIL');
  const todayCell = doc.querySelector('.mo-cell.today');
  todayCell.click();
  await wait(10);
  console.log('Calendar day-tap still opens Day Detail:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
