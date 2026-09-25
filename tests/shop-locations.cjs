/* ===========================================================================
   SHOP LOCATIONS — the admin finds each place so the map can pin it

   THE OWNER: "the red location icon should be where the store is currently
   listed. If 10 places are listed, it should show exactly those places."

   The website map pins positions, not words, so Settings > General looks
   each address up when it is saved and keeps the answer (mapPoints). This
   drives the real settings file with a stand-in for the address search.
   No browser.
   =========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, extra) => { checks++; failures++; console.log('  ✗ ' + m + (extra ? '\n      ' + extra : '')); };
const is   = (c, m, extra) => c ? ok(m) : fail(m, extra);

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'assets/admin/settings/general.js'), 'utf8');

/* Where the stand-in "finds" things. Anything not listed is not found. */
const PLACES = {
  'Mosi-oa-Tunya Road, Livingstone, Zambia': [-17.85, 25.85],
  'Manda Hill, Great East Road, Lusaka, Zambia': [-15.40, 28.30],
  'Kitwe Mall, Kitwe, Zambia': [-12.80, 28.20]
};

function load() {
  const asked = [];
  let spec = null, told = null;
  const sandbox = {
    window: {}, console, Promise, setTimeout: (fn) => setTimeout(fn, 0), encodeURIComponent,
    isFinite, Number, String, Array, Object,
    fetch: async (url) => {
      const q = decodeURIComponent(String(url).split('&q=')[1] || '');
      asked.push(q);
      const at = PLACES[q];
      return { ok: true, json: async () => at ? [{ lat: String(at[0]), lon: String(at[1]) }] : [] };
    }
  };
  sandbox.window.VBP_ADMIN = {
    store: { registerDefaults() {} },
    registerSetting(def) {
      def.render({}, { ui: { form(host, s) { spec = s; } }, tell(m) { told = m; } });
    }
  };
  vm.runInNewContext(SRC, sandbox);
  return { spec, asked, told: () => told };
}

(async () => {
  console.log('\nOne shop, and two more listed');
  let { spec, asked, told } = load();
  const values = {
    businessName: 'Vaultique', country: 'Zambia', city: 'Livingstone', address: 'Mosi-oa-Tunya Road',
    locations: [{ name: 'Lusaka', address: 'Manda Hill, Great East Road, Lusaka' },
                { name: 'Kitwe', address: 'Kitwe Mall, Kitwe' }]
  };
  spec.afterLoad({ mapPoints: [] });
  const saved = await spec.beforeSave(values);
  const pts = saved.mapPoints || [];
  is(pts.length === 3, 'every place listed gets a pin: the main address and both others', JSON.stringify(pts));
  is(pts[0] && pts[0].lat === -17.85 && pts[0].name === 'Vaultique', 'the main address is found where it is');
  is(pts[1] && pts[1].name === 'Lusaka' && pts[1].lng === 28.30, 'and so is each other shop, under its own name');
  spec.afterSave();
  is(told() === null, 'nothing to report when everything was found');

  console.log('\nSaving again asks for nothing it already knows');
  ({ spec, asked, told } = load());
  spec.afterLoad({ mapPoints: pts });
  await spec.beforeSave(Object.assign({}, values));
  is(asked.length === 0, 'an unchanged address keeps its position without being looked up again', JSON.stringify(asked));

  console.log('\nAn address that cannot be found');
  ({ spec, asked, told } = load());
  spec.afterLoad({ mapPoints: pts });
  const v2 = Object.assign({}, values, { locations: values.locations.concat([{ name: 'Nowhere', address: 'Plot 999 Unknown' }]) });
  const s2 = await spec.beforeSave(v2);
  is(s2.mapPoints.length === 3 && asked.length === 1, 'is asked about once, and left without a pin', JSON.stringify(asked));
  spec.afterSave();
  is(/Nowhere/.test(told() || ''), 'and the owner is told which one', told());

  console.log('\n' + (failures ? 'shop locations: ' + failures + ' of ' + checks + ' checks FAILED'
                                : 'shop locations: all ' + checks + ' checks passed'));
  process.exit(failures ? 1 : 0);
})();
