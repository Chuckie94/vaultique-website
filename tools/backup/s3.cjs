/* =====================================================================
   THE STORAGE ACCOUNT (website build 92)

   Your own storage account, outside Supabase and outside GitHub: any
   service that speaks the S3 protocol. Backblaze B2 is the one SETUP.md
   walks through (10 GB free); Cloudflare R2, Wasabi or Amazon S3 work the
   same way. Four things from it, kept as GitHub secrets: the address
   (endpoint), the region, the bucket, and a key (its id and secret).

   Every request is signed with AWS Signature Version 4, as S3 requires.
   Nothing here needs anything but Node itself.
   ===================================================================== */
'use strict';
const crypto = require('crypto');

const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
// RFC 3986, as SigV4 wants it: everything but A-Z a-z 0-9 - _ . ~ escaped.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => p.split('/').map(enc).join('/');

/* The signature for one request. `headers` must already hold host,
   x-amz-date and x-amz-content-sha256. Exported for the known example in
   AWS's own documentation (tests/backup.test.cjs). */
function sign({ method, path, query, headers, region, keyId, secret, service }) {
  const amzDate = headers['x-amz-date'];
  const day = amzDate.slice(0, 8);
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = {};
  Object.keys(headers).forEach((h) => { lower[h.toLowerCase()] = String(headers[h]).trim().replace(/\s+/g, ' '); });
  const canonicalQuery = Object.keys(query || {}).sort().map((k) => enc(k) + '=' + enc(String(query[k]))).join('&');
  const canonical = [method, path, canonicalQuery, names.map((h) => h + ':' + lower[h]).join('\n') + '\n', names.join(';'),
                     lower['x-amz-content-sha256']].join('\n');
  const scope = day + '/' + region + '/' + (service || 's3') + '/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), service || 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return { signature, authorization: 'AWS4-HMAC-SHA256 Credential=' + keyId + '/' + scope + ', SignedHeaders=' + names.join(';') +
                                     ', Signature=' + signature, canonical, toSign };
}

function client(cfg) {
  const endpoint = String(cfg.endpoint || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/.test(endpoint)) throw new Error('The storage address must look like https://s3.eu-central-003.backblazeb2.com');
  if (!cfg.bucket || !cfg.keyId || !cfg.secret || !cfg.region) throw new Error('The storage bucket, region and key are needed.');
  const host = endpoint.replace(/^https?:\/\//, '');
  const timeoutMs = cfg.timeoutMs || 60000;

  async function request(method, key, opts) {
    opts = opts || {};
    const body = opts.body === undefined ? Buffer.alloc(0) : (Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body));
    const path = '/' + enc(cfg.bucket) + (key ? '/' + encPath(key) : '');
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const headers = Object.assign({ host, 'x-amz-date': amzDate, 'x-amz-content-sha256': sha256hex(body) }, opts.headers || {});
    const s = sign({ method, path, query: opts.query, headers, region: cfg.region, keyId: cfg.keyId, secret: cfg.secret });
    const qs = Object.keys(opts.query || {}).sort().map((k) => enc(k) + '=' + enc(String(opts.query[k]))).join('&');
    const send = Object.assign({}, headers, { authorization: s.authorization });
    delete send.host;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint + path + (qs ? '?' + qs : ''), { method, headers: send, body: method === 'GET' || method === 'HEAD' ? undefined : body,
                                                                       signal: ctl.signal });
      const data = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, body: data };
    } finally { clearTimeout(timer); }
  }
  const fail = (what, r) => {
    const code = (/<Code>([^<]+)<\/Code>/.exec(r.body.toString()) || [])[1] || '';
    const msg = (/<Message>([^<]+)<\/Message>/.exec(r.body.toString()) || [])[1] || '';
    return new Error('Storage ' + what + ': ' + r.status + (code ? ' ' + code : '') + (msg ? ', ' + msg : ''));
  };
  const unxml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  return {
    async put(key, body, contentType) {
      const r = await request('PUT', key, { body, headers: { 'content-type': contentType || 'application/octet-stream' } });
      if (r.status !== 200) throw fail('could not keep ' + key, r);
      return true;
    },
    async get(key) {
      const r = await request('GET', key);
      if (r.status === 404) return null;
      if (r.status !== 200) throw fail('could not read ' + key, r);
      return r.body;
    },
    async del(key) {
      const r = await request('DELETE', key);
      if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw fail('could not delete ' + key, r);
      return true;
    },
    /* Every key under a prefix, with its size and when it was written. */
    async list(prefix) {
      const out = [];
      let token = '';
      for (let page = 0; page < 1000; page++) {
        const query = { 'list-type': '2', prefix: prefix || '', 'max-keys': '1000' };
        if (token) query['continuation-token'] = token;
        const r = await request('GET', '', { query });
        if (r.status !== 200) throw fail('could not list ' + (prefix || 'the bucket'), r);
        const x = r.body.toString();
        const re = /<Contents>([\s\S]*?)<\/Contents>/g;
        let m;
        while ((m = re.exec(x))) {
          const c = m[1];
          out.push({ key: unxml((/<Key>([\s\S]*?)<\/Key>/.exec(c) || [])[1] || ''),
                     size: Number((/<Size>(\d+)<\/Size>/.exec(c) || [])[1] || 0),
                     lastModified: (/<LastModified>([^<]+)<\/LastModified>/.exec(c) || [])[1] || '' });
        }
        const truncated = /<IsTruncated>true<\/IsTruncated>/.test(x);
        token = unxml((/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(x) || [])[1] || '');
        if (!truncated || !token) break;
      }
      return out;
    },
  };
}

module.exports = { client, sign, sha256hex };
