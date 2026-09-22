const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const spoken = [];
class FakeUtterance {
  constructor(text){ this.text = text; }
}
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
  beforeParse(window){
    window.__ALTIRO_TEST_TODAY__ = '2026-09-18';
    window.SpeechSynthesisUtterance = FakeUtterance;
    window.speechSynthesis = {
      cancel(){},
      speak(utter){ spoken.push(utter.text); },
    };
  },
});
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Plan a short interval workout (2 rounds, 1s work / 1s rest) so a full round cycle -- countdown,
  // work, rest, work again -- finishes quickly in real time.
  goPill('home');
  await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  doc.getElementById('manualNameInput').value = 'Speed Bag Rounds';
  doc.getElementById('manualNameInput').dispatchEvent(new window.Event('input', {bubbles:true}));
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='interval').click();
  doc.getElementById('createRoundsInput').value = '2';
  doc.getElementById('createWorkDurationInput').value = '0:01';
  doc.getElementById('createRestDurationInput').value = '0:01';
  doc.getElementById('saveManualEntry').click();
  await wait(20);

  goPill('home');
  await wait(20);
  doc.getElementById('recordBtn').click();
  await wait(20);
  console.log('Timer opens showing the Get Ready countdown phase:', doc.getElementById('timerPhaseLabel').textContent==='Get Ready' ? 'OK' : `FAIL (${doc.getElementById('timerPhaseLabel').textContent})`);
  console.log('Countdown display starts at 5 seconds:', doc.getElementById('timerDisplay').textContent==='0:05' ? 'OK' : `FAIL (${doc.getElementById('timerDisplay').textContent})`);

  doc.getElementById('timerStartPauseBtn').click();
  await wait(200);
  console.log('No voice cue yet, still counting down:', spoken.length===0 ? 'OK' : `FAIL (${JSON.stringify(spoken)})`);
  console.log('Phase is still Get Ready shortly after pressing Start:', doc.getElementById('timerPhaseLabel').textContent==='Get Ready' ? 'OK' : 'FAIL');

  await wait(5300); // countdown finishes -> first round's work phase begins
  console.log('"Go" is spoken once the countdown ends and work begins:', spoken[0]==='Go' ? 'OK' : `FAIL (${JSON.stringify(spoken)})`);
  console.log('Phase is now Work:', doc.getElementById('timerPhaseLabel').textContent==='Work' ? 'OK' : `FAIL (${doc.getElementById('timerPhaseLabel').textContent})`);

  await wait(1300); // 1s work elapses -> transitions to rest
  console.log('"Stop" is spoken when the work phase ends:', spoken[1]==='Stop' ? 'OK' : `FAIL (${JSON.stringify(spoken)})`);
  console.log('Phase is now Rest:', doc.getElementById('timerPhaseLabel').textContent==='Rest' ? 'OK' : `FAIL (${doc.getElementById('timerPhaseLabel').textContent})`);

  await wait(1300); // 1s rest elapses -> round 2's work phase begins
  console.log('"Go" is spoken again for round 2:', spoken[2]==='Go' ? 'OK' : `FAIL (${JSON.stringify(spoken)})`);
  console.log('Only 3 voice cues so far (Go, Stop, Go):', spoken.length===3 ? 'OK' : `FAIL (${JSON.stringify(spoken)})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
