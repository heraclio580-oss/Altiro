const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The app (and the store app built from www/) opens without a network: every script it runs ships with
// it -- Supabase's client included, in www/vendor/ -- rather than coming from a CDN at launch.
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}
const www = path.join(__dirname, '..', 'www');
for(const file of ['index.html', 'delete-account.html']){
  const html = fs.readFileSync(path.join(www, file), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m=>m[1]);
  check(`${file}: every script ships with the app`, srcs.length>0 && srcs.every(s=> !/^(https?:)?\/\//.test(s) && fs.existsSync(path.join(www, s))), srcs.join(', '));
}
// The shipped library is the real thing: run it and it provides createClient.
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(path.join(www, 'vendor', 'supabase.js'), 'utf8'));
check('The shipped Supabase library loads and provides its client', typeof (dom.window.supabase && dom.window.supabase.createClient)==='function');
const client = dom.window.supabase.createClient('https://example.supabase.co', 'anon-key');
check('...with sign-in, data and functions', client.auth && typeof client.auth.getSession==='function' && typeof client.from==='function' && client.functions && typeof client.functions.invoke==='function');
console.log(failures ? `${failures} FAILED` : 'ALL DONE');
process.exit(0);
