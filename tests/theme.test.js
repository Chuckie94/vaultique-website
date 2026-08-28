/* =====================================================================
   The theme engine, on its own. No browser needed: these are the colour
   sums and the decisions the Branding section will be built on.
   ===================================================================== */
const path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'assets', 'theme.js'));
const T = global.window.VBP_THEME;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : '')); } };

console.log('\n== defaults rebuild the original palette ==');
{
  const v = T.variables({});
  const original = {
    'navy': '#0b1f3a', 'navy-2': '#0e2545', 'navy-3': '#06152c',
    'gold': '#c8a24a', 'gold-2': '#d9bf7e', 'gold-deep': '#a9842f',
    'gold-3': '#d8bd7b', 'gold-deep-2': '#7a5c12',
    'ivory': '#fbf8f0', 'cream': '#f4efe3', 'paper': '#f7f3ea',
    'cream-2': '#ece7da', 'cream-3': '#f5f1e6', 'sand': '#d9cdb0',
    'ink': '#15202e', 'muted': '#6b7480', 'slate': '#33404f'
  };
  const off = Object.keys(original).filter(k => String(v[k]).toLowerCase() !== original[k]);
  ok('all 17 shades match the shipped palette', off.length === 0, off);
  ok('navy channels are exact', v['navy-rgb'] === '11,31,58', v['navy-rgb']);
  ok('gold channels are exact', v['gold-rgb'] === '200,162,74', v['gold-rgb']);
  ok('the accent defaults to the gold', v['accent'] === '#C8A24A', v['accent']);
  ok('navy is written on the gold button, as the design has it',
     v['btn-on'] === '#0B1F3A', v['btn-on']);
  ok('white is written on the navy button', v['navy-on'] === '#ffffff', v['navy-on']);
  ok('the rounding scale is untouched at the default',
     v['radius-xs'] === '2px' && v['radius-lg'] === '8px', [v['radius-xs'], v['radius-lg']]);
}

console.log('\n== the engine agrees with the stylesheet ==');
{
  // The stylesheet declares every themeable variable at its shipped value,
  // and the engine recomputes them. If the two ever drift, a shop that has
  // never touched Branding gets a slightly different site the moment the
  // engine loads. That is exactly what happened to the shop hero eyebrow:
  // --accent-soft was re-derived instead of read from the designed palette
  // and came out one step off.
  const fs = require('fs');
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'styles.css'), 'utf8');
  const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
  const declared = {};
  root.replace(/--([a-z0-9-]+):([^;]+);/g, (m, k, v) => { declared[k] = v.trim(); return m; });

  const emitted = T.variables({});
  const shared = Object.keys(emitted).filter(k => k in declared);
  const drifted = shared.filter(k =>
    String(declared[k]).toLowerCase() !== String(emitted[k]).toLowerCase());

  ok('the engine and the stylesheet share a good number of variables',
     shared.length >= 25, shared.length);
  ok('and every shared one matches exactly', drifted.length === 0,
     drifted.map(k => k + ': css=' + declared[k] + ' theme=' + emitted[k]));
}

console.log('\n== a chosen colour keeps its hue ==');
{
  const v = T.variables({ primaryColour: '#14532d' });      // a deep green
  const hue = h => { const [r, g, b] = T.parseHex(h);
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
    if (mx === mn) return 0;
    const d = mx - mn;
    let x = mx === r ? ((g-b)/d + (g<b?6:0)) : mx === g ? ((b-r)/d+2) : ((r-g)/d+4);
    return Math.round(x * 60); };
  const base = hue('#14532d');
  ok('the lighter shade keeps the hue', Math.abs(hue(v['navy-2']) - base) <= 2, [base, hue(v['navy-2'])]);
  ok('the darker shade keeps the hue', Math.abs(hue(v['navy-3']) - base) <= 2, [base, hue(v['navy-3'])]);
  ok('the lighter shade really is lighter',
     T.luminance(v['navy-2']) > T.luminance('#14532d'));
  ok('the darker shade really is darker',
     T.luminance(v['navy-3']) < T.luminance('#14532d'));
}

