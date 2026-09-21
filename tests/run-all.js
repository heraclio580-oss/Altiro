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
console.log(`\nPassed: ${pass}, Failed: ${fail} (${files.length} files)`);
process.exit(fail > 0 ? 1 : 0);
