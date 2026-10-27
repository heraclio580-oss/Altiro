const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Error reports: something breaking in the app is sent to the team (Supabase's app_errors) -- the error,
// where in the code and the app, the build and the kind of device, with the account when signed in. Each
// error once, a few per visit at most, none for a lost connection, and none from a browser extension.
// The app can add reports but never read them back.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }

function backend(signedIn){
  const reports = [];
  const user = {id:'u1', email:'sam@example.com', user_metadata:{}};
  function from(table){
    const api = { select(){return api;}, eq(){return api;}, order(){return api;}, in(){return api;}, is(){return api;}, gte(){return api;}, lte(){return api;}, limit(){return api;}, not(){return api;},
      upsert(){return api;}, update(){return api;}, delete(){return api;},
      insert(row){ if(table==='app_errors') reports.push(row); return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' && signedIn ? {id:'u1', full_name:'Sam', goal:'mix', level:'intermediate', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, plan_start:'2026-09-14'} : null, error:null}); },
      single(){ return api.maybeSingle(); }, then(res, rej){ return Promise.resolve({data:[], error:null}).then(res, rej); } };
    return api;
  }
  return {reports, client: { auth: { async getSession(){ return {data:{session: signedIn ? {user} : null}}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; } }, from, functions: { async invoke(){ return {data:{connected:false}, error:null}; } } }};
}
async function open(signedIn){
  const be = backend(signedIn);
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://getaltiro.app/',
    virtualConsole: new (require('jsdom').VirtualConsole)(),
    beforeParse(w){ w.supabase = { createClient: () => be.client }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(400);
  const w = dom.window;
  // An error in the app's own code (a script on the page), thrown later on, as a bug would be.
  const boom = msg => { const s = w.document.createElement('script'); s.textContent = `setTimeout(function(){ throw new Error(${JSON.stringify(msg)}); })`; w.document.body.appendChild(s); };
  const reject = reason => { const ev = new w.Event('unhandledrejection'); ev.reason = reason; w.dispatchEvent(ev); };
  return {w, reports: be.reports, boom, reject};
}

(async () => {
  {
    const {w, reports, boom, reject} = await open(true);
    check('(set-up) signed in, on Today', !w.document.getElementById('screen-home').hidden);
    boom('Cannot read properties of undefined (reading \'sets\')');
    await wait(50);
    const r = reports[0];
    check('An error in the app is reported', reports.length===1 && r.message==='Cannot read properties of undefined (reading \'sets\')', JSON.stringify(reports));
    check('...with where in the code', r && /^index\.html:\d+:\d+$/.test(r.source || ''), r && r.source);
    check('...the account, the screen, the build and the kind of device', r && r.user_id==='u1' && r.screen==='home' && r.build==='__ALTIRO_BUILD__' && r.platform==='web' && /jsdom|Mozilla/.test(r.user_agent || ''), JSON.stringify(r));
    check('...and nothing about their training', r && Object.keys(r).sort().join(',')==='build,message,platform,screen,source,stack,user_agent,user_id', Object.keys(r||{}).join(','));
    boom('Cannot read properties of undefined (reading \'sets\')');
    await wait(50);
    check('The same error again isn\'t sent twice', reports.length===1, reports.length);
    reject(new w.TypeError('Failed to fetch'));
    reject(new w.Error('NetworkError when attempting to fetch resource.'));
    await wait(50);
    check('A lost connection isn\'t reported', reports.length===1, reports.length);
    reject(new w.Error('Plan went wrong'));
    await wait(50);
    check('An unhandled promise is reported too', reports.length===2 && reports[1].message==='Plan went wrong' && reports[1].source==='promise', JSON.stringify(reports[1]));
    const ext = new w.ErrorEvent('error', {message:'from an extension', filename:'chrome-extension://abc/content.js', lineno:1, colno:1});
    w.dispatchEvent(ext);
    await wait(50);
    check('A browser extension\'s error isn\'t the app\'s', reports.length===2, reports.length);
    ['one','two','three','four','five','six'].forEach(m=> reject(new w.Error('Bug '+m)));
    await wait(80);
    check('At most 5 a visit', reports.length===5, reports.length);
    check('(long ones are cut to fit)', reports.every(x=> x.message.length<=500 && (x.stack||'').length<=4000));
    w.close();
  }
  {
    const {reports, reject, w} = await open(false);
    reject(new w.Error('Before signing in'));
    await wait(50);
    check('Not signed in: still reported, with no account', reports.length===1 && reports[0].user_id===null && reports[0].screen==='welcome', JSON.stringify(reports[0]));
    w.close();
  }
  // The table: anyone can add a report, nobody can read them from the app.
  const block = schema.slice(schema.indexOf('create table if not exists app_errors'), schema.indexOf('create index if not exists app_errors_created_at'));
  check('Schema: app_errors, cleared with the account', /user_id uuid references auth\.users\(id\) on delete cascade/.test(block) && /enable row level security/.test(block));
  check('...adding only (signed in or not, and only as yourself)', /for insert to anon, authenticated/.test(block) && /user_id is null or user_id = auth\.uid\(\)/.test(block) && !/for select|for update|for delete|for all/.test(block));
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
