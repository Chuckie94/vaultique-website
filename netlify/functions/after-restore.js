// =====================================================================
// AFTER A RESTORE (website build 92; RECOVERY.md, step 6)
//
// A restored database is the shop as it was when the copy was made. What
// happened after that is lost from it, but not from the payment gateways.
// This asks them, and only them, and changes nothing it cannot be sure of:
//
//   1. REFUNDS ARE HELD from the moment the check starts until you finish it
//      (_refund.js refuses to send one, saying why), so a refund made after
//      the copy, and asked for again by the platform, is never sent twice.
//   2. Every payment in the restored copy still waiting (started, expired,
//      failed, needing attention) from the three days before the copy is
//      asked about by its reference, exactly as the payment check-up does:
//      marked paid only on the gateway's word, with its emails.
//   3. Payments the gateways took AFTER the copy (Lenco's collections and
//      Flutterwave's transactions, by date) that the restored copy has no
//      record of are listed for you: their orders were lost with the copy,
//      so nothing is marked paid; you contact the customer.
//   4. Refunds Flutterwave made after the copy are listed, for the platform's
//      record and yours, so none is asked for again.
//
// The owner only, signed in with two-factor. Nothing here moves money.
//
//   GET                               where it stands, and what was found
//   POST { action: 'start', since }   since: when the restored copy was made
//   POST { action: 'finish' }         refunds may be sent again
// =====================================================================
const P = require('./_pay');
const L = require('./_lenco');

const LOOK_BEFORE_HOURS = 72;
const STOP_AFTER_MS = 22000;
const enc = encodeURIComponent;
const day = (d) => new Date(d).toISOString().slice(0, 10);

async function hold() {
  try {
    const r = await P.svc('GET', 'site_settings_private?key=eq.restore_hold&select=data');
    return (r && r[0] && r[0].data) || null;
  } catch (e) { return null; }
}
async function setHold(data) {
  await P.svc('POST', 'site_settings_private?on_conflict=key', { key: 'restore_hold', data, updated_at: new Date().toISOString() },
              'resolution=merge-duplicates,return=minimal');
}

