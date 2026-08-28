// Shared by robots.js and sitemap.js: the settings and the catalogue.
//
// Both read the website's own Supabase with the public anon key — the
// same key the storefront uses, and the same public-read rows. Nothing
// private is reachable from here, and the POS is not touched at all.
const fs = require('fs');
const path = require('path');

// config.js is deployed beside index.html. Reading it means the URL and
// key live in exactly one place rather than being duplicated into the
// Netlify environment as well, where the two could drift apart.
function readConfig() {
  const env = {
    url: process.env.WEB_SUPABASE_URL || '',
    key: process.env.WEB_SUPABASE_ANON_KEY || '',
  };
  if (env.url && env.key) return env;

  for (const p of [
    path.join(__dirname, 'config.js'),
    path.join(process.cwd(), 'config.js'),
  ]) {
    try {
      const src = fs.readFileSync(p, 'utf8');
      const url = /SUPABASE_URL\s*:\s*['"]([^'"]+)['"]/.exec(src);
      const key = /SUPABASE_ANON_KEY\s*:\s*['"]([^'"]+)['"]/.exec(src);
      if (url && key) return { url: url[1], key: key[1] };
    } catch (e) { /* try the next one */ }
  }
  return { url: '', key: '' };
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

module.exports = { rows, settings, originFrom, readConfig };
