const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The guided tour: a new plan starts it once on Today; it spotlights each part of the app in turn, and
// its Adjust stops let the user change their program in place (saved at the end of them, only if
// something changed). Skippable, replayable from Settings, in English and Spanish.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(w){ w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  const w = dom.window, doc = w.document;
  await wait(50);
  const go = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
  const ov = doc.getElementById('tourOverlay');
  const title = () => doc.getElementById('tourTitle').textContent;
  const section = () => doc.getElementById('tourCount').textContent;
  const next = async () => { doc.getElementById('tourNext').click(); await wait(20); };
  const back = async () => { doc.getElementById('tourBack').click(); await wait(20); };
  const tapsBlocked = () => !doc.querySelector('.tour-block[data-side="hole"]').hidden;
  const screen = () => [...doc.querySelectorAll('.screen')].find(s=>!s.hidden).id;
  const adjustOpen = () => !doc.getElementById('adjustOverlay').hidden;
  const planDays = () => [...doc.querySelectorAll('.plan-row[data-week-idx="1"]')].filter(r=>!/Rest Day/.test(r.textContent)).length;

  // ---- a new plan is built: the tour starts on Today ----
  check('(set-up) no tour before there\'s a plan', ov.hidden);
  go('loading');
  await wait(4200);
  check('Once the plan is built, the tour starts on Today', !ov.hidden && screen()==='screen-home' && title()==="Today's workout" && section()==='Today', `${ov.hidden} ${screen()} ${title()}`);
  check('...with Skip and Next, but no Back on the first stop', !doc.getElementById('tourSkip').hidden && doc.getElementById('tourBack').hidden && doc.getElementById('tourNext').textContent==='Next');
  check('...and taps on the app blocked while it explains', tapsBlocked());
  await next();
  check('Next: Start Workout', title()==='Start Workout' && !doc.getElementById('tourBack').hidden);
  await back();
  check('Back goes back', title()==="Today's workout");
  const seen = [title()];
  while(title()!=='Make it yours'){ await next(); seen.push(title()); if(seen.length>12) break; }
  check('Today\'s stops, then the Plan', seen.join(' > ')==="Today's workout > Start Workout > This week > Your week > The details > Your plan > Make it yours", seen.join(' > '));
  check('...on the Plan screen', screen()==='screen-week' && section()==='Plan');

  // ---- personalizing: the real Adjust sheet, one choice at a time ----
  await next();
  check('Next opens Adjust on its first choice', adjustOpen() && title()==='Running or lifting' && /Adjust/i.test(section()));
  check('...which can be changed right there (taps go through)', !tapsBlocked() && /Try it/.test(doc.getElementById('tourTry').textContent) && !doc.getElementById('tourTry').hidden);
  await back();
  check('Back out of Adjust closes it, unsaved', !adjustOpen() && title()==='Make it yours');
  await next();
  const adjSeen = [title()];
  while(title()!=='Training days'){ await next(); adjSeen.push(title()); if(adjSeen.length>8) break; }
  check('Each choice in turn', adjSeen.join(' > ')==='Running or lifting > Intensity > Weekly miles > Equipment and split > Training days', adjSeen.join(' > '));
  const before = planDays();
  // Add a fourth training day, inside the spotlight.
  const free = [...doc.querySelectorAll('#adjWeekdayChips .chip')].find(c=>!c.classList.contains('sel'));
  free.click(); await wait(20);
  await next();
  check('Then: save your choices', title()==='Save your choices' && tapsBlocked());
  await next();
  check('Next saves the change and rebuilds the plan', !adjustOpen() && planDays()===before+1, `${before} -> ${planDays()}`);
  check('...and moves on to the Calendar', title()==='Calendar' && screen()==='screen-calendar');
  const rest = [title()];
  while(doc.getElementById('tourNext').textContent==='Next'){ await next(); rest.push(title()); if(rest.length>8) break; }
  check('Then Progress and Settings, and a last word', rest.join(' > ')==="Calendar > Progress > Classes > Reminders > Strava > You're all set", rest.join(' > '));
  check('...that says where to replay it', /Settings/.test(doc.getElementById('tourBody').textContent) && doc.getElementById('tourNext').textContent==="Let's go" && doc.getElementById('tourSkip').hidden);
  await next();
  check('Let\'s go ends it on Today', ov.hidden && screen()==='screen-home');

  // ---- only once ----
  go('loading');
  await wait(4200);
  check('It doesn\'t start again by itself', ov.hidden);

  // ---- leaving Adjust without changing anything saves nothing ----
  go('settings'); await wait(20);
  doc.getElementById('settingsTourBtn').click(); await wait(20);
  check('Settings replays it from the start', !ov.hidden && title()==="Today's workout");
  while(title()!=='Save your choices'){ await next(); if(title()==='Calendar') break; }
  const toast = doc.getElementById('toast');
  toast.hidden = true;
  await next();
  check('Nothing changed in Adjust: nothing saved (no "updated" message)', toast.hidden && title()==='Calendar');

  // ---- skip ----
  doc.getElementById('tourSkip').click(); await wait(20);
  check('Skip ends it, back on Today', ov.hidden && screen()==='screen-home');

  // ---- a lifting-only plan has no weekly miles stop ----
  go('adjust'); await wait(20);
  for(let i=0;i<4;i++) doc.getElementById('adjSliderThumb').dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  doc.getElementById('applyAdjust').click(); await wait(20);
  go('settings'); await wait(20);
  doc.getElementById('settingsTourBtn').click(); await wait(20);
  while(title()!=='Running or lifting'){ await next(); if(title()==='Calendar') break; }
  const liftSeen = [title()];
  while(title()!=='Save your choices'){ await next(); liftSeen.push(title()); if(liftSeen.length>8) break; }
  check('A lifting-only plan skips the running stops', !liftSeen.includes('Weekly miles') && liftSeen.includes('Equipment and split'), liftSeen.join(' > '));
  doc.getElementById('tourSkip').click(); await wait(20);

  // ---- in Spanish ----
  go('settings'); await wait(10);
  doc.querySelector('.lang-btn[data-lang="es"]').click(); await wait(20);
  doc.getElementById('settingsTourBtn').click(); await wait(20);
  check('In Spanish', title()==='El entrenamiento de hoy' && section()==='Hoy' && doc.getElementById('tourNext').textContent==='Siguiente' && doc.getElementById('tourSkip').textContent==='Saltar', `${title()} | ${section()}`);
  check('...and the Settings button too', /recorrido guiado/.test(doc.getElementById('settingsTourBtn').textContent));

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
