const fs = require('fs');
const path = require('path');

// The store listing text (docs/store/listing.md) fits each store's limits -- a field that's too long is
// rejected when pasted in -- and every URL it gives is a page the site actually has.
let failures = 0;
function check(label, ok, detail){
  if(!ok) failures++;
  console.log(label+':', ok ? 'OK' : `FAIL${detail!==undefined ? ' ('+detail+')' : ''}`);
}
const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'store', 'listing.md'), 'utf8');
// Each "**Field** [limit]" is followed by its text, up to the next field, rule or heading.
const fields = [...md.matchAll(/\*\*([^*]+)\*\* \[(\d+)\]\n([\s\S]*?)(?=\n\*\*[^*\n]+\*\*|\n---|\n## |$)/g)]
  .map(m=>({name: m[1], limit: +m[2], text: m[3].trim()}));
check('Listing fields found (both languages)', fields.length===14, fields.length);
const over = fields.filter(f=> [...f.text].length > f.limit).map(f=>`${f.name}: ${[...f.text].length}/${f.limit}`);
check('Every field fits its character limit', !over.length, over.join('; '));
check('No field is empty', fields.every(f=> f.text.length>0));
const kw = fields.filter(f=>/^(Keywords|Palabras clave)/.test(f.name));
check('Keywords: comma-separated, no spaces after commas (App Store counts them)', kw.length===2 && kw.every(f=> !/, /.test(f.text)));
const www = path.join(__dirname, '..', 'www');
const urls = [...new Set([...fs.readFileSync(path.join(__dirname, '..', 'docs', 'store', 'listing.md'), 'utf8').matchAll(/https:\/\/heraclio580-oss\.github\.io\/Altiro\/([a-z-]*\.html)?/g)].map(m=>m[1] || 'index.html'))];
check('Every listed URL is a page the site has', urls.every(u=> fs.existsSync(path.join(www, u))), urls.join(', '));
console.log(failures ? `${failures} FAILED` : 'ALL DONE');
