/* ===========================================================================
   THE INVOICE PDF -- assets/account.js, build 89 (no browser)

   The portal plan: "the invoice to download: the platform's invoice, as the
   receipt is today (the platform gives the invoice number already)". Made by
   hand like the receipt, so this checks what a PDF reader relies on: every
   object where the index says it is, an A4 page (more for a long order) in
   the two Helvetica fonts every reader carries, the text written the way a
   PDF writes text, the figures in their columns, right-aligned to the
   margin. Then that an invoice with parts missing, or with words in it that
   look like PDF, still makes a good file. Nothing in it comes from the page:
   only what the till wrote (orders.pos_receipt) and the order itself.
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
A.hooks.date = (iso) => { const d = new Date(iso); return d.getUTCDate() + ' Nov ' + d.getUTCFullYear(); };

const latin = (bytes) => Buffer.from(bytes).toString('latin1');
function structure(pdf) {
  const start = Number((pdf.match(/startxref\n(\d+)\n%%EOF\n$/) || [])[1]);
  const table = pdf.slice(start).split('\n');
  const count = Number((table[1] || '').split(' ')[1]);
  const offs = table.slice(3, 2 + count).map(l => Number(l.slice(0, 10)));
  return { start, count, ok: pdf.slice(start, start + 4) === 'xref' &&
    offs.every((o, i) => pdf.slice(o, o + String(i + 1).length + 6) === (i + 1) + ' 0 obj') };
}
/* Each piece of text with where it starts and its font: [x, y, font, size, text]. */
const pieces = (pdf) => [...pdf.matchAll(/BT \/(F[12]) ([\d.]+) Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm \(((?:\\.|[^\\)])*)\) Tj ET/g)]
  .map(m => ({ font: m[1], size: Number(m[2]), x: Number(m[3]), y: Number(m[4]), t: m[5].replace(/\\([()\\])/g, '$1') }));
const ends = (p) => p.x + A.textWidth(p.t, p.font === 'F2', p.size);
const RIGHT = 595.28 - 48;

console.log('\nA full invoice');
const full = { ref: 'VB-3F9K2', total: 1830, name: 'Chanda Banda', phone: '0977 123 456', email: 'chanda@example.com',
  address: 'Plot 12, Kabulonga Road, Lusaka', fulfilment: 'delivery', pos_receipt_no: 'RCT-000123', pos_invoice_no: 'INV-00042',
  pos_receipt: { shop: { name: 'Vaultique Boutique', slogan: 'Pieces worth keeping', address: 'Cairo Road, Lusaka',
                         contact: '+260 970 000 000', taxId: '1000000000', regNo: 'REG-77' },
    receiptNo: 'RCT-000123', invoiceNo: 'INV-00042', date: '2026-11-15T08:42:00Z', customer: 'Chanda Banda',
    lines: [{ sku: 'LS-1', name: 'Leather Satchel', qty: 1, unit: 1200, total: 1200 },
            { sku: 'SC-2', name: 'Silk Scarf', qty: 2, unit: 250, total: 500 }],
    subtotalNet: 1465.52, vatRate: 16, vat: 234.48, delivery: 130, total: 1830, amountPaid: 1830,
    payments: [{ method: 'Mobile money', amount: 1830, ref: 'MP2611-0042' }], footer: 'Thank you for shopping with us.' } };
let pdf = latin(A.invoicePdf(full));
let st = structure(pdf);
is(/^%PDF-1\.4\n/.test(pdf) && st.ok && st.count === 8, 'a PDF whose index finds every one of its seven parts', JSON.stringify(st));
is(/\/MediaBox \[0 0 595\.28 841\.89\]/.test(pdf) && /\/Count 1 /.test(pdf), 'one A4 page');
is(/\/BaseFont \/Helvetica \//.test(pdf) && /\/BaseFont \/Helvetica-Bold \//.test(pdf) && !/FontFile/.test(pdf),
   'in Helvetica and Helvetica-Bold, which every reader carries: nothing embedded');
let ps = pieces(pdf);
const has = (t) => ps.find(p => p.t === t);
is(has('INVOICE') && has('INVOICE').font === 'F2' && has('INV-00042') && has('Vaultique Boutique') && has('TPIN: 1000000000'),
   'INVOICE, its number, the shop and its TPIN', ps.map(p => p.t).slice(0, 12).join(' | '));
is(has('Bill to') && has('Chanda Banda') && has('Plot 12, Kabulonga Road, Lusaka') && has('chanda@example.com'),
   'who it is for: the name, the delivery address, the email');
