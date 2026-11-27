// =====================================================================
// ONLINE REFUND: the shared core behind pay-refund, pay-webhook and
// pay-reconcile (website build 81).
//
// The platform asks for a refund through its door (vbp_pos_refund_request,
// supabase-online-refund.sql), which writes it down in public.refunds as
// "new". This file sends it to Flutterwave and records the answer.
//
// THE RULES THIS FILE EXISTS TO KEEP
//
//   1. Only a refund written down through the platform's door is sent. The
//      amount, the payment and the reason come from that row, never from
//      whoever calls this; and the caller must hold the platform's door key.
//
//   2. Sent once. A refund is taken from "new" to "sending" by a write that
//      only one caller can win, and nothing ever sends a refund that is not
//      new. The database refuses to put one back to new.
//
//   3. An answer lost on the line (no answer in time, Flutterwave not
//      answering properly) is never sent again. The refund is "unknown"
//      until Flutterwave's own list of refunds says what happened to it.
//      Only when that list has shown nothing, twice, half an hour after it
//      was sent, is it taken as never made ("refused": nothing refunded).
//
//   4. Nothing is completed because somebody said so. Flutterwave's refund
//      notice (the webhook) is a reason to ask Flutterwave, never an answer.
//
//   5. The key for the payment's own mode: a test payment is refunded with
//      the test key, and moves no real money; a live one with the live key.
//
//   6. Quick. Nothing waits for a timer: the platform asks, this asks
//      Flutterwave at once, and answers. Netlify gives a function ten
//      seconds, so Flutterwave is given seven to answer "refund this"; an
//      answer that takes longer is rule 3.
// =====================================================================
'use strict';
const P = require('./_pay');

