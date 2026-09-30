const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// The link in the "confirm your email" message brings the new user back to the app, signed in, with the
// plan they set up: sign-up tells Supabase where to send them (this site), the setup answers wait on the
// device until the link is tapped, and an expired link leads to sign-in with a way to get a new one.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}

function makeBackend(opts = {}){
  const db = { profiles: opts.profiles || {}, calls: [] };
  function from(table){
    let filters = [], op = 'select', payload = null;
    const api = {
      select(){ return api; }, order(){ return api; }, in(){ return api; }, is(){ return api; }, gte(){ return api; }, lte(){ return api; },
      eq(c,v){ filters.push([c,v]); return api; },
      update(p){ op='update'; payload=p; return api; }, upsert(){ op='noop'; return api; }, insert(){ op='noop'; return api; }, delete(){ op='noop'; return api; },
      maybeSingle(){ return run(true); }, single(){ return run(true); },
      then(res, rej){ return run(false).then(res, rej); },
    };
    async function run(single){
      if(table==='profiles'){
        const row = db.profiles[(filters.find(f=>f[0]==='id')||[])[1]];
        if(op==='update'){ if(row) Object.assign(row, payload); return {data:null, error:null}; }
        return {data: single ? (row||null) : (row ? [row] : []), error:null};
      }
      return {data: single ? null : [], error:null};
    }
    return api;
  }
  return {
    db,
    createClient: () => ({
      auth: {
        async getSession(){ return {data:{session: opts.sessionUser ? {user: opts.sessionUser} : null}}; },
        onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; },
        async signUp(args){ db.calls.push(['signUp', args]); return {data:{user:{id:'u9', email:args.email}, session:null}, error:null}; },
        async signInWithPassword(args){ db.calls.push(['signIn', args]); return {data:null, error: opts.unconfirmed ? {message:'Email not confirmed', code:'email_not_confirmed'} : {message:'Invalid login credentials'}}; },
        async resend(args){ db.calls.push(['resend', args]); return {error:null}; },
        async resetPasswordForEmail(email, o){ db.calls.push(['reset', {email, ...o}]); return {error:null}; },
        async updateUser(args){ db.calls.push(['updateUser', args]); return {data:{user:{}}, error:null}; },
        async signOut(){ return {}; },
      },
      from, functions: { async invoke(){ return {data:{connected:false}, error:null}; } },
    }),
  };
}
function open(backend, url, pending){
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url,
    beforeParse(w){
      w.supabase = { createClient: () => backend.createClient() };
      w.__ALTIRO_TEST_TODAY__ = '2026-09-18';
      if(pending) w.localStorage.setItem('altiro_pending_signup', JSON.stringify(pending));
    },
  });
}
const PENDING = {email:'new@example.com', at: Date.now()-5*60*1000, fields:{goal:'cardio', level:'beginner', trainingDays:[1,3,5], focusRatio:0, intensityIdx:0, weeklyMiles:10, lang:'en'}};

