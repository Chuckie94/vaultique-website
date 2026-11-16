/* ===========================================================================
   THE RECEIPT PDF -- assets/account.js, build 76 (no browser)

   The PDF is written by hand, so this checks what a PDF reader relies on:
   every object where the index says it is, the text written the way a PDF
   writes text, letters a PDF's standard fonts have, and lines no wider than
   the till's own 80 mm paper. Then that a receipt with parts missing, or
   with words in it that look like PDF, still makes a good file.
   =========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const src = fs.readFileSync(path.join(ROOT, 'assets', 'account.js'), 'utf8');
const sandbox = { document: { createElement: () => ({}) }, location: { search: '', hash: '' }, console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'account.js' });
const A = sandbox.VBP_ACCOUNT;
A.hooks.money = (n) => 'K' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const latin = (bytes) => Buffer.from(bytes).toString('latin1');
function structure(pdf) {
  const start = Number((pdf.match(/startxref\n(\d+)\n%%EOF\n$/) || [])[1]);
  const table = pdf.slice(start).split('\n');
  const count = Number((table[1] || '').split(' ')[1]);
  const offs = table.slice(3, 2 + count).map(l => Number(l.slice(0, 10)));
  return { start, count, ok: pdf.slice(start, start + 4) === 'xref' &&
    offs.every((o, i) => pdf.slice(o, o + String(i + 1).length + 6) === (i + 1) + ' 0 obj') };
}
/* A PDF string: ( ... ) with \( \) \\ inside it, read back as text. */
const text = (pdf) => [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(m => m[1].replace(/\\([()\\])/g, '$1'));

console.log('\nA full receipt');
const full = { ref: 'VB-3F9K2', total: 1300, pos_receipt_no: 'RCT-000123',
  pos_receipt: { shop: { name: 'Vaultique Boutique', address: 'Lusaka', contact: '+260 970 000 000', taxId: '1000000000' },
    receiptNo: 'RCT-000123', invoiceNo: 'INV-1', date: '2026-11-15T08:42:00Z', cashier: 'Mary', customer: 'A (B) \\ C',
    lines: [{ sku: 'X-1', name: 'Scarf', qty: 1, total: 450 }], delivery: 50, total: 500,
    payments: [{ method: 'Cash', amount: 500 }], footer: 'Thank you' } };
let pdf = latin(A.receiptPdf(full));
let st = structure(pdf);
is(/^%PDF-1\.4\n/.test(pdf) && st.ok && st.count === 8, 'a PDF whose index finds every one of its seven parts', JSON.stringify(st));
const lines = text(pdf);
is(lines.every(l => l.length <= 42), 'no line wider than the till\'s 80 mm paper (42 letters)', lines.filter(l => l.length > 42).join(' | '));
is(lines.some(l => l === 'Customer: A (B) \\ C'), 'brackets and a backslash in a name are written safely, and read back as they were');
is(/\/MediaBox \[0 0 226\.77 \d+\]/.test(pdf), 'one page, 80 mm wide');
is(lines.some(l => /^Delivery +K50\.00$/.test(l)) && lines.some(l => /^TOTAL +K500\.00$/.test(l)), 'the delivery and the total, each on its own line, the figure on the right');
is(!lines.some(l => /Points redeemed|AMOUNT PAID/.test(l)), 'no points line when no points were used');
is(A.receiptFileName(full) === 'Receipt-RCT-000123.pdf', 'named after the receipt');

console.log('\nA receipt with parts missing');
pdf = latin(A.receiptPdf({ ref: 'VB-ZZZZZ', total: 90, pos_receipt_no: 'R/9 x', pos_receipt: {} }));
st = structure(pdf);
is(st.ok, 'still a good PDF', JSON.stringify(st));
is(text(pdf).some(l => /^TOTAL +K90\.00$/.test(l)) && text(pdf).some(l => l === 'Online order: VB-ZZZZZ'),
   'the order\'s own total and number stand in', text(pdf).join(' | '));
is(A.receiptFileName({ pos_receipt_no: 'R/9 x' }) === 'Receipt-R-9-x.pdf', 'a file name with nothing a phone cannot save');

console.log('\nLetters, and words that look like PDF');
pdf = latin(A.receiptPdf({ ref: 'VB-1', pos_receipt: { lines: [
  { name: 'Café — “quoted” € ✓ 漢', qty: 1, total: 1 },
  { name: ') Tj ET endstream endobj %%EOF', qty: 1, total: 1 },
  { name: 'W'.repeat(100), qty: 1, total: 1 }], total: 3 } }));
st = structure(pdf);
const t3 = text(pdf);
is(st.ok, 'still a good PDF, whatever the names say', JSON.stringify(st));
is(t3.some(l => l.indexOf('Caf\xe9 \x97 \x93quoted\x94 \x80 ? ?') === 0),
   'é, the dash, curly quotes and € become the PDF\'s own letters; what it has no letter for becomes ?', t3.join(' | '));
is(t3.join(' ').indexOf(') Tj ET endstream endobj %%EOF') > -1 && (pdf.match(/%%EOF/g) || []).length === 2,
   'text that looks like PDF stays text');
is(t3.every(l => l.length <= 42) && t3.filter(l => /^W+/.test(l)).length >= 3, 'a word longer than the paper is cut onto the next lines');

console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  the receipt PDF: all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
