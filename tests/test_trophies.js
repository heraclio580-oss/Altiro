const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Trophies: badges worked out from the whole history (an existing user gets one summary of what they've
// already earned, not a pop-up each), the trophy case in Progress, best efforts (top three per distance),
// a toast for small wins and a moment of its own for a new best.
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
let failures = 0;
function check(label, ok, detail){ if(!ok) failures++; console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`); }
const flat = el => el ? el.textContent.replace(/\s+/g,' ').trim() : '';

const run = (date, mi, min) => ({id:'r'+date, user_id:'u1', log_date:date, completed_override:true, planned_type:'run', planned_title:'Easy Run', planned_detail:`${mi} mi`,
  actual_run_distance:mi, manual_entries:[], performance:{distance:mi, time:min}});
const lift = (date, top) => ({id:'l'+date, user_id:'u1', log_date:date, completed_override:true, planned_type:'strength', planned_title:'Legs', planned_detail:'',
  manual_entries:[], performance:{exercises:[{key:'Back Squat', name:'Back Squat', weight:top, reps:5, sets:[{weight:top-20, reps:8},{weight:top, reps:5}]}]}});
const logRows = [
  run('2026-08-03', 3.2, 30), lift('2026-08-05', 155),   // week of Aug 3: 2 workouts
  run('2026-08-10', 3.5, 31), lift('2026-08-12', 165),   // week of Aug 10: 2 more (2 weeks in a row, a squat PR)
  run('2026-09-14', 6.3, 60),                            // back after a month off: a comeback, and a 10K
];
const profileSaves = [];
function makeBackend(){
  function from(table){
    let op = 'select', payload = null;
    const api = {
      select(){ return api; }, eq(){ return api; }, is(){ return api; }, order(){ return api; }, gte(){ return api; }, not(){ return api; },
      insert(){ op = 'insert'; return api; }, delete(){ return api; }, update(p){ op = 'update'; payload = p; return api; }, upsert(){ op = 'upsert'; return api; },
      maybeSingle(){ return Promise.resolve({data: table==='profiles' ? {id:'u1', training_days:[0,2,4], focus_ratio:2, intensity_idx:1, level:'intermediate', equipment:'gym', plan_start:'2026-07-27', created_at:'2026-07-30T15:00:00Z'} : null, error:null}); },
      then(res, rej){
        if(op==='update' && table==='profiles') profileSaves.push(payload);
        return Promise.resolve({data: op==='select' ? (table==='workout_logs' ? logRows : []) : null, error:null}).then(res, rej);
      },
    };
    return api;
  }
  return { createClient: () => ({
    auth: { onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; }, async getSession(){ return {data:{session:{user:{id:'u1', email:'runner@example.com'}}}}; }, async signOut(){ return {error:null}; } },
    from,
  })};
}

(async () => {
  const backend = makeBackend();
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
    beforeParse(w){ w.supabase = { createClient: () => backend.createClient() }; w.__ALTIRO_TEST_TODAY__ = '2026-09-18'; } });
  await wait(900);
  const doc = dom.window.document;
  const ov = doc.getElementById('badgeOverlay');

  // ---- what they'd already earned: one summary ----
  check('An existing user gets one summary of the badges they\'ve already earned', !ov.hidden && /You've already earned \d+ badges/.test(flat(doc.getElementById('badgeBody'))), flat(doc.getElementById('badgeBody')).slice(0,80));
  const n = Number((flat(doc.getElementById('badgeBody')).match(/earned (\d+) badges/)||[])[1]);
  check('...for their history: Day One, first workout, run, lift, own workout, week, 2 weeks in a row, a PR, a comeback and 10 miles (13 run)', n===10, n);
  check('...with the badges shown (8, then +2)', doc.querySelectorAll('#badgeBody .badge-svg').length===8 && /\+2/.test(flat(doc.querySelector('#badgeBody .badge-retro-row'))));
  const saved = profileSaves.filter(p=>p.badges).pop();
  check('Earned badges are saved with the day each was earned', saved && saved.badges.day_one==='2026-07-30' && saved.badges.first_run==='2026-08-03' && saved.badges.streak_2==='2026-08-12' && saved.badges.comeback==='2026-09-14' && saved.badges.first_pr==='2026-08-12', saved && JSON.stringify(saved.badges).slice(0,200));
  doc.getElementById('badgeDoneBtn').click();
  await wait(50);
  check('...and the summary closes', ov.hidden);

  // ---- the trophy case ----
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'progress').click();
  await wait(30);
  const tc = doc.getElementById('trophyCase');
  check('Progress has a trophy case with the count', /10 badges earned/.test(flat(tc)), flat(tc).slice(0,40));
  const body = () => doc.getElementById('trophyBody'), toggle = () => doc.getElementById('trophyToggle');
  check('...closed to one row at first: the count, the latest three badges, no "new" dot', body().hidden && toggle().getAttribute('aria-expanded')==='false' && toggle().querySelectorAll('.badge-svg').length===3 && !toggle().querySelector('.tt-new'));
  toggle().click();
  check('...tapping it opens the full case', !body().hidden && toggle().getAttribute('aria-expanded')==='true' && dom.window.localStorage.getItem('altiro_trophies_open')==='1');
  toggle().click();
  check('...and again closes it (remembered)', body().hidden && dom.window.localStorage.getItem('altiro_trophies_open')==='0');
  // A badge earned since they last looked: a dot on the closed row, gone once they open it.
  const seenRec = JSON.parse(dom.window.localStorage.getItem('altiro_trophies_seen'));
  dom.window.localStorage.setItem('altiro_trophies_seen', JSON.stringify({uid: seenRec.uid, ids: seenRec.ids.filter(id=> id!=='comeback')}));
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'progress').click();
  await wait(30);
  check('A badge they haven\'t looked at yet puts a dot on the closed row', !!toggle().querySelector('.tt-new'));
  toggle().click();
  check('...gone once they open it', !toggle().querySelector('.tt-new') && JSON.parse(dom.window.localStorage.getItem('altiro_trophies_seen')).ids.includes('comeback'));
  const tile = id => tc.querySelector(`[data-badge="${id}"]`);
  check('...earned badges in colour with their date, locked ones grey with progress', !tile('first_run').querySelector('.badge-svg.locked') && /Aug 3/.test(flat(tile('first_run'))) && !!tile('streak_4').querySelector('.badge-svg.locked') && /of 4 weeks/.test(flat(tile('streak_4'))) && /5 of 10/.test(flat(tile('workouts_10'))), flat(tile('workouts_10')));
  const efforts = [...tc.querySelectorAll('.effort-row')].map(flat);
  // 5K at average pace: Aug 10 (3.5 mi in 31:00) 27:31, Aug 3 (3.2 mi in 30:00) 29:08, Sep 14 (6.3 mi in 60:00) 29:35.
  check('Best efforts: top three per distance, from each run\'s average pace', /^5K.*1\s*27:31.*2\s*29:08.*3\s*29:35/.test(efforts[1]) && /^10K.*1\s*59:\d\d/.test(efforts[2]) && /No run this far yet/.test(efforts[3]), efforts.join(' | '));
  tile('streak_4').click();
  await wait(10);
  check('Tapping a badge shows what it is and how close you are', !ov.hidden && /4 weeks in a row/.test(flat(doc.getElementById('badgeBody'))) && /of 4 weeks/.test(flat(doc.getElementById('badgeBody'))) && doc.getElementById('badgeSeeAllBtn').hidden);
  doc.getElementById('badgeDoneBtn').click();
  await wait(20);

  // ---- earning one now: a new best 5K gets its moment ----
  [...doc.querySelectorAll('.proto-pill')].find(p => p.dataset.navId === 'home').click();
  await wait(20);
  doc.getElementById('addTodayWorkoutBtn').click();
  await wait(20);
  [...doc.querySelectorAll('#manualTypeRow .type-btn')].find(b=>b.dataset.type==='run').click();
  doc.getElementById('manualNameInput').value = 'Fast 5K';
  doc.getElementById('createCompletedToggle').click();
  doc.getElementById('manualDistanceInput').value = '3.2';
  doc.getElementById('manualDurationMInput').value = '24';
  doc.getElementById('saveManualEntry').click();
  await wait(700);
  // 3.2 mi in 24:00: a 5K at that pace is 23:18, and a mile 7:30.
  check('A new fastest 5K gets a moment of its own', !ov.hidden && /New best effort/.test(flat(doc.getElementById('badgeBody'))) && /Your fastest 5K/.test(flat(doc.getElementById('badgeBody'))) && /23:18/.test(flat(doc.getElementById('badgeBody'))), flat(doc.getElementById('badgeBody')));
  check('...one moment, also naming its fastest mile', /Also your fastest 1 mile 7:30/.test(flat(doc.getElementById('badgeBody'))), flat(doc.getElementById('badgeBody')));
  doc.getElementById('badgeDoneBtn').click();
  await wait(1800);
  check('...and nothing else pops up after it', ov.hidden);

  // "See trophies" on a badge moment opens the case, even if they'd closed it.
  if(!doc.getElementById('trophyBody').hidden) doc.getElementById('trophyToggle').click();
  check('(the case is closed before)', doc.getElementById('trophyBody').hidden);
  doc.getElementById('badgeSeeAllBtn').hidden = false;
  doc.getElementById('badgeSeeAllBtn').click();
  await wait(80);
  check('"See trophies" takes them to the case, opened', !doc.getElementById('screen-progress').hidden && !doc.getElementById('trophyBody').hidden);
  console.log(failures ? `${failures} FAILED` : 'ALL DONE');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('TEST THREW:', e.stack || e); process.exit(1); });