is(has('For delivery') && !has('Delivered'), 'for delivery, not "delivered": the till rings an order up before it arrives');
is(has('LS-1 \xb7 Leather Satchel') && has('SC-2 \xb7 Silk Scarf') && has('K1,200.00') && has('K250.00') && has('K500.00'),
   'each piece with its quantity, unit price and amount');
is(has('Subtotal (excl. VAT)') && has('VAT (16%)') && has('K234.48') && has('Total') && has('K1,830.00') &&
   has('Amount paid') && has('Balance due') && has('K0.00'),
   'the subtotal, the VAT, the total, what was paid and nothing left to pay');
is(has('Mobile money (Ref MP2611-0042)'), 'how it was paid, with the reference');
const figures = ps.filter(p => /^-?\s?K[\d,]+\.\d\d$/.test(p.t) && p.x > 400);
is(figures.length >= 6 && figures.filter(p => Math.abs(ends(p) - RIGHT) < 0.05 || Math.abs(ends(p) - 462) < 0.05).length === figures.length,
   'every figure ends exactly on its column\'s right edge (amounts on the margin)', JSON.stringify(figures.map(p => [p.t, ends(p).toFixed(2)])));
is(ps.every(p => p.x >= 47.9 && ends(p) <= RIGHT + 0.05), 'nothing runs past the margins');
is(A.invoiceFileName(full) === 'Invoice-INV-00042.pdf', 'named after the invoice');

console.log('\nA long order');
const many = JSON.parse(JSON.stringify(full));
many.pos_receipt.lines = Array.from({ length: 70 }, (_, i) => ({ sku: 'P-' + (i + 1), name: 'Piece number ' + (i + 1), qty: 1, unit: 10, total: 10 }));
pdf = latin(A.invoicePdf(many));
st = structure(pdf);
ps = pieces(pdf);
is(st.ok && /\/Count [23] /.test(pdf) && ps.some(p => p.t === 'Page 1 of ' + (/\/Count (\d)/.exec(pdf) || [])[1]),
   'runs onto more pages, each numbered, still a good PDF', JSON.stringify(st));
is(ps.filter(p => p.t === 'Description').length >= 2 && ps.some(p => p.t === 'P-70 \xb7 Piece number 70'),
   'the column heads again on the next page, and every piece is there');
is(ps.every(p => p.y > 24 && p.y < 841.89), 'nothing written off the page');

console.log('\nAn invoice with parts missing');
pdf = latin(A.invoicePdf({ ref: 'VB-ZZZZZ', total: 90, fulfilment: 'collection', pos_invoice_no: 'INV/9 x', pos_receipt: {} }));
st = structure(pdf);
ps = pieces(pdf);
is(st.ok, 'still a good PDF', JSON.stringify(st));
is(ps.some(p => p.t === 'K90.00') && ps.some(p => p.t === 'VB-ZZZZZ') && ps.some(p => p.t === 'Collected from the shop') &&
   !ps.some(p => p.t === 'Balance due'),
   'the order\'s own total and number stand in; no "balance due" when nothing says what was paid', ps.map(p => p.t).join(' | '));
is(A.invoiceFileName({ pos_invoice_no: 'INV/9 x' }) === 'Invoice-INV-9-x.pdf', 'a file name with nothing a phone cannot save');

console.log('\nLetters, and words that look like PDF');
pdf = latin(A.invoicePdf({ ref: 'VB-1', pos_invoice_no: 'INV-1', name: 'A (B) \\ C', pos_receipt: { lines: [
  { name: 'Café — “quoted” € ✓ 漢', qty: 1, total: 1 },
  { name: ') Tj ET endstream endobj %%EOF', qty: 1, total: 1 },
  { name: 'W'.repeat(120), qty: 1, total: 1 }], total: 3 } }));
st = structure(pdf);
ps = pieces(pdf);
is(st.ok, 'still a good PDF, whatever the names say', JSON.stringify(st));
is(ps.some(p => p.t === 'A (B) \\ C'), 'brackets and a backslash in a name are written safely, and read back as they were');
is(ps.some(p => p.t.indexOf('Caf\xe9 \x97 \x93quoted\x94 \x80 ? ?') === 0),
   'é, the dash, curly quotes and € become the PDF\'s own letters; what it has no letter for becomes ?', ps.map(p => p.t).join(' | '));
is(ps.map(p => p.t).join(' ').indexOf(') Tj ET endstream endobj %%EOF') > -1 && (pdf.match(/%%EOF/g) || []).length === 2,
   'text that looks like PDF stays text');
is(ps.filter(p => /^W+$/.test(p.t)).length >= 2 && ps.filter(p => /^W+$/.test(p.t)).every(p => ends(p) <= 372 - 40 + 0.05),
   'a word too long for its column is cut onto the next lines, inside the column');

console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  the invoice PDF: all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