const SEND_WAIT_MS = 7000;             // Flutterwave's time to answer "refund this"
const ASK_WAIT_MS = 4000;              // and "where is this refund?"
const ASK_GAP_MS = 8000;               // one refund is asked about at most this often (a notice: at once)
const STUCK_SENDING_MS = 2 * 60000;    // "sending" this long: the function sending it was stopped
const LOST_AFTER_MS = 30 * 60000;      // rule 3
const QUIET_TO_LOSE = 2;
const MAX_REFRESH = 50;
const MAX_LIST_PAGES = 2;
const OPEN = ['sending', 'unknown', 'pending'];
// The waits, in one place, so the checks can shorten them (tests only).
const T = { send: SEND_WAIT_MS, ask: ASK_WAIT_MS, gap: ASK_GAP_MS, stuck: STUCK_SENDING_MS, lost: LOST_AFTER_MS };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;
const nowIso = () => new Date().toISOString();
const uniq = (a) => a.filter((v, i) => v && a.indexOf(v) === i);
const clean = (v) => (v === null || v === undefined) ? '' : String(v).trim().slice(0, 80);
const quoted = (list) => list.map((v) => '"' + enc(String(v).replace(/"/g, '')) + '"').join(',');

// ---- the platform's door key, asked of the database --------------------
async function keyOk(key) {
  if (!key || String(key).length < 32) return false;
  try {
    return (await P.svc('POST', 'rpc/pos_door_key_ok', { p_key: String(key) })) === true;
  } catch (e) {
    return false;
  }
}

// ---- Flutterwave, with a time limit ---------------------------------------
async function flwTimed(mode, method, p, body, waitMs) {
  const key = P.flwKey(mode);
  if (!key) return { ok: false, status: 0, data: null, noKey: true };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), waitMs);
  try {
    const res = await fetch(P.flwBase() + p, {
      method,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, lost: true, why: e && e.name === 'AbortError' ? 'timeout' : 'line' };
  } finally {
    clearTimeout(t);
  }
}

// What Flutterwave's word for a refund means here. "completed" (and its
// kinds: completed-momo, completed-bank-transfer...) and "successful" are
// done; anything failed, declined or reversed did not happen; anything else
// is still on its way.
function stateFrom(s) {
  const v = String(s || '').toLowerCase();
  if (/^(completed|successful|success|done)/.test(v)) return 'completed';
  if (/(fail|declin|reject|revers|cancel|error)/.test(v)) return 'failed';
  return 'pending';
}
function timeOf(v) {
  if (!v) return null;
  const t = Date.parse(String(v));
  return isNaN(t) ? null : new Date(t).toISOString();
}
function detailOf(d) {
  const keep = {};
  ['flw_ref', 'status', 'destination', 'tx_id', 'amount_refunded', 'created_at', 'id'].forEach((k) => {
    if (d && d[k] !== undefined && d[k] !== null) keep[k] = typeof d[k] === 'number' ? d[k] : String(d[k]).slice(0, 120);
  });
  return keep;
}
function messageOf(a) {
  if (a && a.status === 429) return 'Flutterwave is busy just now, so nothing was refunded. Try again in a minute.';
  const m = a && a.data && (a.data.message || a.data.error || (a.data.data && a.data.data.message));
  if (m) return String(m).replace(/\s+/g, ' ').trim().slice(0, 240);
  return a && a.status ? 'Flutterwave answered ' + a.status + '.' : 'Flutterwave said no.';
}
function comments(row) {
  return ('Refund' + (row.platform_ref ? ' ' + row.platform_ref : '') + ', order ' + row.order_ref + ': ' +
          String(row.reason || '')).replace(/\s+/g, ' ').trim().slice(0, 150);
}

// What the platform is told about one refund. Nothing private: the
// platform already has the order, and the customer's details are its own.
function out(row) {
  if (!row) return null;
  return {
    id: row.id, ref: row.order_ref, platformRef: row.platform_ref || null,
    state: row.state, amount: Number(row.amount), currency: row.currency, test: row.mode === 'test',
    flwRefundId: row.flw_refund_id || null, flwRef: (row.detail && row.detail.flw_ref) || null,
    flwStatus: row.flw_status || null, message: row.flw_message || null,
    sentAt: row.sent_at || null, acceptedAt: row.accepted_at || null,
    completedAt: row.completed_at || null, failedAt: row.failed_at || null,
  };
}

async function one(id) {
  const got = await P.svc('GET', 'refunds?id=eq.' + enc(id) + '&select=*');
  return (got && got[0]) || null;
}
// BUILD 88 · The gateway a refund's payment went through. A refund always
// names its payment; one whose payment row is gone (never deleted in
// practice) is taken to be Flutterwave's, the only gateway before build 88.
async function providerOf(row) {
  const by = row.payment_id ? 'id=eq.' + enc(row.payment_id) : 'tx_ref=eq.' + enc(row.tx_ref || '');
  const got = await P.svc('GET', 'payments?select=provider&' + by + '&limit=1');
  return String((got && got[0] && got[0].provider) || 'flutterwave');
}
// A refund moved on from where it was, by a write that only succeeds if it
// is still there. Whoever lost the race reads where it is now.
async function move(row, from, patch) {
  const got = await P.svc('PATCH', 'refunds?id=eq.' + enc(row.id) + '&state=eq.' + enc(from), patch);
  return (got && got[0]) || (await one(row.id)) || row;
}

// Flutterwave's answer that a refund exists: what it says, on our row.
function foundPatch(row, d, adopt) {
  const st = stateFrom(d.status);
  // Flutterwave's reference is kept when a later answer leaves it out.
  const p = { flw_status: String(d.status || '').slice(0, 60) || null,
              detail: Object.assign({}, (row.detail && typeof row.detail === 'object') ? row.detail : {}, detailOf(d)) };
  if (st !== row.state) p.state = st;
  if (adopt || !row.flw_refund_id) {
    if (d.id !== undefined && d.id !== null && !row.flw_refund_id) p.flw_refund_id = String(d.id).slice(0, 60);
    if (!row.accepted_at) p.accepted_at = timeOf(d.created_at) || nowIso();
  }
  if (st === 'completed' && !row.completed_at) {
    p.completed_at = timeOf(d.completed_at) || timeOf(d.updated_at) || (row.state === 'sending' ? (p.accepted_at || nowIso()) : nowIso());
  }
  if (st === 'failed' && !row.failed_at) p.failed_at = nowIso();
  const got = Number(d.amount_refunded);
  if (isFinite(got) && got > 0 && Math.abs(got - Number(row.amount)) > 0.004) {
    p.flw_message = 'Flutterwave refunded ' + got.toFixed(2) + ' of the ' + Number(row.amount).toFixed(2) + ' asked.';
  }
  return p;
}

// ---- 1. send one refund ---------------------------------------------------------
async function send(id) {
  if (!UUID.test(String(id || ''))) return { ok: false, why: 'unreadable' };
  let row = await one(id);
  if (!row) return { ok: false, why: 'not_found' };
  if (row.state !== 'new') return { ok: true, again: true, refund: out(row) };

  const took = await P.svc('PATCH', 'refunds?id=eq.' + enc(id) + '&state=eq.new', { state: 'sending', sent_at: nowIso() });
  if (!(took && took.length)) return { ok: true, again: true, refund: out(await one(id)) };
  row = took[0];

  // BUILD 88 · Only a payment made through Flutterwave is refunded through
  // Flutterwave. Lenco's API has no refund for a collection: the platform's
  // door refuses those already (refund_state_of, supabase-lenco.sql); this is
  // the second lock, and nothing is sent.
  const via = await providerOf(row);
  if (via !== 'flutterwave') {
    const name = via === 'lenco' ? 'Lenco' : via;
    row = await move(row, 'sending', { state: 'refused',
      flw_message: 'Paid through ' + name + ', which has no refund this website can send: nothing was sent. ' +
                   'Refund the customer from your ' + name + ' account.' });
    return { ok: true, again: false, refund: out(row) };
  }

  if (!P.flwKey(row.mode)) {
    row = await move(row, 'sending', { state: 'refused',
      flw_message: 'The website has no Flutterwave ' + row.mode + ' key (Netlify), so nothing was sent.' });
    return { ok: true, again: false, refund: out(row) };
  }

  const a = await flwTimed(row.mode, 'POST', '/transactions/' + enc(row.provider_tx_id) + '/refund',
                           { amount: Number(row.amount), comments: comments(row) }, T.send);
  const d = a.data && a.data.data;
  let patch;
  if (a.ok && a.data && a.data.status === 'success' && d && typeof d === 'object' && !Array.isArray(d)) {
    patch = foundPatch(row, d, true);
    if (!patch.state) patch.state = 'pending';
  } else if (a.lost || a.status === 0 || a.status >= 500 || (a.ok && !(a.data && a.data.status === 'error'))) {
    // Rule 3: we do not know whether Flutterwave made it. Never sent again.
    patch = { state: 'unknown',
              flw_message: a.why === 'timeout' ? 'Flutterwave did not answer in time. Asking it what happened.'
                                               : 'Flutterwave could not be reached. Asking it what happened.' };
  } else {
    // A clear no: nothing was refunded.
    patch = { state: 'refused', flw_status: String((a.data && a.data.status) || a.status).slice(0, 60),
              flw_message: messageOf(a), detail: a.data && typeof a.data === 'object' ? { status: a.data.status || null } : null };
  }
  row = await move(row, 'sending', patch);
  return { ok: true, again: false, refund: out(row) };
}

// ---- 2. ask Flutterwave where one refund is ----------------------------------------
async function lookInList(row) {
  const sent = Date.parse(row.sent_at || row.requested_at) || Date.now();
  const from = new Date(sent - 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const found = [];
  let seen = false;
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const a = await flwTimed(row.mode, 'GET', '/refunds?from=' + from + '&to=' + to + '&page=' + page, undefined, T.ask);
    const list = a.data && (Array.isArray(a.data.data) ? a.data.data
                            : (a.data.data && Array.isArray(a.data.data.data) ? a.data.data.data : null));
    if (!a.ok || !list) break;
    seen = true;
    list.forEach((e) => {
      if (!e || String(e.tx_id || e.transaction_id || '') !== String(row.provider_tx_id)) return;
      const amt = Number(e.amount_refunded != null ? e.amount_refunded : e.amount);
      if (!(Math.abs(amt - Number(row.amount)) < 0.005)) return;
      const at = Date.parse(e.created_at || '');
      if (!isNaN(at) && at < sent - 5 * 60000) return;
      found.push(e);
    });
    if (list.length < 10) break;
  }
  if (!seen) return { row, changed: false };
  // Never the same Flutterwave refund for two of ours (a Try again for the
  // same amount, for example): one already ours is passed over.
  let hit = null;
  if (found.length) {
    const ids = uniq(found.map((e) => clean(e.id)));
    const ours = ids.length ? await P.svc('GET', 'refunds?select=id,flw_refund_id&flw_refund_id=in.(' + quoted(ids) + ')') : [];
    const taken = {};
    (ours || []).forEach((r) => { if (r.id !== row.id) taken[String(r.flw_refund_id)] = true; });
    hit = found.filter((e) => !taken[clean(e.id)])
               .sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')))[0] || null;
  }
  if (hit) {
    const p = foundPatch(row, hit, true);
    if (!p.state && row.state === 'unknown') p.state = 'pending';
    const next = await move(row, row.state, p);
    return { row: next, changed: next.state !== row.state };
  }
  if (row.state !== 'unknown') return { row, changed: false };
  const quiet = (Number(row.quiet) || 0) + 1;
  if (quiet >= QUIET_TO_LOSE && Date.now() - sent > T.lost) {
    const next = await move(row, 'unknown', { state: 'refused', quiet,
      flw_message: 'Flutterwave has no record of this refund, so nothing was refunded.' });
    return { row: next, changed: true };
  }
  return { row: await move(row, 'unknown', { quiet }), changed: false };
}

async function ask(row, force) {
  if (!row || OPEN.indexOf(row.state) < 0) return { row, changed: false };
  // A send may be under way right now: "sending" is left alone until it is
  // plainly stuck (the function sending it was stopped part way).
  if (row.state === 'sending' && Date.now() - (Date.parse(row.sent_at || row.updated_at) || 0) < T.stuck) {
    return { row, changed: false };
  }
  if (!P.flwKey(row.mode)) return { row, changed: false };
  // One ask at a time, and at most every ASK_GAP_MS; a notice asks at once.
  const cut = new Date(Date.now() - (force ? 0 : T.gap)).toISOString();
  const claimed = await P.svc('PATCH', 'refunds?id=eq.' + enc(row.id) + '&state=eq.' + enc(row.state) +
    '&or=(asked_at.is.null,asked_at.lt.' + enc(cut) + ')', { asked_at: nowIso(), asks: (Number(row.asks) || 0) + 1 });
  if (!(claimed && claimed.length)) return { row, changed: false };
  row = claimed[0];
  if (row.state === 'sending') {
    row = await move(row, 'sending', { state: 'unknown', flw_message: 'The answer to the refund was lost. Asking Flutterwave what happened.' });
    if (row.state !== 'unknown') return { row, changed: true };
  }
  if (row.flw_refund_id) {
    const a = await flwTimed(row.mode, 'GET', '/refunds/' + enc(row.flw_refund_id), undefined, T.ask);
    const d = a.data && a.data.data;
    if (a.ok && d && typeof d === 'object' && !Array.isArray(d)) {
      const p = foundPatch(row, d, false);
      const next = await move(row, row.state, p);
      return { row: next, changed: next.state !== row.state };
    }
  }
  return lookInList(row);
}

// ---- 3. the platform asks how its refunds are ----------------------------------------
// Each open one is asked about at once (all together), and the customer's
// email goes for any accepted and not yet told (the 15-minute check sends
// it otherwise).
async function refresh(ids) {
  const began = Date.now();
  const list = uniq((Array.isArray(ids) ? ids : []).map((x) => String(x || '')).filter((x) => UUID.test(x))).slice(0, MAX_REFRESH);
  if (!list.length) return { ok: true, asked: 0, changed: 0, told: 0 };
  const rows = (await P.svc('GET', 'refunds?select=*&id=in.(' + list.map(enc).join(',') + ')')) || [];
  const open = rows.filter((r) => OPEN.indexOf(r.state) > -1);
  const res = await Promise.all(open.map((r) => ask(r, false).catch(() => ({ row: r, changed: false }))));
  let told = 0;
  const accepted = uniq(res.map((x) => x.row).concat(rows.filter((r) => OPEN.indexOf(r.state) < 0))
    .filter((r) => r && (r.state === 'pending' || r.state === 'completed') && r.tell && r.order_id)
    .map((r) => r.order_id));
  if (accepted.length && Date.now() - began < 4000) {
    try { told = await require('./order-progress')._internals.tellRefunds(accepted, 4000 - (Date.now() - began)); }
    catch (e) { told = 0; }
  }
  return { ok: true, asked: open.length, changed: res.filter((x) => x.changed).length, told };
}

// ---- 4. Flutterwave's refund notice (the webhook) -----------------------------------------
function isRefundNotice(body) {
  if (!body || typeof body !== 'object') return false;
  const d = (body.data && typeof body.data === 'object') ? body.data : {};
  const words = [body.event, body['event.type'], body.type, d.event, d.type]
    .map((v) => String(v || '').toLowerCase()).join(' ');
  if (/refund/.test(words)) return true;
  return d.amount_refunded !== undefined || d.refund_id !== undefined || /refund/.test(String(d.status || '').toLowerCase());
}
async function onNotice(body) {
  const d = (body && body.data && typeof body.data === 'object') ? body.data : (body || {});
  const ids = uniq([d.id, d.refund_id].map(clean));
  const txs = uniq([d.tx_id, d.transaction_id, d.transactionId].map(clean));
  const refs = uniq([d.tx_ref, d.txRef].map(clean));
  const open = '&state=in.(' + OPEN.join(',') + ')';
  const reads = [];
  if (ids.length) reads.push(P.svc('GET', 'refunds?select=*' + open + '&flw_refund_id=in.(' + quoted(ids) + ')'));
  if (txs.length) reads.push(P.svc('GET', 'refunds?select=*' + open + '&provider_tx_id=in.(' + quoted(txs) + ')'));
  if (refs.length) reads.push(P.svc('GET', 'refunds?select=*' + open + '&tx_ref=in.(' + quoted(refs) + ')'));
  const seen = {};
  const rows = [].concat(...(await Promise.all(reads)).map((x) => x || []))
    .filter((r) => r && !seen[r.id] && (seen[r.id] = true));
  const res = await Promise.all(rows.map((r) => ask(r, true).catch(() => ({ changed: false }))));
  return { asked: rows.length, changed: res.filter((x) => x.changed).length };
}

// ---- 5. the 15-minute check: anything still open ---------------------------------------------
async function sweep(stopAt) {
  const rows = (await P.svc('GET', 'refunds?select=*&state=in.(' + OPEN.join(',') + ')&order=updated_at.asc&limit=20')) || [];
  let asked = 0, changed = 0;
  for (let i = 0; i < rows.length; i += 5) {
    if (Date.now() > stopAt) break;
    const res = await Promise.all(rows.slice(i, i + 5).map((r) => ask(r, false).catch(() => ({ changed: false }))));
    asked += res.length;
    changed += res.filter((x) => x.changed).length;
  }
  return { asked, changed };
}

module.exports = {
  keyOk, send, ask, refresh, isRefundNotice, onNotice, sweep, stateFrom, out,
  SEND_WAIT_MS, ASK_WAIT_MS, ASK_GAP_MS, STUCK_SENDING_MS, LOST_AFTER_MS, QUIET_TO_LOSE,
  _internals: { T },
};
