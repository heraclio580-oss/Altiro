// Store screenshots, step 2: the six screens with the demo account, at 1290x2796 (EN or ES).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
// The app's own fonts (Montserrat, IBM Plex Sans/Mono from @fontsource), served to the page locally.
function fontCss(){
  const base = path.join(__dirname, '..', '..', 'node_modules', '@fontsource');
  const spec = [['Montserrat','montserrat',[600,700,800,900]],['IBM Plex Sans','ibm-plex-sans',[400,500,600]],['IBM Plex Mono','ibm-plex-mono',[500,600]]];
  const out = [];
  for(const [fam, pkg, ws] of spec) for(const w of ws) for(const sub of ['latin','latin-ext']){
    const f = path.join(base, pkg, 'files', `${pkg}-${sub}-${w}-normal.woff2`);
    if(fs.existsSync(f)) out.push(`@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:block;src:url(https://localfonts.test/${encodeURIComponent(f)}) format('woff2');}`);
  }
  return out.join('\n');
}
async function serveFonts(page){
  await page.route(/fonts\.googleapis\.com/, r=>r.fulfill({status:200, contentType:'text/css', body: fontCss()}));
  await page.route(/fonts\.gstatic\.com/, r=>r.abort());
  await page.route(/^https:\/\/localfonts\.test\//, r=> r.fulfill({status:200, contentType:'font/woff2', body: fs.readFileSync(decodeURIComponent(new URL(r.request().url()).pathname.slice(1)))}));
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '.demo-data.json'),'utf8'));
const LANG = process.env.LANG_CODE || 'en';
const OUT = path.join(__dirname, '.raw', LANG);
const VW = +(process.env.VW || 430), VH = +(process.env.VH || 932), DSF = +(process.env.DSF || 3);
fs.mkdirSync(OUT, {recursive:true});
const FAKE = ({logs, lang}) => {
  window.__ALTIRO_TEST_TODAY__ = '2026-10-09';
  try{ localStorage.setItem('altiro_install_nudge_dismissed','1'); localStorage.setItem('altiro_tour_done','1'); localStorage.setItem('altiro_lang', lang);
    localStorage.setItem('altiro_weather', JSON.stringify({})); }catch(e){}
  const user = {id:'u1', email:'alex.rivera@gmail.com', user_metadata:{}};
  const rows = {
    profiles: [{id:'u1', full_name:'Alex Rivera', goal:'mix', level:'intermediate', training_days:[0,2,4,5], focus_ratio:2, intensity_idx:1, weekly_miles:15, equipment:'gym',
      plan_start:'2026-09-07', best_streak:5, total_workouts:17, streak:4,
      classes:[{id:'c1', kind:'jiujitsu', name:'Jiu-Jitsu', days:[4], time:'18:00', minutes:90, from:'2026-09-07', skips:[]}]}],
    workout_logs: logs.map((l,i)=>({id:'l'+i, user_id:'u1', completed_override:null, manual_entries:[], ...l})),
    personal_records: [
      {id:1, exercise:'Deadlift', value:285, unit:'lb', created_at:'2026-10-02T18:00:00Z'},
      {id:2, exercise:'Back Squat', value:225, unit:'lb', created_at:'2026-09-28T18:00:00Z'},
      {id:3, exercise:'Bench Press', value:185, unit:'lb', created_at:'2026-09-21T18:00:00Z'},
    ],
  };
  const from = t => { const api = { select(){return api;}, eq(){return api;}, order(){return api;}, in(){return api;}, is(){return api;}, not(){return api;}, gte(){return api;}, lte(){return api;}, limit(){return api;},
    upsert(){return api;}, update(){return api;}, insert(){return api;}, delete(){return api;},
    maybeSingle(){ return Promise.resolve({data:(rows[t]||[])[0]||null, error:null}); }, single(){ return api.maybeSingle(); },
    then(res,rej){ return Promise.resolve({data: rows[t]||[], error:null}).then(res,rej); } }; return api; };
  const client = { auth: { async getSession(){ return {data:{session:{user, access_token:'t'}}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async signOut(){ return {}; } },
    from, functions:{ async invoke(){ return {data:{connected:false}, error:null}; } } };
  Object.defineProperty(window, 'supabase', { value: { createClient: () => client }, writable: false, configurable: false });
};
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await (await browser.newContext({ viewport:{width:VW,height:VH}, deviceScaleFactor:DSF, isMobile:true, hasTouch:true, colorScheme:'dark' })).newPage();
  page.on('pageerror', e=>console.log('PAGEERROR', e.message));
  await page.route(/^https:\/\/(cdn|api)/, r=>r.abort());
  await serveFonts(page);
  await page.route(/vendor\/supabase\.js/, r=>r.fulfill({status:200, contentType:'text/javascript', body:''}));
  await page.addInitScript(FAKE, {logs: DATA.logs, lang: LANG});
  await page.goto(process.env.APP_URL || 'http://localhost:8765/'); await page.evaluate(()=>document.fonts.ready); await sleep(1800);
  await page.evaluate(()=>document.documentElement.classList.remove('proto-on'));
  const nav = id => page.evaluate(id=>[...document.querySelectorAll('.proto-pill')].find(p=>p.dataset.navId===id).click(), id);
  const shot = async name => { await sleep(500); await page.screenshot({path:`${OUT}/${name}.png`}); };
  const top = () => page.evaluate(()=>{ const s=[...document.querySelectorAll('.screen')].find(x=>!x.hidden); if(s) s.scrollTop=0; });
  if(LANG==='es'){ await nav('settings'); await sleep(200); await page.evaluate(()=>document.querySelector('#screen-settings .lang-btn[data-lang="es"]').click()); await sleep(200); }
  await nav('home'); await top(); await shot('1-today');
  await nav('week'); await sleep(300); await top(); await shot('2-plan');
  await nav('home'); await top(); await page.click('#recordBtn'); await sleep(900); await shot('3-workout');
  await page.evaluate(()=>{ document.querySelectorAll('.sheet-overlay').forEach(o=>o.hidden=true); });
  await nav('adjust'); await sleep(400); await shot('4-adjust');
  await nav('home'); await sleep(300);
  await page.evaluate(()=>document.getElementById('addTodayWorkoutBtn').click()); await sleep(400);
  await page.evaluate(()=>document.querySelector('#manualTypeRow [data-type="class"]').click()); await sleep(200);
  await page.selectOption('#classKindSelect', 'jiujitsu'); await sleep(150);
  await page.evaluate(()=>{ document.getElementById('classTimeInput').value='18:00'; document.getElementById('classLenHInput').value='1'; document.getElementById('classLenMInput').value='30';
    const sh = document.querySelector('#manualEntryOverlay .sheet-panel'); if(sh) sh.scrollTop = 0; });
  await shot('5-classes');
  await page.evaluate(()=>{ document.querySelectorAll('.sheet-overlay').forEach(o=>o.hidden=true); });
  await nav('progress'); await sleep(300); await top(); await shot('6-progress');
  await browser.close();
})();
