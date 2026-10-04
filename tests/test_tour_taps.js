const fs = require('fs');
const path = require('path');

// The guided tour in a real browser, with real taps: on the stops that say "Try it", a tap on the
// spotlighted choice reaches it (jsdom's .click() skips hit-testing, so only a real browser can tell);
// on the others, a tap on the app is stopped. Skipped where Playwright/Chromium isn't installed.
let chromium;
for(const p of ['playwright', '/opt/node22/lib/node_modules/playwright']){ try{ ({ chromium } = require(p)); break; }catch(e){} }
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f=> fs.existsSync(f));
if(!chromium){ console.log('(Playwright not installed -- skipped)'); process.exit(0); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async () => {
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await (await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true })).newPage();
  const errors = [];
  page.on('pageerror', e=> errors.push(e.message));
  await page.route(/^https?:\/\//, r=> r.abort());
  await page.addInitScript(()=>{ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; });
  await page.goto('file://' + path.join(__dirname, '..', 'www', 'index.html') + '?proto');
  await sleep(500);
  const title = () => page.evaluate(()=> document.getElementById('tourTitle').textContent);
  const nextUntil = async t => { for(let i=0; i<20 && await title()!==t; i++){ await page.tap('#tourNext'); await sleep(350); } };
  await page.evaluate(()=> [...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId==='settings').click());
  await sleep(300);
  await page.evaluate(()=> document.documentElement.classList.remove('proto-on'));
  await page.tap('#settingsTourBtn');
  await sleep(600);
  check('(set-up) the tour is on', await title()==="Today's workout");

  // A stop that only explains: a tap on the app doesn't reach it.
  await nextUntil('Start Workout');
  const box = await page.locator('#recordBtn').boundingBox();
  await page.touchscreen.tap(box.x + box.width/2, box.y + box.height/2);
  await sleep(300);
  check('On an explaining stop, tapping the spotlighted button does nothing', await page.evaluate(()=> document.getElementById('logPerfOverlay').hidden && !document.getElementById('tourOverlay').hidden));

  // "Try it" stops: real taps change the choice.
  await nextUntil('Intensity');
  const tab = page.locator('#adjIntensityTabs > *').first();
  await tab.tap();
  await sleep(200);
  check('Intensity: a tap picks it', await tab.evaluate(el=> el.classList.contains('sel') || el.classList.contains('active') || el.getAttribute('aria-selected')==='true'), await tab.evaluate(el=>el.className));
  await nextUntil('Training days');
  const before = await page.evaluate(()=> document.querySelectorAll('#adjWeekdayChips .chip.sel').length);
  await page.locator('#adjWeekdayChips .chip:not(.sel)').first().tap();
  await sleep(200);
  check('Training days: a tap adds a day', await page.evaluate(()=> document.querySelectorAll('#adjWeekdayChips .chip.sel').length)===before+1);
  await page.locator('#adjDayCountChips .chip').first().tap();
  await sleep(200);
  check('...and the day-count chips work too', await page.evaluate(()=> document.querySelectorAll('#adjWeekdayChips .chip.sel').length)===2);
  await nextUntil('Save your choices');
  await page.tap('#tourNext');
  await sleep(400);
  check('Saving: the plan is updated with the choices tapped', await title()==='Calendar' && /updated/i.test(await page.evaluate(()=> document.getElementById('toastMsg').textContent)));
  await nextUntil('Reminders');
  check('Reminders: its switch is reachable', await page.evaluate(()=>{
    const t = document.getElementById('notifToggle'), r = t.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width/2, r.top + r.height/2)?.closest('#notifToggle')===t;
  }));
  // And the tour's own buttons always work.
  await page.tap('#tourSkip');
  await sleep(300);
  check('Skip still works', await page.evaluate(()=> document.getElementById('tourOverlay').hidden));
  check('No errors', !errors.length, errors.join('; '));
  await browser.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
