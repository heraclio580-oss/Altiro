const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// "See how it works" is a swipeable tour of the app: building the plan, the week, a workout's exercises,
// moving a workout, creating your own, repeating a week, logging sets, progress and the calendar, and
// where everything lives. Swipe, Back/Next, or tap a dot to move around.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/', beforeParse(window){ window.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

(async () => {
  await wait(50);
  const doc = window.document;
  const slides = () => [...doc.querySelectorAll('.tut-slide')];
  const current = () => slides().findIndex(s => !s.hidden);
  const headline = () => slides()[current()].querySelector('.tut-headline').textContent;
  const body = doc.getElementById('tutorialBody');
  function swipe(fromX, toX, fromY=400, toY=400){
    const ev = (type, x, y) => {
      const e = new window.Event(type, {bubbles:true});
      const t = [{clientX:x, clientY:y}];
      Object.defineProperty(e, 'touches', {value: type==='touchend' ? [] : t});
      Object.defineProperty(e, 'changedTouches', {value: t});
      body.dispatchEvent(e);
    };
    ev('touchstart', fromX, fromY); ev('touchend', toX, toY);
  }

  check('Welcome screen shows "See how it works"', !!doc.getElementById('openTutorialBtn'));
  doc.getElementById('openTutorialBtn').click();
  await wait(10);
  check('The tour opens', doc.getElementById('tutorialOverlay').hidden===false);
  const heads = slides().map(s => s.querySelector('.tut-headline').textContent);
  check('It tours the app in 9 screens', heads.join(' | ')==="Build your plan | Your week, ready to go | Tap any workout | Life happens | Make your own workouts | Repeat your week | Log it, get stronger | Watch it add up | Everything's a tap away", heads.join(' | '));
  check('Every screen has an animated picture and an explanation', slides().every(s => s.querySelector('.tut-illus').children.length && s.querySelector('.tut-body').textContent.length > 40));
  check('9 dots', doc.querySelectorAll('#tutorialDots .tut-dot').length===9, doc.querySelectorAll('#tutorialDots .tut-dot').length);
  check('Back is hidden on the first screen', doc.getElementById('tutorialBack').style.visibility==='hidden');
  check('Next says "Next"', doc.getElementById('tutorialNext').textContent==='Next');

  // Swiping
  swipe(300, 100);
  check('Swipe left: next screen', current()===1, current());
  check('...and it slides in', slides()[1].classList.contains('in-next'));
  swipe(300, 100); swipe(300, 100);
  check('Swipe left twice more: screen 4', current()===3, current());
  swipe(100, 300);
  check('Swipe right: back one', current()===2 && slides()[2].classList.contains('in-prev'), current());
  swipe(300, 270);
  check('A short drag doesn\'t move', current()===2, current());
  swipe(300, 200, 200, 500);
  check('A mostly up/down drag doesn\'t either (that\'s scrolling)', current()===2, current());
  swipe(100, 300); swipe(100, 300); swipe(100, 300);
  check('Swiping right on the first screen stays there', current()===0, current());

  // What the screens show
  check('Screen 1: the running/strength balance, days and lifting split',
    !!slides()[0].querySelector('.tm-slider') && [...slides()[0].querySelectorAll('.tm-chip')].map(c=>c.textContent).join(',')==='MON,TUE,WED,THU,FRI,SAT,SUN,Full body,Push / Pull / Legs,One muscle group',
    [...slides()[0].querySelectorAll('.tm-chip')].map(c=>c.textContent).join(','));
  check('Screen 3: a workout\'s exercises, with Change to swap one',
    [...slides()[2].querySelectorAll('.tm-ex-name')].map(e=>e.textContent).join(',')==='Bench Press,Lateral Raise,Triceps Pushdown,Skull Crusher' && slides()[2].querySelectorAll('.tm-btn').length===3 && slides()[2].querySelector('.tm-btn').textContent==='Change',
    [...slides()[2].querySelectorAll('.tm-ex-name')].map(e=>e.textContent).join(','));
  check('Screen 5: + Add, then Create Workout with a name, description and exercises',
    /\+\s*Add/.test(slides()[4].querySelector('.tm-add').textContent) && slides()[4].textContent.includes('Create Workout') && slides()[4].querySelector('.tm-type').textContent==='Arm Day'
    && [...slides()[4].querySelectorAll('.tm-ex-name')].map(e=>e.textContent).join(',')==='Hammer Curl,Skull Crusher,Preacher Curl' && slides()[4].querySelector('.tm-save').textContent==='Save Workout');
  check('Screen 6: Repeat copies the week ahead', slides()[5].querySelector('.tm-btn').textContent.trim()==='Repeat' && slides()[5].querySelectorAll('.tm-cells').length===4 && slides()[5].querySelector('[data-tour-copied]').textContent==='Copied into 3 weeks',
    slides()[5].querySelector('[data-tour-copied]').textContent);
  check('Screen 8: the calendar swipes from this month to the next', [...slides()[7].querySelectorAll('[data-tour-month]')].map(e=>e.textContent).join(',')==='September 2026,October 2026',
    [...slides()[7].querySelectorAll('[data-tour-month]')].map(e=>e.textContent).join(','));
  const navLbls = [...slides()[8].querySelectorAll('.tut-navitem .lbl')].map(e=>e.textContent).join(',');
  check('Screen 9: all five tabs, as in the real bottom bar', navLbls==='Today,Plan,Progress,Calendar,Settings', navLbls);
  check('...and the wrench to adjust the plan', slides()[8].querySelector('.tut-pencil-caption').textContent==='Adjust plan');

  // Dots jump
  doc.querySelectorAll('#tutorialDots .tut-dot')[6].click();
  await wait(5);
  check('Tapping a dot jumps to that screen', current()===6 && headline()==='Log it, get stronger', current());
  doc.getElementById('tutorialBack').click();
  check('Back goes back one', current()===5, current());

  const nextBtn = doc.getElementById('tutorialNext');
  while(current() < 8) nextBtn.click();
  check('On the last screen, the button says "Get Started"', nextBtn.textContent==='Get Started', nextBtn.textContent);
  swipe(300, 100);
  check('Swiping left on the last screen doesn\'t close the tour', current()===8 && !doc.getElementById('tutorialOverlay').hidden);
  nextBtn.click();
  await wait(10);
  check('"Get Started" closes the tour and starts setup', doc.getElementById('tutorialOverlay').hidden===true && doc.getElementById('screen-onb-goal').hidden===false);

  // Spanish
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'welcome').click();
  await wait(10);
  doc.querySelector('.lang-btn[data-lang="es"]').click();
  await wait(10);
  doc.getElementById('openTutorialBtn').click();
  await wait(10);
  check('ES: the first screen is translated', headline()==='Crea tu plan', headline());
  check('ES: days and exercise names in Spanish', [...slides()[0].querySelectorAll('.tm-chip.dow')].map(c=>c.textContent).join(',')==='LUN,MAR,MIÉ,JUE,VIE,SÁB,DOM'
    && slides()[2].querySelector('.tm-ex-name').textContent==='Press de Banca');
  check('ES: tab labels', [...slides()[8].querySelectorAll('.tut-navitem .lbl')].map(e=>e.textContent).join(',')==='Hoy,Plan,Progreso,Calendario,Ajustes');
  const esHeads = slides().map(s => s.querySelector('.tut-headline').textContent);
  check('ES: no English left in the headlines', !esHeads.some((h,i)=>h===heads[i] && i!==0) && esHeads.every(Boolean), esHeads.join(' | '));
  doc.getElementById('tutorialSkip').click();
  check('Skip closes it', doc.getElementById('tutorialOverlay').hidden===true);

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
