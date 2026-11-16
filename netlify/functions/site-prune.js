/* =====================================================================
   Vaultique Boutique Point — throwing away analytics nobody will read
   ---------------------------------------------------------------------
   WHAT WAS WRONG. site_prune() was written, granted and documented, and
   nothing ever called it. Not a page, not a function, not a schedule. So
   site_events grew for ever: every page view this shop has ever had,
   kept until somebody noticed.

   The rollup has a caller — site_stats() drives it lazily, which is a
   good arrangement and works. The prune had none.

   WHY A SCHEDULE AND NOT A LAZY CALL. Summing a day is work the reader
   wants done: they are asking for that day's figures. Deleting a year of
   old rows is not, and putting it inside a page load means the one
   unlucky person who opens Analytics on the wrong morning waits for it.
   It belongs on a clock, and product-pulse.js already established what a
   scheduled function looks like here.

   WHAT IT KEEPS. Four hundred days, so a shop can always compare this
   month with the same month last year and have a fortnight in hand. The
   day summaries in site_daily are NOT touched by this and never expire —
   they are small, and they are what every figure older than the raw
   window is built from. Nothing the admin shows disappears.

   IF IT NEVER RUNS AT ALL — not deployed, not scheduled, no service key
   — nothing breaks. The table simply keeps growing, which is exactly
   where this shop was before this file existed. It says so in its log
   and does nothing else.
   ===================================================================== */
const { readConfig } = require('./_seo-data');

/* The same key product-pulse.js uses, and for the same reason: this is a
   role rather than a person, so there is no signed-in administrator for
   the database to check. It must never appear anywhere a browser can
   read — it lives in Netlify's environment variables and nowhere else. */
function writeKey() {
  return String(process.env.WEB_SUPABASE_SERVICE_KEY || '').trim();
}

/* Four hundred days of raw events. Overridable, so a shop that wants a
   shorter memory can set one without a code change. */
function keepDays() {
  const n = parseInt(process.env.ANALYTICS_KEEP_DAYS || '400', 10);
  return Number.isFinite(n) && n >= 30 && n <= 3650 ? n : 400;
}

exports.handler = async function () {
  const ok = (msg, extra) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(Object.assign({ ok: true, message: msg }, extra || {}))
  });

  const cfg = readConfig();
  const url = String(cfg.url || '').replace(/\/+$/, '');
  const key = writeKey();

  /* Every missing piece is a reason to do nothing quietly. A scheduled
     function that throws once a day fills a log with something nobody
     can act on from here, and the only cost of doing nothing is a table
     that goes on growing as it already was. */
  if (!url) return ok('no website Supabase configured; nothing to prune');
  if (!key) return ok('WEB_SUPABASE_SERVICE_KEY is not set; nothing is being pruned');

  const days = keepDays();
  let res;
  try {
    res = await fetch(url + '/rest/v1/rpc/site_prune', {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_days: days, p_tz: 'UTC' })
    });
  } catch (e) {
    console.error('[site-prune]', e.message);
    return ok('the database could not be reached this time');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    /* A shop that has not run supabase-analytics.sql has no such
       function, and that is the correct answer rather than a fault:
       there is nothing to prune because nothing is being recorded. */
    console.error('[site-prune] ' + res.status + ' ' + detail.slice(0, 200));
    return ok('site_prune did not run', { status: res.status });
  }

  return ok('pruned', { keptDays: days });
};
