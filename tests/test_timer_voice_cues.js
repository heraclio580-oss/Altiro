const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const spoken = [];
class FakeUtterance {
  constructor(text){ this.text = text; this.lang = ''; this.rate = 1; this.volume = 1; }
}
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
  beforeParse(window){
    window.__ALTIRO_TEST_TODAY__ = '2026-09-18';
    window.SpeechSynthesisUtterance = FakeUtterance;
    window.speechSynthesis = {
      cancel(){},
      speak(utter){ spoken.push({text: utter.text, lang: utter.lang}); },
    };
  },
});
const { window } = dom;
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function texts(){ return spoken.map(s=>s.text); }

(async () => {
  await wait(50);
  const doc = window.document;
  const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();

  // Switch the app to Spanish first -- "Ready"/"Go"/"Stop" should stay English regardless.
  const esBtn = [...doc.querySelectorAll('.lang-btn')].find(b=>b.getAttribute('data-lang')==='es');
  if(esBtn) esBtn.click();
  await wait(20);

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
  console.log('Timer opens showing the countdown phase (label itself is still translated):', doc.getElementById('timerPhaseLabel').textContent==='Prepárate' ? 'OK' : `FAIL (${doc.getElementById('timerPhaseLabel').textContent})`);
  console.log('Countdown display starts at 5 seconds:', doc.getElementById('timerDisplay').textContent==='0:05' ? 'OK' : `FAIL (${doc.getElementById('timerDisplay').textContent})`);

  doc.getElementById('timerStartPauseBtn').click();
  await wait(50);
  console.log('"Ready" is spoken immediately when the countdown begins:', texts()[0]==='Ready' ? 'OK' : `FAIL (${JSON.stringify(texts())})`);
  console.log('The voice cue is spoken in English even though the app is set to Spanish:', spoken[0].lang==='en-US' ? 'OK' : `FAIL (${spoken[0].lang})`);
  console.log('Resuming/pausing during the countdown would not repeat "Ready" (only one spoken so far):', spoken.length===1 ? 'OK' : `FAIL (${JSON.stringify(texts())})`);

  await wait(5300); // countdown finishes -> first round's work phase begins
  console.log('"Go" (English, not translated) is spoken once the countdown ends and work begins:', texts()[1]==='Go' ? 'OK' : `FAIL (${JSON.stringify(texts())})`);
  console.log('Phase is now Work:', doc.getElementById('timerPhaseLabel').textContent==='Trabajo' ? 'OK' : `FAIL (${doc.getElementById('timerPhaseLabel').textContent})`);

  await wait(1300); // 1s work elapses -> transitions to rest
  console.log('"Stop" (English, not translated) is spoken when the work phase ends:', texts()[2]==='Stop' ? 'OK' : `FAIL (${JSON.stringify(texts())})`);
  console.log('Phase is now Rest:', doc.getElementById('timerPhaseLabel').textContent==='Descanso' ? 'OK' : `FAIL (${doc.getElementById('timerPhaseLabel').textContent})`);

  await wait(1300); // 1s rest elapses -> round 2's work phase begins
  console.log('"Go" is spoken again for round 2:', texts()[3]==='Go' ? 'OK' : `FAIL (${JSON.stringify(texts())})`);
  console.log('Only 4 voice cues so far (Ready, Go, Stop, Go):', spoken.length===4 ? 'OK' : `FAIL (${JSON.stringify(texts())})`);
  console.log('Every cue was spoken in English:', spoken.every(s=>s.lang==='en-US') ? 'OK' : `FAIL (${JSON.stringify(spoken)})`);

  console.log('ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
