/* ===========================================================================
   THE POLICIES' NUMBERS -- assets/admin/policies.js, build 90 (no browser)

   The owner, 26 November 2026: "the numbers in order should auto correct
   when a new policy is added, instead of editing all the numbers." So the
   number is a place in the list, never a value typed to keep policies
   apart. This checks the working-out on its own:
     * the list in the order the policies page shows (by number, each
       section together where its first policy comes), ties settled;
     * a policy put at a number: the others move up or down one, and the
       window's sentence says which;
     * a number in the middle of another section: it goes to the end of its
       own, and the sentence says why;
     * usually one row written (a number between its neighbours); every
       number written again only when there is no room, or older numbers
       were equal or out of section;
     * whole sections moved.
   =========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

let checks = 0, failures = 0;
const is = (c, m, x) => { checks++; if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };
const J = (x) => JSON.stringify(x);

const box = { console };
box.window = box;
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'admin', 'policies.js'), 'utf8'), box, { filename: 'policies.js' });
const P = box.VBP_POLICIES.plan;

const pol = (id, section, sort, title) => ({ id, section, sort, title: title || id });
const LIST = [pol('r1', 'Returns', 10), pol('r2', 'Returns', 20), pol('r3', 'Returns', 30),
              pol('d1', 'Delivery', 40), pol('d2', 'Delivery', 50),
              pol('p1', 'Payments', 60), pol('p2', 'Payments', 70)];
const ids = (l) => l.map(p => p.me ? '*' : p.id).join(' ');

console.log('\nThe order, as the policies page shows it');
is(ids(P.ordered(LIST.slice().reverse())) === 'r1 r2 r3 d1 d2 p1 p2', 'by number, whatever order they are read in');
let odd = [pol('a', 'A', 10), pol('b', 'B', 20), pol('a2', 'A', 30), pol('x', 'A', 20, 'Zed'), pol('y', 'A', 20, 'Alpha')];
is(ids(P.ordered(odd)) === 'a y x a2 b', 'each section together where its first policy comes; equal numbers by title',
   ids(P.ordered(odd)));
is(ids(P.ordered([pol('n', null, null), pol('m', '', 5), pol('k', 'Policies', 1)])) === 'n k m',
   'no number counts as 0 and no section as "Policies", as on the policies page', ids(P.ordered([pol('n', null, null), pol('m', '', 5), pol('k', 'Policies', 1)])));
is(P.clampAt('', 8) === 8 && P.clampAt('abc', 8) === 8 && P.clampAt('0', 8) === 1 && P.clampAt('99', 8) === 8 && P.clampAt(' 3 ', 8) === 3,
   'a number as typed: nothing or nonsense is the end; below 1 is 1; past the end is the end');

console.log('\nA new policy');
let d = P.describe(LIST, null, 2, 'Returns');
let after = P.arrange(LIST, null, 2, 'Returns');
is(ids(after) === 'r1 * r2 r3 d1 d2 p1 p2' && d.at === 2 && d.text === 'It will be number 2. Numbers 2 to 7 each move down one.',
   'at number 2 of its section: there, and the window says the rest move down one', J([ids(after), d.text]));
is(P.between(after) === 15 && P.inOrder(after, 15), 'one row written: a number between its neighbours (15), nothing else');
d = P.describe(LIST, null, '', 'Payments');
is(d.at === 8 && d.text === 'It will be number 8, the last.', 'no number: the end', d.text);
d = P.describe(LIST, null, 2, 'Payments');
is(d.at === 6 && d.text === 'It will be number 6 (not 2: each section stays together, as on the policies page). Numbers 6 to 7 each move down one.',
   'number 2 among the Returns policies, for a Payments policy: the nearest place in Payments, its first, and the window says why', d.text);
is(ids(P.arrange(LIST, null, 2, 'Payments')) === 'r1 r2 r3 d1 d2 * p1 p2', 'the sections keep their order: Payments is not pulled up');
d = P.describe(LIST, null, 5, 'Delivery');
is(d.at === 5 && d.text === 'It will be number 5. Numbers 5 to 7 each move down one.', 'between two of its own section', d.text);
d = P.describe(LIST, null, 4, 'Gift cards');
is(d.at === 4 && /Numbers 4 to 7 each move down one/.test(d.text), 'a new section where one section ends and the next begins: there', d.text);
d = P.describe(LIST, null, 5, 'Gift cards');
is(d.at === 6 && /not 5: each section stays together/.test(d.text), 'a new section in the middle of another: after that one', d.text);
d = P.describe([], null, 1, 'Returns');
is(d.at === 1 && /It will be number 1, the last/.test(d.text) && P.between(P.arrange([], null, 1, 'Returns')) === 10,
   'the very first policy: number 1, written as 10');

console.log('\nMoving one');
d = P.describe(LIST, 'r3', 1, 'Returns');
after = P.arrange(LIST, 'r3', 1, 'Returns');
is(ids(after) === '* r1 r2 d1 d2 p1 p2' && d.text === 'It will be number 1. Numbers 1 to 2 each move down one.',
   'third to first: the two before it move down one', J([ids(after), d.text]));
is(P.between(after) === null, 'no room below 10: every number written again');
let plan = P.renumber(after, { me: 'r3' });
is(J(plan) === J([{ id: 'r3', sort: 10 }, { id: 'r1', sort: 20 }, { id: 'r2', sort: 30 }]),
   'only the rows whose number changes: 10, 20, 30', J(plan));
d = P.describe(LIST, 'd1', 5, 'Delivery');
is(d.at === 5 && d.text === 'It will be number 5. Number 5 moves up one.', 'down one place', d.text);
d = P.describe(LIST, 'r2', 2, 'Returns');
is(d.text === 'It stays number 2.', 'the same place: nothing moves', d.text);
d = P.describe(LIST, 'r2', 6, 'Payments');
is(d.at === 6 && d.text === 'It will be number 6. Numbers 3 to 6 each move up one.',
   'into another section, between two of its policies: there, and every number after the old place moves up one', d.text);
d = P.describe(LIST, 'r2', 2, 'Payments');
is(d.at === 5 && /^It will be number 5 \(not 2: each section stays together/.test(d.text), 'into another section, at a number outside it: its first place', d.text);

console.log('\nOne row, or every number');
let tight = [pol('a', 'S', 10), pol('b', 'S', 11), pol('c', 'S', 12)];
after = P.arrange(tight, null, 2, 'S');
is(P.between(after) === null, 'no whole number between 10 and 11: every number written again');
let tied = [pol('a', 'S', 10, 'A'), pol('b', 'S', 10, 'B'), pol('c', 'S', 30, 'C')];
after = P.arrange(P.ordered(tied), null, 3, 'S');
is(P.between(after) === 20 && !P.inOrder(after, 20), 'two typed the same (10 and 10): its own number fits, but the order is not clean, so every number again');
let mixed = [pol('a', 'A', 10), pol('b', 'B', 20), pol('c', 'A', 30), pol('e', 'B', 40)];
after = P.arrange(P.ordered(mixed), 'e', 4, 'B');
is(ids(after) === 'a c b *' && !P.inOrder(after, P.between(after) || 0),
   'older numbers that split a section (A 10, B 20, A 30): written again, so the numbers match the page', ids(after));

console.log('\nWhole sections');
let moved = P.moveSection(LIST, 'Payments', -1);
is(ids(moved) === 'r1 r2 r3 p1 p2 d1 d2', 'Payments up one: above Delivery', ids(moved));
is(P.moveSection(LIST, 'Returns', -1) === null && P.moveSection(LIST, 'Payments', 1) === null, 'not past the top or the bottom');

console.log(failures ? '\n  ✗ ' + failures + ' of ' + checks + ' checks FAILED' : '\n  the policies\' numbers: all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
