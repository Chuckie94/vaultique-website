/* ===========================================================================
   A TAG FOR EVERY BUILD THAT PASSES (website build 84) · .github/workflows/release-tag.yml

   The workflow is read as GitHub reads it, line by line:

     1. it starts only when the Tests workflow has finished;
     2. it tags only a GREEN run, of an upload (not a pull request), to the
        repository's main branch;
     3. it may write tags and nothing else, and uses no secret;
     4. the only thing it ever pushes is the one tag;
     5. the tag's name comes from assets/version.js: website-<build>;
     6. the Tests workflow it waits for still has its three jobs.
   =========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

let checks = 0, failures = 0;
const ok = (m) => { checks++; console.log('  ✓ ' + m); };
const fail = (m, x) => { checks++; failures++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); };
const is = (c, m, x) => (c ? ok(m) : fail(m, x));

const ROOT = path.resolve(__dirname, '..');
const file = path.join(ROOT, '.github', 'workflows', 'release-tag.yml');
const wf = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // what GitHub runs, without the notes

console.log('\nWhen it runs');
is(!!wf, '.github/workflows/release-tag.yml is there');
is(/on:\s*\n\s*workflow_run:\s*\n\s*workflows:\s*\[Tests\]\s*\n\s*types:\s*\[completed\]/.test(code),
   'only when the Tests workflow has finished');
is(/conclusion\s*==\s*'success'/.test(code), 'only a green run');
is(/workflow_run\.event\s*==\s*'push'/.test(code), 'only an upload, never a pull request');
is(/head_branch\s*==\s*github\.event\.repository\.default_branch/.test(code), 'only the main branch');
is(!/^\s*(push|pull_request|schedule|workflow_dispatch):/m.test(code), 'and nothing else starts it');

console.log('\nWhat it may do');
const perms = /permissions:\s*\n((?:\s{2,}\S[^\n]*\n)+)/.exec(code);
is(perms && perms[1].trim() === 'contents: write', 'it may write to the repository (a tag) and nothing else: no issues, no deploys, no packages',
   perms && perms[1]);
is(!/secrets\./.test(code), 'it uses no secret');
const pushes = code.match(/git push[^\n]*/g) || [];
is(pushes.length === 1 && /git push origin "refs\/tags\/\$tag"/.test(pushes[0]), 'the one thing it pushes is the tag', pushes.join(' | '));
is(!/git commit|git add|rm -|npm |curl |wget /.test(code), 'it changes no file, installs nothing and calls nothing outside');
is(/already a tag[^\n]*left as it is/.test(code), 'a build already tagged is left as it is');

console.log('\nThe tag\'s name, from assets/version.js');
const ver = fs.readFileSync(path.join(ROOT, 'assets', 'version.js'), 'utf8');
/* The workflow reads the two lines with sed; the same patterns, here. */
const sedBuild = /sed -n "s\/\^\[\[:space:\]\]\*build:\[\[:space:\]\]\*\\\(\[0-9\]\[0-9\]\*\\\)\.\*\/\\1\/p" assets\/version\.js/.test(code);
const sedVersion = /sed -n "s\/\^\[\[:space:\]\]\*version:\[\[:space:\]\]\*'\\\(\[0-9\]\[0-9\.\]\*\\\)'\.\*\/\\1\/p" assets\/version\.js/.test(code);
is(sedBuild && sedVersion, 'it reads the build and the version lines of assets/version.js');
const build = (/^\s*build:\s*([0-9][0-9]*).*$/m.exec(ver) || [])[1];
const version = (/^\s*version:\s*'([0-9][0-9.]*)'.*$/m.exec(ver) || [])[1];
is(!!build && !!version, 'which today say build ' + build + ', version ' + version + ': the tag would be website-' + build);
is(/tag="website-\$build"/.test(code), 'named website-<build>');

console.log('\nThe Tests workflow it waits for');
const tests = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'tests.yml'), 'utf8');
is(/^name: Tests$/m.test(tests), 'is still called Tests');
is(/^  node:$/m.test(tests) && /^  browser:$/m.test(tests) && /^  database:$/m.test(tests), 'and still has its three jobs: node, browser, database');

console.log('\n  release tag: ' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
