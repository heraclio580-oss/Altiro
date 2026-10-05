const fs = require('fs');
const path = require('path');
const http = require('http');

// The interval timer's recorded "Ready"/"Go"/"Stop" clips, in a real browser: they load, decode and
// play at the right moments (instead of the phone's speech voice), and if they can't load the timer
// still talks through speech. Skipped where Playwright/Chromium isn't installed.
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
const www = path.join(__dirname, '..', 'www');

// Each clip's length, read from its WAV header, so a played buffer can be told apart by duration.
function wavSeconds(file){
  const b = fs.readFileSync(file);
  const rate = b.readUInt32LE(24), bytesPerSec = b.readUInt32LE(28);
  let off = 12;
  while(off < b.length){ const id = b.toString('ascii', off, off+4), size = b.readUInt32LE(off+4); if(id==='data') return size/bytesPerSec; off += 8 + size; }
  return 0;
}
const clipSec = {}, clipBytes = {};
for(const k of ['ready','go','stop']){
  const f = path.join(www, 'audio', k+'.wav');
  clipSec[k] = wavSeconds(f);
  clipBytes[k] = fs.statSync(f).size;
}
const whichClip = d => Object.keys(clipSec).find(k=> Math.abs(clipSec[k]-d) < 0.005) || `?${d.toFixed(3)}`;

(async () => {
  check('Each clip is a short, small WAV (under a second, under 60 KB)', Object.keys(clipSec).every(k=> clipSec[k]>0.2 && clipSec[k]<1 && clipBytes[k]<60000), JSON.stringify({clipSec, clipBytes}));
  check('The three clips have different lengths (so this test can tell them apart)', new Set(Object.values(clipSec).map(s=>s.toFixed(3))).size===3);

  const types = {'.html':'text/html', '.js':'text/javascript', '.wav':'audio/wav', '.png':'image/png', '.webmanifest':'application/manifest+json'};
  const server = http.createServer((req, res)=>{
    const f = path.join(www, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if(!f.startsWith(www) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
    res.writeHead(200, {'Content-Type': types[path.extname(f)] || 'application/octet-stream'});
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=> server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });

  async function run(blockClips){
    const page = await (await browser.newContext({ viewport: {width:390, height:844}, isMobile:true, hasTouch:true })).newPage();
    const errors = [];
    page.on('pageerror', e=> errors.push(e.message));
    await page.route(u=> !u.href.startsWith(base), r=> r.abort());
    if(blockClips) await page.route(/\/audio\/.*\.wav$/, r=> r.abort());
    await page.addInitScript(()=>{
      window.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      window.__cues = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(...a){ window.__cues.push({clip: this.buffer.duration, at: performance.now()}); return start.apply(this, a); };
      if(window.speechSynthesis){
        window.speechSynthesis.speak = u=> window.__cues.push({spoken: u.text, at: performance.now()});
        window.speechSynthesis.cancel = ()=>{};
      }
    });
    await page.goto(base + 'index.html?proto');
    await sleep(500);
    // A 2-round interval workout with 1-second rounds and rests.
    await page.evaluate(()=>{
      const doc = document;
      const goPill = id => [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === id).click();
      goPill('home');
      doc.getElementById('addTodayWorkoutBtn').click();
      doc.getElementById('manualNameInput').value = 'Speed Bag Rounds';
      doc.getElementById('manualNameInput').dispatchEvent(new Event('input', {bubbles:true}));
      [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='interval').click();
      doc.getElementById('createRoundsInput').value = '2';
      doc.getElementById('createWorkDurationInput').value = '0:01';
      doc.getElementById('createRestDurationInput').value = '0:01';
      doc.getElementById('saveManualEntry').click();
      goPill('home');
      document.documentElement.classList.remove('proto-on');
    });
    await sleep(200);
    await page.tap('#recordBtn');
    await sleep(600); // clips load while the timer sits on its countdown screen
    await page.tap('#timerStartPauseBtn');
    await sleep(5000 + 1000 + 1000 + 900); // countdown, work, rest, into round 2
    const cues = await page.evaluate(()=> window.__cues);
    await page.close();
    return { cues, errors };
  }

  const { cues, errors } = await run(false);
  const clips = cues.filter(c=> c.clip!==undefined).map(c=> whichClip(c.clip));
  const spoken = cues.filter(c=> c.spoken);
  check('"Ready", "Go", "Stop", "Go" play as recorded clips, in order', JSON.stringify(clips.slice(0,4))===JSON.stringify(['ready','go','stop','go']), JSON.stringify(clips));
  check('The phone\'s speech voice isn\'t used when the clips are there', spoken.length===0, JSON.stringify(spoken));
  const at = k => cues.filter(c=> c.clip!==undefined && whichClip(c.clip)===k).map(c=> c.at);
  const ready = at('ready')[0], go = at('go')[0], stop = at('stop')[0];
  check('"Go" comes when the 5-second countdown ends', go-ready > 4700 && go-ready < 5600, Math.round(go-ready));
  check('"Stop" comes when the 1-second round ends', stop-go > 800 && stop-go < 1500, Math.round(stop-go));
  check('No page errors', errors.length===0, errors.join(' | '));

  const fb = await run(true);
  const fbSpoken = fb.cues.filter(c=> c.spoken).map(c=> c.spoken);
  check('If the clips can\'t load, the timer still says Ready / Go / Stop / Go through speech', JSON.stringify(fbSpoken.slice(0,4))===JSON.stringify(['Ready','Go','Stop','Go']), JSON.stringify(fb.cues));
  check('...and no page errors then either', fb.errors.length===0, fb.errors.join(' | '));

  await browser.close();
  server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
