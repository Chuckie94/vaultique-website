/* ===========================================================================
   COLLECTION PICTURES — the admin offers a slot for every card the homepage
   draws, and the storefront uses what was uploaded

   THE COMPLAINT THIS ANSWERS: "for product categories, is there a dedicated
   section to add images for categories? If not, how does it work?"

   It did not. The homepage drew a card per category and looked for a file
   called collection-<category>.jpg in the images folder — so changing one
   meant committing a file and redeploying the whole site, and nothing in the
   admin said so.

   AND THE THING THIS FILE IS REALLY FOR. The homepage used to draw two
   lists joined: the categories that come from the platform, and eleven more
   written into assets/app.js as MASTER_CATEGORIES, shown as "Coming soon".
   Nobody had chosen those eleven — they advertised departments the shop did
   not have, and a customer tapping one found an empty shelf.

   The categories are the platform's now, exactly as the pieces are. These
   checks are what stops the invented list coming back, in either file.

   No browser. It reads the two files and compares what is in them.
   =========================================================================== */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let checks = 0, failures = 0;
const ok   = m => { checks++; console.log('  ✓ ' + m); };
const fail = (m, extra) => { checks++; failures++; console.log('  ✗ ' + m + (extra ? '\n      ' + extra : '')); };
const is   = (c, m, extra) => c ? ok(m) : fail(m, extra);
const hdr  = t => console.log('\n' + t);

const app  = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8');
const home = fs.readFileSync(path.join(ROOT, 'assets/admin/settings/homepage.js'), 'utf8');

/* Pulls a bracketed array of quoted strings out of a file by the name it is
   assigned to. Deliberately not a parser: it reads what a person reading the
   file would read. */
function listNamed(src, name) {
  const at = src.indexOf('var ' + name + ' = [');
  if (at === -1) return null;
  const open = src.indexOf('[', at);
  const close = src.indexOf('];', open);
  if (open === -1 || close === -1) return null;
  const body = src.slice(open + 1, close);
  const out = [];
  const re = /"([^"]+)"|'([^']+)'/g;
  let m;
  while ((m = re.exec(body))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

hdr('Nothing invents a category any more');
is(listNamed(app, 'MASTER_CATEGORIES') === null,
   'the eleven written into assets/app.js are gone',
   JSON.stringify(listNamed(app, 'MASTER_CATEGORIES')));
is(listNamed(home, 'PLANNED') === null,
   'and the admin has no copy of them either',
   JSON.stringify(listNamed(home, 'PLANNED')));
is(/ALLCATS = fromProducts;/.test(app),
   'the categories shown are the ones the platform sent, and only those');
is(!/CONTENT\.categories/.test(app),
   'with no second list joined onto them');
is(/'\/api\/products'/.test(home),
   'and the admin reads the same feed the pieces come from');

/* The one thing that must NOT have gone. A real category whose pieces are
   all sold out is still worth marking, and that is a different question
   from inventing one. */
is(/function catHasProducts/.test(app) && /cat-soon/.test(app),
   'a real category with nothing in stock is still marked, which is not the same thing');

hdr('Both sides turn a category into the same name');
/* The picture is stored under col_<slug>. If the two ever slugged
   differently, the admin would save under one name and the storefront would
   look under another, and every upload would silently do nothing. */
function slugFn(src, from) {
  const at = src.indexOf(from);
  const open = src.indexOf('{', at);
  const close = src.indexOf('}', open);
  return src.slice(open + 1, close).replace(/\s+/g, ' ').trim();
}
const sApp  = slugFn(app, 'function slug(s) {');
const sHome = slugFn(home, 'function slug(v) {');
is(!!sApp && !!sHome, 'both files have a slug of their own');
is(sApp.replace(/\b[sv]\b/g, 'x') === sHome.replace(/\b[sv]\b/g, 'x'),
   'and the two do exactly the same thing to a category name',
   sApp + '\n      ' + sHome);

hdr('The storefront prefers what was uploaded, and still falls back to a file');
is(/HOME && HOME\['col_' \+ slug\(c\)\]/.test(app),
   'it looks for the uploaded picture first');
is(/pic = '\/images\/collection-' \+ slug\(c\) \+ '\.jpg';/.test(app),
   'and falls back to the file a shop may have been using for months');

/* THE BUG THIS BUILD FIXES. preload() says "no" whenever the admin is
   connected (USE_LOCAL is false), so an uploaded picture routed through it
   was never drawn, and every card stayed navy and gold. */
{
  const at = app.indexOf('function buildCollections');
  const body = app.slice(at, app.indexOf('observeReveals();', at));
  const up = body.indexOf('if (pic) {');
  const pre = body.indexOf('preload(pic,');
  is(up !== -1 && pre > up && /new Image\(\)/.test(body.slice(up, pre)),
     'an uploaded picture is loaded directly, not through preload(), which refuses when the admin is connected');
}
is(/preload\(pic,/.test(app) && /bgStyle\(pic\)/.test(app),
   'and draws whichever of the two it found');

hdr('The admin offers a slot for every category the platform sent');
is(/name: 'col_' \+ slug\(c\)/.test(home),
   'each saved under the name the storefront reads it by');
is(/prefix: 'homepage\/collection-' \+ slug\(c\)/.test(home),
   'and uploaded under a name that says which category it is');
is(/collapsible: true/.test(home),
   'the section folds away, being one row per category');
is(/cats\.slice\(0, 24\)/.test(home),
   'and a platform with a hundred categories cannot make the page unusable');
is(/\/\^col_\/\.test\(k\) && !\(k in values\)/.test(home),
   'saving keeps the pictures of categories not on screen, rather than wiping them');
is(/cats\.length \?/.test(home),
   'a shop whose catalogue will not load simply does not see the section');

console.log('\n' + (failures
  ? 'collection pictures: ' + failures + ' of ' + checks + ' checks FAILED'
  : 'collection pictures: all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