async function known(refs) {
  const have = new Set();
  for (let i = 0; i < refs.length; i += 80) {
    const part = refs.slice(i, i + 80);
    const got = await P.svc('GET', 'payments?select=tx_ref&tx_ref=in.(' + part.map((r) => '"' + String(r).replace(/"/g, '') + '"').join(',') + ')');
    (got || []).forEach((g) => have.add(g.tx_ref));
  }
  return have;
}

// Lenco's successful collections between two dates, every page.
async function lencoAfter(mode, since, stopAt) {
  const out = [];
  if (!L.secretKey(mode) || !L.apiBase(mode)) return { out, skipped: true };
  for (let page = 1; page <= 50 && Date.now() < stopAt; page++) {
    const a = await L.call(mode, 'GET', '/collections?from=' + day(since) + '&to=' + day(Date.now()) + '&status=successful&page=' + page, undefined, 8000);
    if (!a.ok || !a.data || a.data.status !== true || !Array.isArray(a.data.data)) return { out, error: L.messageOf(a) || ('Lenco answered ' + a.status) };
    a.data.data.forEach((d) => {
      const c = L.collectionOf(d);
      if (c.status === 'successful' && new Date(c.completedAt || d.initiatedAt || 0) >= new Date(since)) out.push(c);
    });
    const meta = a.data.meta || {};
    if (!(Number(meta.pageCount) > page)) break;
  }
  return { out };
}
// Flutterwave's successful transactions, and its refunds, between two dates.
async function flwList(mode, what, since, stopAt) {
  const out = [];
  if (!P.flwKey(mode)) return { out, skipped: true };
  for (let page = 1; page <= 50 && Date.now() < stopAt; page++) {
    const q = '/' + what + '?from=' + day(since) + '&to=' + day(Date.now()) + '&page=' + page + (what === 'transactions' ? '&status=successful' : '');
    const a = await P.flw(mode, 'GET', q);
    const list = a.data && (Array.isArray(a.data.data) ? a.data.data : null);
    if (!a.ok || !list) return { out, error: 'Flutterwave answered ' + a.status };
    list.forEach((x) => { if (new Date(x.created_at || 0) >= new Date(since)) out.push(x); });
    const pi = (a.data.meta && a.data.meta.page_info) || {};
    if (!(Number(pi.total_pages) > page) || list.length === 0) break;
  }
  return { out };
}

async function start(since, by) {
  const began = Date.now();
  const stopAt = began + STOP_AFTER_MS;
  const sinceIso = new Date(since).toISOString();
  await setHold({ active: true, since: sinceIso, startedAt: new Date().toISOString(), by: by || 'the owner' });
  const report = { since: sinceIso, settled: 0, asked: 0, findings: [], notes: [] };
  const finding = (f) => report.findings.push(Object.assign({ restored_from: sinceIso }, f));

  // 2. Payments the copy holds that were still waiting.
  const from = new Date(new Date(since).getTime() - LOOK_BEFORE_HOURS * 3600000).toISOString();
  const waiting = await P.svc('GET', 'payments?select=*&status=in.(started,expired,failed,review)&created_at=gt.' + enc(from) + '&order=created_at.desc&limit=200');
  let s = null;
  for (const pay of waiting || []) {
    if (Date.now() > stopAt) { report.notes.push('Not every waiting payment could be asked about in one go: press the button again.'); break; }
    report.asked++;
    try {
      const r = await P.settle(pay.tx_ref);
      if (r.status === 'paid' && r.fresh) {
        report.settled++;
        s = s || await P.shopSettings();
        if (r.pay && r.pay.order_id) await P.confirmByEmail(s, r.pay.order_id, r.pay.mode, r.late, r.pay.provider);
        finding({ kind: 'payment_settled', gateway: pay.provider === 'lenco' ? 'lenco' : 'flutterwave', mode: pay.mode, reference: pay.tx_ref,
                  amount: Number(pay.amount), currency: pay.currency, happened_at: pay.created_at });
      }
    } catch (e) { /* the check-up asks again */ }
  }

  // 3 and 4. What the gateways did after the copy.
  for (const mode of ['live', 'test']) {
    const lc = await lencoAfter(mode, sinceIso, stopAt);
    if (lc.error) report.notes.push('Lenco (' + mode + '): ' + lc.error);
    const fw = await flwList(mode, 'transactions', sinceIso, stopAt);
    if (fw.error) report.notes.push('Flutterwave (' + mode + '): ' + fw.error);
    const refs = lc.out.map((c) => c.reference).concat(fw.out.map((t) => t.tx_ref)).filter((r) => /^VB-/.test(String(r || '')));
    const have = await known(refs);
    lc.out.filter((c) => /^VB-/.test(String(c.reference || '')) && !have.has(c.reference)).forEach((c) => finding({
      kind: 'payment_not_in_copy', gateway: 'lenco', mode, reference: c.reference, amount: Number(c.amount), currency: c.currency,
      happened_at: c.completedAt || null, detail: { lenco_ref: c.lencoReference || '', type: c.type || '' } }));
    fw.out.filter((t) => /^VB-/.test(String(t.tx_ref || '')) && !have.has(t.tx_ref)).forEach((t) => finding({
      kind: 'payment_not_in_copy', gateway: 'flutterwave', mode, reference: t.tx_ref, amount: Number(t.amount), currency: t.currency,
      happened_at: t.created_at || null, detail: { flw_ref: t.flw_ref || '', id: t.id || null } }));
    const rf = await flwList(mode, 'refunds', sinceIso, stopAt);
    if (rf.error) report.notes.push('Flutterwave refunds (' + mode + '): ' + rf.error);
    if (rf.out.length) {
      const ids = rf.out.map((x) => String(x.tx_id || x.transaction_id || '')).filter(Boolean);
      const ours = ids.length ? await P.svc('GET', 'payments?select=tx_ref,provider_tx_id,order_id&provider_tx_id=in.(' + ids.map((i) => '"' + i + '"').join(',') + ')') : [];
      const known2 = await P.svc('GET', 'refunds?select=flw_refund_id').catch(() => []);
      const kept = new Set((known2 || []).map((k) => String(k.flw_refund_id || '')));
      rf.out.forEach((x) => {
        const p = (ours || []).find((o) => String(o.provider_tx_id) === String(x.tx_id || x.transaction_id));
        if (!p || kept.has(String(x.id))) return;
        finding({ kind: 'refund_not_in_copy', gateway: 'flutterwave', mode, reference: p.tx_ref, amount: Number(x.amount_refunded != null ? x.amount_refunded : x.amount),
                  currency: x.currency || null, happened_at: x.created_at || null, detail: { flw_refund_id: String(x.id), status: x.status || '' } });
      });
    }
  }

  // Kept, for Admin > Settings > Backups; one of each, however often the check runs.
  if (report.findings.length) {
    try {
      await P.svc('POST', 'restore_findings?on_conflict=restored_from,kind,gateway,reference', report.findings,
                  'resolution=ignore-duplicates,return=minimal');
    } catch (e) { report.notes.push('The findings could not be kept (is supabase-backup.sql run?): they are in this answer.'); }
  }
  await setHold({ active: true, since: sinceIso, startedAt: new Date(began).toISOString(), checkedAt: new Date().toISOString(),
                  findings: report.findings.length, by: by || 'the owner' });
  await mailReport(report).catch(() => {});
  return report;
}

async function mailReport(r) {
  const M = require('./_mail');
  const s = await P.shopSettings();
  const a = await M.mailAccount();
  const to = String((s.contact && s.contact.email) || a.pub.replyTo || a.pub.senderEmail || '').trim();
  if (!to) return false;
  const lost = r.findings.filter((f) => f.kind === 'payment_not_in_copy');
  const refunds = r.findings.filter((f) => f.kind === 'refund_not_in_copy');
  return M.shopMail(to, 'After the restore: what the payment gateways say', [
    'The website was restored from the copy of ' + r.since.replace('T', ' ').slice(0, 16) + ' UTC. Refunds are held until you press "The restore is finished" in Admin > Settings > Backups.',
    r.settled + ' payment' + (r.settled === 1 ? '' : 's') + ' waiting in the copy ' + (r.settled === 1 ? 'was' : 'were') + ' confirmed paid by the gateway, and the customers emailed.',
    lost.length ? 'Paid after the copy, so their orders were lost with it (contact each customer):\n' + lost.map((f) => '- ' + f.reference + ', ' + f.currency + ' ' + f.amount + ', ' + f.gateway + (f.mode === 'test' ? ' (test)' : '')).join('\n')
                : 'No payment was made after the copy.',
    refunds.length ? 'Refunded after the copy (do not refund these again):\n' + refunds.map((f) => '- ' + f.reference + ', ' + f.amount + (f.mode === 'test' ? ' (test)' : '')).join('\n')
                   : 'No refund was made after the copy.',
  ].concat(r.notes.length ? ['Notes:\n' + r.notes.map((n) => '- ' + n).join('\n')] : []));
}

exports.handler = async function (event) {
  if (!P.serviceKey()) return P.json(503, { error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Netlify.' });
  if (!(await P.ownerFrom(event))) return P.json(403, { error: 'Only the owner, signed in with two-factor, can do this.' });
  if (event.httpMethod === 'GET') {
    const h = await hold();
    let findings = [];
    try { findings = await P.svc('GET', 'restore_findings?select=*&order=at.desc&limit=200') || []; } catch (e) { findings = []; }
    return P.json(200, { hold: h, findings });
  }
  if (event.httpMethod !== 'POST') return P.json(405, { error: 'Use GET or POST.' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (e) { b = {}; }
  try {
    if (b.action === 'start') {
      const since = new Date(String(b.since || ''));
      if (isNaN(since) || since > new Date() || Date.now() - since > 120 * 86400000) {
        return P.json(400, { error: 'Say when the copy you restored was made: a time in the last 120 days.' });
      }
      return P.json(200, await start(since, 'the owner'));
    }
    if (b.action === 'finish') {
      const h = (await hold()) || {};
      await setHold(Object.assign({}, h, { active: false, finishedAt: new Date().toISOString() }));
      try { await P.svc('PATCH', 'restore_findings?resolved_at=is.null', { resolved_at: new Date().toISOString() }, 'return=minimal'); } catch (e) { /* kept as they are */ }
      return P.json(200, { finished: true });
    }
    return P.json(400, { error: 'Unknown request.' });
  } catch (e) {
    return P.json(502, { error: 'The check could not finish just now: ' + String((e && e.message) || e).slice(0, 200) });
  }
};
exports._internals = { start, hold, lencoAfter, flwList, LOOK_BEFORE_HOURS };
