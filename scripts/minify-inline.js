// Shrinks www/index.html for publishing: the inline <script> and <style> blocks lose their comments and
// extra whitespace (esbuild parses them properly, so text inside strings is never touched; names are kept
// as they are). Run on the copy that gets published, after the build stamp -- the source stays readable.
//   npm install --no-save esbuild@0.24.0 && node scripts/minify-inline.js www/index.html
const fs = require('fs');
const esbuild = require('esbuild');

const file = process.argv[2] || 'www/index.html';
const html = fs.readFileSync(file, 'utf8');
let out = html.replace(/(<script>)([\s\S]*?)(<\/script>)/g, (m, open, code, close) =>
  open + esbuild.transformSync(code, {loader: 'js', minifyWhitespace: true, legalComments: 'none', target: 'es2020'}).code.trim() + close);
out = out.replace(/(<style>)([\s\S]*?)(<\/style>)/g, (m, open, css, close) =>
  open + esbuild.transformSync(css, {loader: 'css', minifyWhitespace: true}).code.trim() + close);
fs.writeFileSync(file, out);
console.log(`${file}: ${html.length} -> ${out.length} bytes`);
