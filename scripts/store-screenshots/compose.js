// Store screenshots, step 3: each screen framed with its caption -> docs/store/screenshots/<size>/<lang>/.
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

const CAP = {
  en: ['Your workout for today, ready to start', 'Running and lifting in one weekly plan', 'Every set, weight and rep, checked off', 'Your days, your mix, your intensity', 'Plans around your classes', 'See your progress week by week'],
  es: ['Tu entrenamiento de hoy, listo para empezar', 'Correr y pesas en un plan semanal', 'Cada serie, peso y repetición, marcada', 'Tus días, tu mezcla, tu intensidad', 'Planea alrededor de tus clases', 'Mira tu progreso semana a semana'],
};
// CSS px; x3 = output: iPhone 6.7" 1290x2796, Android 1080x1920.
const SIZES = {
  'iphone-6.7': {w:430, h:932, cap:30, top:168, shotW:338},
  'android':    {w:360, h:640, cap:22, top:112, shotW:236},
};
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  for(const [size, S] of Object.entries(SIZES)) for(const lang of ['en','es']){
    const dir = path.join(__dirname, '.raw', lang);
    const files = fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort();
    const out = path.join(__dirname, '..', '..', 'docs', 'store', 'screenshots', size, lang); fs.mkdirSync(out, {recursive:true});
    const page = await browser.newPage({viewport:{width:S.w, height:S.h}, deviceScaleFactor:3});
    await serveFonts(page);
    for(let i=0;i<files.length;i++){
      const img = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, files[i])).toString('base64');
      const shotH = Math.round(S.shotW * 932/430);
      await page.setContent(`<!doctype html><html><head><style>${fontCss()}
        *{margin:0;box-sizing:border-box}
        body{width:${S.w}px;height:${S.h}px;overflow:hidden;background:radial-gradient(120% 70% at 50% 0%, #3a0a0c 0%, #140708 45%, #0a0a0a 100%);font-family:Montserrat,sans-serif;color:#fff;position:relative}
        .cap{position:absolute;left:${Math.round(S.w*0.09)}px;right:${Math.round(S.w*0.09)}px;top:0;height:${S.top}px;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:800;font-size:${S.cap}px;line-height:1.12;letter-spacing:-0.01em}
        .phone{position:absolute;left:${(S.w-S.shotW)/2}px;top:${S.top}px;width:${S.shotW}px;height:${shotH}px;border-radius:${Math.round(S.shotW*0.11)}px;overflow:hidden;box-shadow:0 0 0 ${Math.max(3,Math.round(S.shotW*0.018))}px #2a2a2d, 0 24px 60px rgba(0,0,0,0.65)}
        .phone img{width:100%;height:100%;display:block}
      </style></head><body><div class="cap">${CAP[lang][i]}</div><div class="phone"><img src="${img}"></div></body></html>`);
      await page.evaluate(()=>document.fonts.ready);
      // Long captions shrink until they fit on two lines.
      await page.evaluate(()=>{ const c = document.querySelector('.cap'); let fs = parseFloat(getComputedStyle(c).fontSize);
        const lines = () => Math.round(c.scrollHeight / (fs*1.12));
        c.style.height = 'auto'; c.style.top = '0'; c.style.display = 'block';
        while(c.getBoundingClientRect().height > fs*1.12*2 + 2 && fs > 12){ fs -= 1; c.style.fontSize = fs + 'px'; }
        const top = parseFloat(document.querySelector('.phone').style.top || getComputedStyle(document.querySelector('.phone')).top);
        c.style.top = ((top - c.getBoundingClientRect().height) / 2) + 'px'; });
      await page.waitForTimeout(150);
      await page.screenshot({path: `${out}/${files[i]}`});
    }
    await page.close();
  }
  await browser.close();
})();
