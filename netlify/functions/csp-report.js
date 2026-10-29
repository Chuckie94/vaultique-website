/* =====================================================================
   Vaultique Boutique Point — /.netlify/functions/csp-report
   ---------------------------------------------------------------------
   Where browsers send word of anything the Content Security Policy would
   have blocked. tools/build-site.cjs writes the policy; in build 75 it
   only reports, so nothing is blocked yet. What arrives here is the
   evidence for switching it on: if a week of ordinary use leaves nothing
   here but the odd stray, the policy can be enforced without breaking
   anything.

   WHERE TO READ IT: Netlify > Logs & metrics > Functions > csp-report.
   One line per report, like this:

     csp script-src-elem blocked https://example.com/x.js on vaultiqueboutique.com/shop
         (from vaultiqueboutique.com/assets/app.js:120)

   (all on one line in the log).

   Only the kind of thing, where it came from and the page it happened on
   are written down. Never an address's ?query, which can carry a preview
   key or a payment reference, and nothing about the visitor.

   Reports about a visitor's own browser extensions are dropped. They say
   something about that visitor's browser, not about this site.

   It reads at most 8 KB of any request, and answers 204 to every POST,
   readable or not, so it tells a caller nothing.
   ===================================================================== */
'use strict';

const MAX_BODY = 8192;
const MAX_REPORTS = 20;
const EXTENSION = /^(chrome|moz|safari|safari-web|ms-browser)-extension:|^webkit-masked-url:/i;
const DONE = { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };

/* One line of the log, whatever was sent: no line breaks, nothing long. */
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max || 200);
}

/* An address without its ?query and #fragment, which is where keys and
   references travel. A keyword ("inline", "eval") stays as it is, and a
   data: or blob: address is reduced to just that. */
function where(v, form) {
  const s = clean(v, 1000);
  if (!s) return '';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (!scheme) return clean(s.split(/[?#]/)[0], 100);
  if (!/^(https?|wss?)$/i.test(scheme[1])) return scheme[1].toLowerCase() + ':';
  try {
    const u = new URL(s);
    return clean((form === 'origin' ? u.origin : u.host) + u.pathname, 200);
  } catch (e) {
    return clean(s.split(/[?#]/)[0], 200);
  }
}

/* The two shapes browsers send: report-uri's {"csp-report": {...}}, and
   the newer Reporting API's [{type: "csp-violation", body: {...}}]. */
function reports(data) {
  const out = [];
  const one = (r, modern) => {
    if (!r || typeof r !== 'object') return;
    out.push(modern ? {
      directive: r.effectiveDirective || r.violatedDirective,
      blocked: r.blockedURL || r.blockedURI,
      page: r.documentURL || r.documentURI,
      source: r.sourceFile, line: r.lineNumber, sample: r.sample,
    } : {
      directive: r['effective-directive'] || r['violated-directive'],
      blocked: r['blocked-uri'],
      page: r['document-uri'],
      source: r['source-file'], line: r['line-number'], sample: r['script-sample'],
    });
  };
  if (Array.isArray(data)) {
    data.slice(0, MAX_REPORTS).forEach((r) => {
      if (r && (r.type === 'csp-violation' || !r.type)) one(r.body, true);
    });
  } else if (data && typeof data === 'object') {
    if (data['csp-report']) one(data['csp-report'], false);
    else if (data.body && data.type === 'csp-violation') one(data.body, true);
  }
  return out;
}

exports.handler = async function (event) {
  if (!event || event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' }, body: '' };
  }
  try {
    const raw = event.body || '';
    if (raw.length > MAX_BODY * 2) return DONE;
    const body = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    if (body.length > MAX_BODY) return DONE;

    let data;
    try { data = JSON.parse(body); } catch (e) { return DONE; }

    reports(data).forEach((r) => {
      const blocked = where(r.blocked, 'origin');
      const source = where(r.source);
      if (EXTENSION.test(clean(r.blocked)) || EXTENSION.test(clean(r.source))) return;
      const line = Number(r.line) > 0 ? ':' + Math.floor(Number(r.line)) : '';
      const sample = r.sample ? ' sample "' + clean(r.sample, 40) + '"' : '';
      console.log('csp ' + (clean(r.directive, 40) || '?') + ' blocked ' + (blocked || '?') +
                  ' on ' + (where(r.page) || '?') + (source ? ' (from ' + source + line + ')' : '') + sample);
    });
  } catch (e) {
    /* Nothing a stranger sends here is worth an error. */
  }
  return DONE;
};