(async () => {
  // ---- signing up when the email has to be confirmed ----
  const b1 = makeBackend();
  const dom1 = open(b1, 'https://example.com/Altiro/');
  await wait(250);
  const d1 = dom1.window.document;
  [...d1.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'onb-account').click(); await wait(20);
  const type = (id, v) => { const el = d1.getElementById(id); el.value = v; el.dispatchEvent(new dom1.window.Event('input', {bubbles:true})); };
  type('emailInput', 'Runner@Example.com'); type('passwordInput', 'secret123');
  d1.getElementById('emailSignupBtn').click(); await wait(50);
  const signUp = b1.db.calls.find(c=>c[0]==='signUp');
  check('Sign-up tells Supabase to send the link back to this site', signUp && signUp[1].options && signUp[1].options.emailRedirectTo==='https://example.com/Altiro/', signUp && JSON.stringify(signUp[1].options));
  check('...and says what happens next', /tap the link to confirm\. It brings you right back here, signed in/.test(d1.getElementById('authError').textContent), d1.getElementById('authError').textContent);
  const stash = JSON.parse(dom1.window.localStorage.getItem('altiro_pending_signup') || 'null');
  check('The plan answers wait on this device until the link is tapped', stash && stash.email==='runner@example.com' && Array.isArray(stash.fields.trainingDays) && 'focusRatio' in stash.fields, JSON.stringify(stash));
  check('...with a way to get a new link', !d1.getElementById('resendConfirmBtn').hidden);

  // ---- tapping the link ----
  const b2 = makeBackend({profiles:{u2:{id:'u2'}}, sessionUser:{id:'u2', email:'New@Example.com'}});
  const dom2 = open(b2, 'https://example.com/Altiro/#access_token=abc&refresh_token=def&expires_in=3600&token_type=bearer&type=signup', PENDING);
  await wait(400);
  const d2 = dom2.window.document;
  check('The link opens the app signed in, on Today', !d2.getElementById('screen-home').hidden, [...d2.querySelectorAll('.screen')].find(x=>!x.hidden)?.id);
  check('...welcomes them', d2.getElementById('toastMsg').textContent==='Email confirmed. Welcome to Altiro!', d2.getElementById('toastMsg').textContent);
  const prof = b2.db.profiles.u2;
  check('...with the plan they set up, saved to the account', prof.goal==='cardio' && JSON.stringify(prof.training_days)==='[1,3,5]' && prof.focus_ratio===0 && prof.weekly_miles===10 && !!prof.plan_start_date, JSON.stringify({g:prof.goal, d:prof.training_days, f:prof.focus_ratio, m:prof.weekly_miles, s:prof.plan_start_date}));
  check('...and the waiting answers are cleared', dom2.window.localStorage.getItem('altiro_pending_signup')===null);
  check('...and the address is tidied up', dom2.window.location.hash==='');

  // An account that already has a plan keeps it.
  const b3 = makeBackend({profiles:{u3:{id:'u3', goal:'strength', training_days:[0,2,4], focus_ratio:4, plan_start:'2026-09-07'}}, sessionUser:{id:'u3', email:'new@example.com'}});
  open(b3, 'https://example.com/Altiro/#access_token=abc&type=signup', PENDING);
  await wait(400);
  check('An account that already has a plan keeps it', b3.db.profiles.u3.goal==='strength' && JSON.stringify(b3.db.profiles.u3.training_days)==='[0,2,4]', JSON.stringify(b3.db.profiles.u3));

  // ---- an expired link ----
  const b4 = makeBackend();
  const dom4 = open(b4, 'https://example.com/Altiro/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', PENDING);
  await wait(400);
  const d4 = dom4.window.document;
  check('An expired link goes to sign-in and explains', !d4.getElementById('screen-onb-account').hidden && /expired or was already used/.test(d4.getElementById('authError').textContent) && d4.getElementById('emailSignupBtn').textContent==='Sign In', d4.getElementById('authError').textContent);
  check('...with their email filled in, and a new-link button', d4.getElementById('emailInput').value==='new@example.com' && !d4.getElementById('resendConfirmBtn').hidden);
  d4.getElementById('resendConfirmBtn').click(); await wait(40);
  const resend = b4.db.calls.find(c=>c[0]==='resend');
  check('...which sends a fresh link back to this site', resend && resend[1].type==='signup' && resend[1].email==='new@example.com' && resend[1].options.emailRedirectTo==='https://example.com/Altiro/', resend && JSON.stringify(resend[1]));
  check('...and says so', d4.getElementById('authError').textContent==='Sent. Check your email for the new link.', d4.getElementById('authError').textContent);

  // ---- signing in before confirming ----
  const b5 = makeBackend({unconfirmed:true});
  const dom5 = open(b5, 'https://example.com/Altiro/');
  await wait(250);
  const d5 = dom5.window.document;
  d5.getElementById('welcomeSignInBtn').click(); await wait(10);
  const t5 = (id, v) => { const el = d5.getElementById(id); el.value = v; el.dispatchEvent(new dom5.window.Event('input', {bubbles:true})); };
  t5('emailInput', 'late@example.com'); t5('passwordInput', 'secret123');
  d5.getElementById('emailSignupBtn').click(); await wait(50);
  check('Signing in before confirming: says to tap the link, and offers a new one', d5.getElementById('authError').textContent==='Confirm your email first: tap the link we sent you.' && !d5.getElementById('resendConfirmBtn').hidden, d5.getElementById('authError').textContent);

  // ---- forgot password ----
  const fp = d5.getElementById('forgotPasswordBtn');
  check('Sign-in offers "Forgot password?"', !fp.hidden && fp.textContent==='Forgot password?');
  t5('emailInput', '');
  fp.click(); await wait(20);
  check('...asks for the email first', d5.getElementById('authError').textContent==='Type your email above, then tap Forgot password.' && !b5.db.calls.some(c=>c[0]==='reset'));
  t5('emailInput', 'late@example.com');
  fp.click(); await wait(40);
  const reset = b5.db.calls.find(c=>c[0]==='reset');
  check('...then emails a reset link that comes back to this site', reset && reset[1].email==='late@example.com' && reset[1].redirectTo==='https://example.com/Altiro/' && d5.getElementById('authError').textContent==='Check your email for a link to set a new password.', reset && JSON.stringify(reset[1]));
  d5.getElementById('toggleAuthMode').click(); await wait(5);
  check('...and isn\'t shown when creating an account', fp.hidden);

  // ---- tapping the reset link ----
  const b6 = makeBackend({profiles:{u6:{id:'u6', goal:'cardio', training_days:[0,2,4], plan_start:'2026-09-07'}}, sessionUser:{id:'u6', email:'late@example.com'}});
  const dom6 = open(b6, 'https://example.com/Altiro/#access_token=abc&refresh_token=def&type=recovery');
  await wait(400);
  const d6 = dom6.window.document;
  check('The reset link opens the app signed in, asking for a new password', !d6.getElementById('screen-home').hidden && !d6.getElementById('newPasswordOverlay').hidden);
  const t6 = (id, v) => { d6.getElementById(id).value = v; };
  t6('newPasswordInput', 'abc'); t6('newPasswordConfirm', 'abc');
  d6.getElementById('saveNewPassword').click(); await wait(20);
  check('...too short: says so', d6.getElementById('newPasswordError').textContent==='Use at least 6 characters.');
  t6('newPasswordInput', 'newsecret1'); t6('newPasswordConfirm', 'newsecret2');
  d6.getElementById('saveNewPassword').click(); await wait(20);
  check('...not matching: says so', d6.getElementById('newPasswordError').textContent==="The two passwords don't match.");
  t6('newPasswordConfirm', 'newsecret1');
  d6.getElementById('saveNewPassword').click(); await wait(40);
  const upd = b6.db.calls.find(c=>c[0]==='updateUser');
  check('...saves the new password', upd && upd[1].password==='newsecret1' && d6.getElementById('newPasswordOverlay').hidden && d6.getElementById('toastMsg').textContent==='Password updated');

  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