console.log('\n== a dark background inverts the shades ==');
{
  const light = T.variables({ backgroundColour: '#FBF8F0', textColour: '#15202e' });
  const dark  = T.variables({ backgroundColour: '#1a1a1a', textColour: '#f5f5f5' });
  ok('on a pale background the shades step darker',
     T.luminance(light['cream']) < T.luminance(light['ivory']));
  ok('on a dark background they step lighter instead',
     T.luminance(dark['cream']) > T.luminance(dark['ivory']),
     [dark['ivory'], dark['cream']]);
  ok('muted text stays readable against a dark background',
     T.contrastRatio(dark['muted'], '#1a1a1a') >= 3,
     T.contrastRatio(dark['muted'], '#1a1a1a').toFixed(2));
  ok('muted text stays readable against a pale one',
     T.contrastRatio(light['muted'], '#FBF8F0') >= 3,
     T.contrastRatio(light['muted'], '#FBF8F0').toFixed(2));
}

console.log('\n== text is chosen for contrast, not habit ==');
{
  const pale = T.variables({ buttonColour: '#FFE9A8' });     // a very pale button
  const deep = T.variables({ buttonColour: '#1c1c1c' });     // a very dark one
  ok('a pale button gets dark text', T.luminance(pale['btn-on']) < 0.2, pale['btn-on']);
  ok('a dark button gets light text', T.luminance(deep['btn-on']) > 0.7, deep['btn-on']);
  ok('the pale pairing clears 4.5:1',
     T.contrastRatio('#FFE9A8', pale['btn-on']) >= 4.5,
     T.contrastRatio('#FFE9A8', pale['btn-on']).toFixed(2));
  ok('the dark pairing clears 4.5:1',
     T.contrastRatio('#1c1c1c', deep['btn-on']) >= 4.5,
     T.contrastRatio('#1c1c1c', deep['btn-on']).toFixed(2));
}

console.log('\n== presets ==');
{
  ok('sharp rounding flattens the scale',
     T.variables({ borderRadius: 'sharp' })['radius-lg'] === '0px');
  ok('soft rounding doubles it',
     T.variables({ borderRadius: 'soft' })['radius-lg'] === '16px');
  ok('a pill button is a pill',
     T.variables({ buttonStyle: 'pill' })['btn-radius'] === '999px');
  ok('a square button is not',
     T.variables({ buttonStyle: 'sharp' })['btn-radius'] === '2px');
  ok('an unknown rounding falls back to the normal scale',
     T.variables({ borderRadius: 'wat' })['radius-lg'] === '8px');
}

console.log('\n== fonts ==');
{
  ok('the default pair needs no extra request', T.fontHref({}) === '', T.fontHref({}));
  const href = T.fontHref({ headingFont: 'playfair', bodyFont: 'inter' });
  ok('a changed pair asks Google for both',
     href.includes('Playfair+Display') && href.includes('Inter'), href);
  ok('the request is display=swap so text is never invisible',
     href.includes('display=swap'), href);
  ok('the stack reaches the page',
     /^'Inter'/.test(T.variables({ bodyFont: 'inter' })['font-body']),
     T.variables({ bodyFont: 'inter' })['font-body']);
  ok('every listed font has a family, a stack and a Google name',
     T.FONTS.every(f => f.id && f.name && f.stack && f.google));
  ok('an unknown font id is ignored rather than breaking the page',
     T.variables({ bodyFont: 'nope' })['font-body'] === undefined);
}

console.log('\n== bad input is survivable ==');
{
  ok('a nonsense colour does not throw',
     (() => { try { T.variables({ primaryColour: 'not a colour' }); return true; } catch (e) { return false; } })());
  ok('an empty branding row is the default row',
     JSON.stringify(T.variables({})) === JSON.stringify(T.variables(null)));
  ok('a blank value falls back to the default',
     T.merged({ primaryColour: '' }).primaryColour === '#0B1F3A');
  ok('custom CSS has a stated limit', T.CUSTOM_CSS_LIMIT > 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
