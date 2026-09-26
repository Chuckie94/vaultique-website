/* ===========================================================================
   THE ADMIN SWITCHES FOR ONLINE PAYMENT

   Settings > Payments > Online payment, and Settings > Delivery > Delivery
   in online payments, driven through the real settings files with the
   form kit stood in. No browser.
   =========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let checks = 0, failures = 0;
const ok = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => c ? ok(m) : fail(m, x);

function load(file) {
  let spec = null, defaults = null;
  const sandbox = {
    window: { VBP_FORMAT: null }, console, Promise, setTimeout: () => {}, fetch: () => new Promise(() => {}),
    document: { createElement: () => ({ appendChild() {}, style: {}, classList: { add() {}, remove() {} } }) },
  };
  sandbox.window.VBP_ADMIN = {
    store: { registerDefaults(k, d) { defaults = d; }, load: () => Promise.resolve({}) },
    registerSetting(def) {
      const host = { querySelectorAll: () => [], appendChild() {} };
      def.render(host, { ui: { form(h, s) { spec = s; } }, tell() {}, navigate() {} });
    }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), sandbox);
  // Delivery reads three other sections before it draws its form.
  return new Promise(r => setImmediate(() => r({ spec, defaults })));
}
function field(spec, name) {
  for (const g of spec.groups) for (const f of g.fields) if (f.name === name) return f;
  return null;
}
function errors(spec, values) {
  const out = {};
  spec.validate(values, (k, m) => { out[k] = m; });
  return out;
}

(async () => {
console.log('\nSettings > Payments');
{
  const { spec, defaults } = await load('assets/admin/settings/payments.js');
  is(defaults.onlineEnabled === false && defaults.onlineMode === 'test',
     'online payment ships switched off, in test mode');
  is(spec.groups[0].title === 'Online payment', 'its card is first on the page');
  const mode = field(spec, 'onlineMode');
  is(mode && mode.options.map(o => o.value).join() === 'test,live', 'Test and Live are the two modes');
  is(!field(spec, 'onlineCard').showIf({ onlineEnabled: false }) && field(spec, 'onlineCard').showIf({ onlineEnabled: true }),
     'the options only show once it is switched on');
  is(field(spec, 'onlineConfirmEmail') && defaults.onlineConfirmEmail === true,
     'the automatic confirmation email is there, and on');
  const base = Object.assign({}, defaults, { cashEnabled: true, mobileEnabled: false });
  is(!errors(spec, base).onlineCard, 'switched off, nothing to complain about');
  is(!!errors(spec, Object.assign({}, base, { onlineEnabled: true, onlineCard: false, onlineMobile: false })).onlineCard,
     'switched on with neither cards nor mobile money is refused');
  is(!Object.values(defaults).some(v => typeof v === 'string' && /FLWSECK/.test(v)) &&
     !spec.groups.some(g => g.fields.some(f => /key|secret|hash/i.test(f.name))),
     'there is nowhere on the page to type a secret key: they live in Netlify only');
}

console.log('\nSettings > Delivery');
{
  const { spec, defaults } = await load('assets/admin/settings/delivery.js');
  is(defaults.payDelivery === false, 'adding delivery to online payments ships switched off');
  const t = field(spec, 'payDelivery');
  is(!!t && /online payments/.test(t.label), 'the switch is there: "' + (t && t.label) + '"');
  const fee = field(spec, 'standardFee');
  is(fee.showIf({ deliveryEnabled: true, showFees: false, payDelivery: true }),
     'the fee box appears when payments need it, even with fees hidden on the site');
  const v = Object.assign({}, defaults, { payDelivery: true, standardFee: '' });
  is(!!errors(spec, v).standardFee, 'switched on with no fee is refused, rather than charging nothing');
  is(!errors(spec, Object.assign({}, v, { standardFee: 80 })).standardFee, 'with a fee, it saves');

  console.log('\nSettings > Delivery, by town and weight');
  is(defaults.feeMethod === 'standard', 'one standard fee is the default, as before');
  is(['1', '2', '3'].every(n => ['Small', 'Medium', 'Large'].every(t => defaults['zone' + n + t] === '')),
     'every zone fee ships empty: no example prices', JSON.stringify(['1','2','3'].map(n => defaults['zone' + n + 'Small'])));
  is(defaults.tierSmallMax === 5 && defaults.tierMediumMax === 15, 'the weight tiers start at 5 kg and 15 kg, and can be changed');
  is(field(spec, 'towns') && field(spec, 'towns').fields[1].options.length === 3, 'towns are a list, each with its zone 1, 2 or 3');
  is(field(spec, 'zone2Medium').showIf({ deliveryEnabled: true, payDelivery: true, feeMethod: 'zones' }) &&
     !field(spec, 'zone2Medium').showIf({ deliveryEnabled: true, payDelivery: true, feeMethod: 'standard' }),
     'the table shows only when "by town and weight" is chosen');
  const z = Object.assign({}, defaults, { payDelivery: true, feeMethod: 'zones' });
  let e = errors(spec, z);
  is(!!e.towns && !e.standardFee, 'with no towns it asks for them, and no longer asks for a standard fee');
  e = errors(spec, Object.assign({}, z, { towns: [{ name: 'Kitwe', zone: 'zone2' }] }));
  is(!!e.zone2Small, 'a zone with towns but no fees is refused', JSON.stringify(e));
  e = errors(spec, Object.assign({}, z, { towns: [{ name: 'Kitwe', zone: 'zone2' }, { name: ' kitwe', zone: 'zone1' }], zone2Small: 1, zone1Small: 1 }));
  is(/twice/.test(e.towns || ''), 'the same town twice is refused', JSON.stringify(e));
  e = errors(spec, Object.assign({}, z, { towns: [{ name: 'Kitwe', zone: 'zone2' }], zone2Small: 1, tierMediumMax: 3 }));
  is(!!e.tierMediumMax, 'a medium limit below the small one is refused');
  e = errors(spec, Object.assign({}, z, { towns: [{ name: 'Kitwe', zone: 'zone2' }], zone2Small: 1 }));
  is(!Object.keys(e).length, 'set up properly, it saves', JSON.stringify(e));
}

console.log('\n' + (failures ? '  ✗ ' + failures + ' of ' + checks + ' checks FAILED'
                              : '  payment settings: all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
})();
