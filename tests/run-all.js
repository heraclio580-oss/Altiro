// Runs every test_*.js in this directory (plain Node scripts, no test framework --
// each prints "OK"/"FAIL" lines and exits nonzero on a thrown error) and summarizes.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.startsWith('test_') && f.endsWith('.js'));

let pass = 0, fail = 0;
for(const file of files){
  let out = '', code = 0;
  try{
    out = execFileSync('node', [file], { cwd: dir, encoding: 'utf8' });
  }catch(e){
    out = (e.stdout || '') + (e.stderr || '');
    code = e.status || 1;
  }
  const failed = code !== 0 || /FAIL|THREW/.test(out);
  if(failed){
    fail++;
    console.log(`\n=== FAILED: ${file} (exit ${code}) ===`);
    console.log(out.split('\n').filter(l => /FAIL|THREW/.test(l)).join('\n') || out.trim().split('\n').slice(-10).join('\n'));
  } else {
    pass++;
  }
}
// The Edge Functions' own tests (Deno, not Node) -- run when Deno is installed.
const FUNCTION_TESTS = fs.readdirSync(path.join(dir, '..', 'supabase', 'functions'))
  .map(fn => `supabase/functions/${fn}/index_test.ts`)
  .filter(f => fs.existsSync(path.join(dir, '..', f)));
let hasDeno = true;
try{ execFileSync('deno', ['--version'], { stdio: 'ignore' }); }catch(e){ hasDeno = false; }
if(!hasDeno) console.log(`(Deno not installed -- skipped ${FUNCTION_TESTS.join(', ')})`);
else for(const testFile of FUNCTION_TESTS){
  try{
    execFileSync('deno', ['test', '--node-modules-dir=none', '--no-config', '--allow-env', '--allow-net', testFile],
      { cwd: path.join(dir, '..'), encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ALTIRO_STRAVA_TEST: '1', ALTIRO_FEEDBACK_TEST: '1', ALTIRO_REMINDERS_TEST: '1', ALTIRO_DELETE_TEST: '1', NO_COLOR: '1' } });
    pass++;
  }catch(e){
    fail++;
    console.log(`\n=== FAILED: ${testFile} ===`);
    console.log(((e.stdout || '') + (e.stderr || '')).trim().split('\n').slice(-15).join('\n'));
  }
}
console.log(`\nPassed: ${pass}, Failed: ${fail} (${files.length} files)`);
process.exit(fail > 0 ? 1 : 0);
