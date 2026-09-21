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

  // --- Bottom nav should now have only 4 tabs (Today, Plan, Calendar, Settings) -- no separate Progress tab ---
  goPill('home');
  await wait(20);
  const navTabs = [...doc.querySelectorAll('#bottomNav .nav-tab')].map(b=>b.getAttribute('data-tab'));
  console.log('Bottom nav tabs:', navTabs);
  console.log('Exactly 4 tabs, no standalone progress tab:', (navTabs.length===4 && !navTabs.includes('progress')) ? 'OK' : 'FAIL');

  // --- screen-progress no longer exists as its own screen; its content lives inside screen-calendar ---
  console.log('No standalone #screen-progress element:', !doc.getElementById('screen-progress') ? 'OK' : 'FAIL');
  console.log('#progStreak now lives inside #screen-calendar:', doc.querySelector('#screen-calendar #progStreak') ? 'OK' : 'FAIL');

  // --- Opening Calendar defaults to the Calendar view, not Progress ---
  goPill('calendar');
  await wait(20);
  console.log('Calendar screen visible:', doc.getElementById('screen-calendar').hidden===false ? 'OK' : 'FAIL');
  console.log('Calendar pane visible by default:', doc.getElementById('calendarViewPane').hidden===false ? 'OK' : 'FAIL');
  console.log('Progress pane hidden by default:', doc.getElementById('progressViewPane').hidden===true ? 'OK' : 'FAIL');
  const calBtn = doc.querySelector('#calProgToggle .tab-btn[data-view="calendar"]');
  const progBtn = doc.querySelector('#calProgToggle .tab-btn[data-view="progress"]');
  console.log('Calendar toggle segment selected:', calBtn.classList.contains('sel') ? 'OK' : 'FAIL');
  console.log('Progress toggle segment NOT selected:', !progBtn.classList.contains('sel') ? 'OK' : 'FAIL');

  // --- Switching the toggle reveals Progress stats and hides the calendar grid ---
  progBtn.click();
  await wait(10);
  console.log('After toggling -> Progress pane visible:', doc.getElementById('progressViewPane').hidden===false ? 'OK' : 'FAIL');
  console.log('After toggling -> Calendar pane hidden:', doc.getElementById('calendarViewPane').hidden===true ? 'OK' : 'FAIL');
  console.log('Progress toggle now selected:', progBtn.classList.contains('sel') ? 'OK' : 'FAIL');
  console.log('Calendar toggle no longer selected:', !calBtn.classList.contains('sel') ? 'OK' : 'FAIL');
  console.log('Progress stat values populated:', doc.getElementById('progStreak').textContent.length>0 ? 'OK' : 'FAIL');
  console.log('Progress bar chart populated:', doc.getElementById('progBarChart').children.length>0 ? 'OK' : 'FAIL');

  // --- Leaving Calendar and coming back should remember the last-selected view (Progress) ---
  goPill('home');
  await wait(20);
  goPill('calendar');
  await wait(20);
  console.log('Returning to Calendar screen remembers Progress was selected:', doc.getElementById('progressViewPane').hidden===false ? 'OK' : 'FAIL');

  // --- Switch back to Calendar and confirm the month grid still works normally ---
  doc.querySelector('#calProgToggle .tab-btn[data-view="calendar"]').click();
  await wait(10);
  console.log('Switched back to Calendar -> month grid cells present:', doc.querySelectorAll('.mo-cell').length>0 ? 'OK' : 'FAIL');
  const todayCell = doc.querySelector('.mo-cell.today');
  todayCell.click();
  await wait(10);
  console.log('Calendar day-tap still opens Day Detail after the merge:', doc.getElementById('dayDetailOverlay').hidden===false ? 'OK' : 'FAIL');
  doc.getElementById('closeDayDetail').click();

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
