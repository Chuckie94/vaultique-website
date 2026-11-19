// Shared by robots.js and sitemap.js: the settings and the catalogue.
//
// Both read the website's own Supabase with the public anon key — the
// same key the storefront uses, and the same public-read rows. Nothing
// private is reachable from here, and the POS is not touched at all.
const fs = require('fs');
const path = require('path');

// config.js is deployed beside index.html, and netlify.toml puts it in
// the function bundle with it. Reading it means the URL and key live in
// exactly one place rather than being copied into the Netlify
// environment as well, where the two could drift apart.
//
// Where the bundler puts the running code, and so where the included
// file sits relative to it, is not a thing to depend on. The working
// directory is tried first because that is the root of the bundle, then
// the code's own directory and every directory above it. The first that
// parses wins.
function configPaths() {
  const out = [];
  const add = (p) => { if (p && out.indexOf(p) < 0) out.push(p); };
  add(path.join(process.cwd(), 'config.js'));
  let dir = __dirname;
  for (let i = 0; i < 6 && dir; i++) {
    add(path.join(dir, 'config.js'));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}

// Read once and kept. It cannot change while the function is alive, and
// rows() would otherwise go back to the disk on every call. A failure is
// deliberately not kept: there is nothing to save, and re-reading keeps
// the answer honest if the deploy is put right underneath us.
let held = null;

function readConfig() {
  if (held) return held;

  /* WEB_SUPABASE_* is the one pair of names (build 77, plan 3.4).
     admin-users.js used to read SITE_SUPABASE_* instead, so either is
     still understood. Usually neither is set and config.js answers. */
  const env = {
    url: process.env.WEB_SUPABASE_URL || process.env.SITE_SUPABASE_URL || '',
    key: process.env.WEB_SUPABASE_ANON_KEY || process.env.SITE_SUPABASE_ANON_KEY || '',
  };
  if (env.url && env.key) { held = env; return held; }

  for (const p of configPaths()) {
    try {
      const src = fs.readFileSync(p, 'utf8');
      // The guard in front of each name is what stops POS_SUPABASE_URL,
      // if a site ever grows one, from being read as this site's own.
      const url = /(?:^|[^\w])SUPABASE_URL\s*:\s*['"]([^'"]+)['"]/m.exec(src);
      const key = /(?:^|[^\w])SUPABASE_ANON_KEY\s*:\s*['"]([^'"]+)['"]/m.exec(src);
      if (url && key) { held = { url: url[1], key: key[1] }; return held; }
    } catch (e) { /* try the next one */ }
  }
  return { url: '', key: '' };
}

// The website's own service key, for every function that needs one (build
// 77, plan 3.4). SETUP.md asks for SUPABASE_SERVICE_ROLE_KEY; the nightly
// clean-up, the product pulse and the visitor map used to read
// WEB_SUPABASE_SERVICE_KEY instead, so a shop that had set only one of the
// two names had half its functions quietly doing nothing. Every function
// asks here now, and either name works.
function serviceKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.WEB_SUPABASE_SERVICE_KEY || '').trim();
}

async function rows(table, query) {
  const { url, key } = readConfig();
  if (!url || !key) return [];
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/${table}?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

async function settings(key) {
  const r = await rows('site_settings', `key=eq.${encodeURIComponent(key)}&select=data`);
  return (r && r[0] && r[0].data) || {};
}

// The site's own address, used when Settings > SEO has not stated one.
// A sitemap full of relative addresses is a sitemap nobody can follow.
function originFrom(event) {
  const proto = (event.headers && event.headers['x-forwarded-proto']) || 'https';
  const host = (event.headers && (event.headers.host || event.headers['x-forwarded-host'])) || '';
  return host ? `${proto}://${host}` : '';
}

// Whether a preview key is right (build 76). Since supabase-hardening.sql
// the key is in the private settings and only the database can say; on a
// database from before that, preview_ok still reads the public settings.
// Either way it is the same question, asked with the public key.
async function previewOk(preview) {
  const asked = String(preview || '').trim();
  if (!asked) return false;
  const { url, key } = readConfig();
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/preview_ok`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: asked }),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch (e) {
    return false;
  }
}

module.exports = { rows, settings, originFrom, readConfig, previewOk, serviceKey };
