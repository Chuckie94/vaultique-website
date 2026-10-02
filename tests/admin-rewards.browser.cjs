/* ===========================================================================
   ADMIN > REWARDS -- driven in a real browser, with the database scripted.

   The team sees what the website did (requests, points promised on website
   orders, linked accounts) and nothing from the platform.
   =========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/admin/admin.css"></head><body>
<div class="wrap"><div id="host"></div></div>
<script src="/assets/admin/registry.js"></script>
<script>
window.RPC = [];
window.DATA = {
  rewards_requests: [
    { id: 'q1', user_id: 'u1', kind: 'link', cust_no: 'VB0008', status: 'waiting', created_at: '2026-10-02T09:00:00Z' },
    { id: 'q2', user_id: 'u2', kind: 'join', name: 'Eve Tembo', phone: '0977 123 456', status: 'waiting', created_at: '2026-10-02T10:00:00Z' }],
  rewards_holds: [{ id: 'h1', user_id: 'u3', cust_no: 'VB0007', order_ref: 'RW-ABC234', points: 60000, value: 30, status: 'promised', created_at: '2026-10-02T11:00:00Z' }],
  rewards_links: [{ user_id: 'u3', cust_no: 'VB0007', how: 'code', linked_at: '2026-10-01T08:00:00Z' }],
  customers: [{ id: 'u1', name: 'Mwila Banda', phone: '0977000008' }, { id: 'u3', name: 'Chanda Phiri', phone: '0977000007' }]
};
function q(t) { var b = { select: function(){return b;}, eq: function(){return b;}, order: function(){return b;}, limit: function(){return b;},
  in: function(){return b;}, then: function(a, c) { return Promise.resolve({ data: window.DATA[t] || [], error: window.FAIL ? { message: 'relation "public.rewards_requests" does not exist' } : null }).then(a, c); } }; return b; }
window.__sb = { from: q, rpc: function (n, a) { window.RPC.push([n, a]); return Promise.resolve({ data: null, error: null }); } };
window.confirm = function () { return true; };
</script>
<script src="/assets/admin/rewards.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(''); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(fs.readFileSync(f));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:' + server.address().port + '/');
    const render = () => page.evaluate(() => { const h = document.getElementById('host'); h.innerHTML = '';
      window.VBP_ADMIN.pages.rewards.render(h, { sb: window.__sb }); });
    await render(); await page.waitForTimeout(300);
    const t = (await page.textContent('#host')).replace(/\s+/g, ' ');
    is(/Link customer number VB0008/.test(t) && /Mwila Banda/.test(t), 'a link request, with the website account\'s own name', t.slice(0, 300));
    is(/Register Eve Tembo/.test(t), 'a request to be registered');
    is(/RW-ABC234 · customer number VB0007/.test(t) && /60,000 points \(−K30\.00\)/.test(t), 'points promised on a website order, with its reference');
    is(/Customer number VB0007/.test(t) && /confirmed by email code/.test(t), 'linked accounts');
    is(!/balance|points left/i.test(t), 'and no balance from the platform anywhere on the page');
    await page.fill('.rw-num', 'vb-0042');
    await page.click('.rw-row:has(.rw-num) button.btn-gold'); await page.waitForTimeout(200);
    await page.click('text=Rung up on the till'); await page.waitForTimeout(200);
    await page.click('text=Approve'); await page.waitForTimeout(200);
    const rpc = await page.evaluate(() => window.RPC);
    is(rpc.some(r => r[0] === 'rewards_settle' && r[1].p_hold === 'h1' && r[1].p_rung_up === true), 'rung up on the till is recorded');
    is(rpc.some(r => r[0] === 'rewards_decide' && r[1].p_request === 'q1' && r[1].p_approve === true), 'and a link approved');
    is(rpc.some(r => r[0] === 'rewards_join_done' && r[1].p_request === 'q2' && r[1].p_cust_no === 'vb-0042'),
       'a join finished with the new customer number links the account in one step');
    await page.evaluate(() => { window.FAIL = true; }); await render(); await page.waitForTimeout(300);
    is(/supabase-rewards\.sql/.test(await page.textContent('#host')), 'before its SQL is run, the page says what to run');
    is(errors.length === 0, 'no errors on the page', errors.join(' | '));
  } catch (e) { is(false, 'the test itself broke', e && e.stack); }
  finally { await browser.close(); server.close(); }
  console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  admin rewards: all ' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
})();
