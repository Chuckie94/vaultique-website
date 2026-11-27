/* ===========================================================================
   STAND-INS FOR THE BACKUP'S TESTS (website build 92)

   An S3 storage account (Backblaze B2 speaks the same protocol) that checks
   every request's signature the way S3 does and keeps objects in memory, and
   Supabase's Storage API with a few pictures in it. Used by
   tests/backups.test.cjs and tests/backup-cycle.js. They prove what the
   backup does with each answer; that a real B2 account answers so is proved
   the first time the backup runs on GitHub with your account.
   =========================================================================== */
'use strict';
const http = require('http');
const crypto = require('crypto');
const S3 = require('../tools/backup/s3.cjs');

const read = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function startS3(opts) {
  opts = opts || {};
  const keyId = opts.keyId || 'K005-test-key-id', secret = opts.secret || 'K005-test-secret-0123456789', region = opts.region || 'eu-central-003';
  const bucket = opts.bucket || 'vaultique-backups';
  const st = { objects: new Map(), refused: 0, calls: [], down: false };
  const server = http.createServer(async (req, res) => {
    const body = await read(req);
    const u = new URL(req.url, 'http://x');
    st.calls.push(req.method + ' ' + u.pathname);
    const send = (code, text, type) => { res.writeHead(code, { 'Content-Type': type || 'application/xml' }); res.end(text || ''); };
    if (st.down) return req.socket.destroy();
    // The signature, worked out again here from what arrived.
    const auth = String(req.headers.authorization || '');
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
    const headers = {};
    if (m) m[4].split(';').forEach((h) => { headers[h] = h === 'host' ? req.headers.host : req.headers[h]; });
    const query = {};
    for (const [k, v] of u.searchParams) query[k] = v;
    const ok = m && m[1] === keyId && m[3] === region &&
      crypto.createHash('sha256').update(body).digest('hex') === req.headers['x-amz-content-sha256'] &&
      S3.sign({ method: req.method, path: u.pathname, query, headers, region, keyId, secret }).signature === m[5];
    if (!ok) { st.refused++; return send(403, '<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message></Error>'); }
    const parts = u.pathname.split('/').slice(1).map(decodeURIComponent);
    if (parts[0] !== bucket) return send(404, '<Error><Code>NoSuchBucket</Code><Message>No such bucket</Message></Error>');
    const key = parts.slice(1).join('/');
    if (req.method === 'PUT') {
      // st.corrupt: the storage keeps something other than what it was sent (a fault, for the tests).
      const kept = st.corrupt ? Buffer.concat([body.slice(0, Math.max(0, body.length - 1)), Buffer.from('!')]) : body;
      st.objects.set(key, { body: kept, at: new Date().toISOString() }); return send(200, '');
    }
    if (req.method === 'GET' && key) {
      const o = st.objects.get(key);
      if (!o) return send(404, '<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(o.body);
    }
    if (req.method === 'DELETE') { st.objects.delete(key); return send(204, ''); }
    if (req.method === 'GET' && query['list-type'] === '2') {
      const all = Array.from(st.objects.keys()).filter((k) => k.indexOf(query.prefix || '') === 0).sort();
      const start = query['continuation-token'] ? Number(Buffer.from(query['continuation-token'], 'base64').toString()) : 0;
      const max = Math.min(Number(query['max-keys'] || 1000), opts.pageSize || 1000);
      const page = all.slice(start, start + max);
      const more = start + max < all.length;
      return send(200, '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>' + bucket + '</Name><IsTruncated>' + more + '</IsTruncated>' +
        page.map((k) => '<Contents><Key>' + xml(k) + '</Key><LastModified>' + st.objects.get(k).at + '</LastModified><Size>' +
                        st.objects.get(k).body.length + '</Size></Contents>').join('') +
        (more ? '<NextContinuationToken>' + Buffer.from(String(start + max)).toString('base64') + '</NextContinuationToken>' : '') + '</ListBucketResult>');
    }
    send(400, '<Error><Code>InvalidRequest</Code></Error>');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({
    st, server, cfg: { endpoint: 'http://127.0.0.1:' + server.address().port, region, bucket, keyId, secret },
    close: () => new Promise((d) => server.close(d)) })));
}

function startStorage(opts) {
  opts = opts || {};
  const key = opts.serviceKey || 'service-key-for-tests';
  const st = { buckets: opts.buckets || {}, downloads: 0 };
  const server = http.createServer(async (req, res) => {
    const body = await read(req);
    const u = new URL(req.url, 'http://x');
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer ' + key || req.headers.apikey !== key) return json(401, { message: 'Invalid JWT' });
    // The run's line in backup_runs (supabase-backup.sql), as PostgREST takes it.
    if (u.pathname === '/rest/v1/backup_runs' && req.method === 'POST') {
      if (st.noTable) return json(404, { code: 'PGRST205', message: 'Could not find the table public.backup_runs' });
      (st.runs = st.runs || []).push(JSON.parse(body.toString())); res.writeHead(201); return res.end();
    }
    if (u.pathname === '/storage/v1/bucket') return json(200, Object.keys(st.buckets).map((b) => ({ id: b, name: b, public: b !== 'chat-photos' })));
    let m = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(u.pathname);
    if (m && req.method === 'POST') {
      const b = st.buckets[decodeURIComponent(m[1])] || {};
      const q = JSON.parse(body.toString() || '{}');
      const prefix = q.prefix ? q.prefix + '/' : '';
      const names = new Map();
      Object.keys(b).filter((p) => p.indexOf(prefix) === 0).forEach((p) => {
        const rest = p.slice(prefix.length);
        const i = rest.indexOf('/');
        if (i > -1) names.set(rest.slice(0, i), { name: rest.slice(0, i), id: null, metadata: null });
        else names.set(rest, { name: rest, id: crypto.createHash('md5').update(p).digest('hex'), updated_at: b[p].at,
                               metadata: { size: b[p].data.length, mimetype: b[p].type, eTag: '"' + crypto.createHash('md5').update(b[p].data).digest('hex') + '"' } });
      });
      const list = Array.from(names.values()).sort((a, c) => a.name.localeCompare(c.name));
      return json(200, list.slice(q.offset || 0, (q.offset || 0) + (q.limit || 100)));
    }
    m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (m && req.method === 'GET') {
      const f = (st.buckets[decodeURIComponent(m[1])] || {})[m[2].split('/').map(decodeURIComponent).join('/')];
      if (!f) return json(404, { message: 'Object not found' });
      st.downloads++;
      res.writeHead(200, { 'Content-Type': f.type }); return res.end(f.data);
    }
    json(404, { message: 'not here' });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({
    st, server, url: 'http://127.0.0.1:' + server.address().port, serviceKey: key,
    close: () => new Promise((d) => server.close(d)) })));
}

module.exports = { startS3, startStorage };
