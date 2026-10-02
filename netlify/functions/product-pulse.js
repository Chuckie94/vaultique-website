// Vaultique Boutique Point — the product pulse
// ---------------------------------------------------------------------------
// WHAT THIS IS FOR
//
// The storefront needs to know WHEN the shop's catalogue has changed, so that a
// browser already open redraws itself instead of waiting for somebody to press
// refresh. The requirement is that it must not sit there asking for the whole
// catalogue over and over.
//
// So nothing polls the catalogue. This runs on a schedule and reads ONE COLUMN
// OF ONE ROW from the platform — `updated_at` — which is a few bytes and says
// nothing about what changed, only that something did. When that stamp moves,
// it writes a new row into THIS WEBSITE'S own Supabase, and every open browser
// hears about it through Realtime at once and fetches the feed then, and only
// then.
//
// WHY THE BROWSER CANNOT LISTEN TO THE PLATFORM DIRECTLY
//
// That would be simpler and it is the first thing to reach for. It cannot be
// done safely. Subscribing to the platform's database from a browser means
// shipping the platform's key to every visitor, and that key can read the whole
// app_state row: every sale, every customer, every staff record. The entire
// reason /api/products exists is to stand between that row and the public and
// hand out six safe fields. Putting the key in the page would walk straight
// around it.
//
// So the signal is relayed through the website's own project, whose key is
// already public and whose tables hold nothing but this site's own content.
// The pulse row carries a timestamp and a counter. Nothing else. Even read by
// a stranger it says only "the shop changed something at 14:32".
//
// COST, PLAINLY
//
// This is a scheduled function, so it costs one invocation per run whether or
// not anything changed. At the default of every five minutes that is about
// 8,600 a month. Raise PULSE_SCHEDULE in netlify.toml to spend less; the
// storefront's own fallback still catches anything missed either way.
//
// IF THIS FUNCTION NEVER RUNS AT ALL — not deployed, not scheduled, no table,
// no key — the website still works and still updates. The storefront falls back
// to a slow refresh on its own. This makes it prompt; it is not what makes it
// correct.
// ---------------------------------------------------------------------------

const { readConfig } = require('./_seo-data');

const POS_URL =
  process.env.POS_SUPABASE_URL || 'https://xbrchpxdmptwuvivdiqj.supabase.co';
const POS_KEY =
  process.env.POS_SUPABASE_KEY ||
  'sb_publishable_wj1gGEwOnLu_HlBRkbeZvA_tCHEk1vR';

// The same row /api/products reads. See the note there about row 1 and row 100.
const STATE_ROW = String(process.env.POS_STATE_ROW || '100').trim();

const PULSE_TABLE = 'product_pulse';
const PULSE_ID = 1;

// Writing to this site's own database needs a key that is allowed to write.
// The anon key is not, deliberately: the pulse table lets anyone READ (it is a
// timestamp) and nobody but the service role WRITE, so a visitor cannot invent
// a change and make every browser in the shop refetch.
function writeKey() {
  return String(process.env.WEB_SUPABASE_SERVICE_KEY || '').trim();
}

async function posUpdatedAt() {
  const res = await fetch(
    `${POS_URL}/rest/v1/app_state?id=eq.${STATE_ROW}&select=updated_at`,
    {
      headers: {
        apikey: POS_KEY,
        Authorization: `Bearer ${POS_KEY}`,
        Accept: 'application/json',
      },
    }
  );
  if (!res.ok) throw new Error('platform read failed: ' + res.status);
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  return (row && row.updated_at) || '';
}

async function readPulse(url, key) {
  const res = await fetch(
    `${url}/rest/v1/${PULSE_TABLE}?id=eq.${PULSE_ID}&select=*`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    }
  );
  if (!res.ok) return null;                 // no table yet: treated as "nothing known"
  const rows = await res.json();
  return (Array.isArray(rows) ? rows[0] : rows) || null;
}

async function writePulse(url, key, posStamp, previous) {
  const body = [{
    id: PULSE_ID,
    pos_updated_at: posStamp,
    // A number that only ever goes up, so a browser can tell a genuinely new
    // pulse from the same one delivered twice.
    revision: Number((previous && previous.revision) || 0) + 1,
    changed_at: new Date().toISOString(),
  }];
  const res = await fetch(`${url}/rest/v1/${PULSE_TABLE}?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('pulse write failed: ' + res.status + ' ' + detail.slice(0, 200));
  }
}

exports.handler = async function () {
  const ok = (msg, extra) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(Object.assign({ ok: true, message: msg }, extra || {})),
  });

  const cfg = readConfig();
  const url = String(cfg.url || '').replace(/\/+$/, '');
  const key = writeKey();

  // EVERY MISSING PIECE IS A REASON TO DO NOTHING QUIETLY, never to fail loudly.
  // The storefront's fallback covers all of these, and a scheduled function
  // that throws every five minutes fills a log with something nobody can act on
  // from here.
  if (!url) return ok('no website Supabase configured; nothing to signal through');
  if (!key) return ok('WEB_SUPABASE_SERVICE_KEY is not set; the pulse is not being written');

  let posStamp;
  try {
    posStamp = await posUpdatedAt();
  } catch (e) {
    console.error('[product-pulse]', e.message);
    return ok('the platform could not be read this time');
  }
  if (!posStamp) return ok('the platform reported no timestamp');

  const previous = await readPulse(url, key);

  // THE WHOLE POINT: when nothing has moved, nothing is written, so no browser
  // is woken and no catalogue is fetched.
  if (previous && String(previous.pos_updated_at || '') === String(posStamp)) {
    return ok('unchanged', { posUpdatedAt: posStamp });
  }

  try {
    await writePulse(url, key, posStamp, previous);
  } catch (e) {
    console.error('[product-pulse]', e.message);
    return ok('the pulse could not be written this time');
  }

  return ok('pulse sent', {
    posUpdatedAt: posStamp,
    revision: Number((previous && previous.revision) || 0) + 1,
  });
};
