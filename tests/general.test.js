const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const HERE = __dirname;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto('file://' + path.join(HERE, 'harness.html'));
  // the form kit's styles live in admin.html, so lift them in
  const adminCss = (fs.readFileSync(path.join(HERE, '..', 'admin.html'), 'utf8')
    .match(/<style>\n([\s\S]*?)\n<\/style>/) || [, ''])[1];
  await page.addStyleTag({ content: adminCss });
  await page.evaluate(() => window.__ready);

  console.log('\n== load ==');
  ok('no page errors', errors.length === 0, errors);
  ok('registered as General', await page.evaluate(() => window.__def.title) === 'General');

  const names = await page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('#host [id^=f_]'), e => e.id.slice(2)));
  const want = ['businessName','tradingName','registrationNumber','tagline','description',
                'country','city','address','timezone','currency','dateFormat','numberFormat',
                'websiteStatus','maintenanceMode'];
  ok('all 14 simple fields drawn', want.every(n => names.includes(n)), names);
  ok('hours grid drawn (7 days)',
     await page.evaluate(() => document.querySelectorAll('#host .hrs-row').length) === 7);

  console.log('\n== defaults ==');
  ok('business name defaulted',
     await page.inputValue('#f_businessName') === 'Vaultique Boutique Point');
  ok('currency defaulted to ZMW', await page.inputValue('#f_currency') === 'ZMW');
  ok('timezone defaulted to Lusaka', await page.inputValue('#f_timezone') === 'Africa/Lusaka');
  ok('sunday closed by default',
     await page.evaluate(() => document.querySelectorAll('#host .hrs-row')[6].classList.contains('shut')));
  ok('summary line shown',
     (await page.textContent('#host .hrs-sum')).includes('Mon-Fri'),
     await page.textContent('#host .hrs-sum'));

  console.log('\n== save bar / dirty tracking ==');
  ok('save disabled when clean', await page.isDisabled('#host .save-bar .btn-gold'));
  ok('discard hidden when clean',
     await page.evaluate(() => document.querySelector('#host .save-bar .btn-out').classList.contains('hide')));
  await page.fill('#f_city', 'Ndola');
  ok('save enabled after an edit', !(await page.isDisabled('#host .save-bar .btn-gold')));
  ok('discard shown after an edit',
     !(await page.evaluate(() => document.querySelector('#host .save-bar .btn-out').classList.contains('hide'))));
  await page.click('#host .save-bar .btn-out');
  ok('discard restores the value', await page.inputValue('#f_city') === 'Lusaka');
  ok('save disabled again after discard', await page.isDisabled('#host .save-bar .btn-gold'));

  console.log('\n== conditional field ==');
  ok('maintenance message hidden while mode is off',
     await page.evaluate(() => document.querySelector('#f_maintenanceMessage').closest('.field').classList.contains('hide')));
  await page.click('#host .sw-row');
  ok('maintenance message appears when mode is on',
     !(await page.evaluate(() => document.querySelector('#f_maintenanceMessage').closest('.field').classList.contains('hide'))));

  console.log('\n== validation ==');
  await page.fill('#f_maintenanceMessage', '');
  await page.click('#host .save-bar .btn-gold');
  await page.waitForTimeout(80);
  ok('blank required field blocks the save',
     (await page.textContent('#host .save-bar .stat')).includes('fix the highlighted'));
  ok('the offending field is marked',
     await page.evaluate(() => document.querySelector('#f_maintenanceMessage').closest('.field').classList.contains('bad')));
  ok('nothing was written', await page.evaluate(() => window.__saves.length) === 0);

  await page.fill('#f_maintenanceMessage', 'Back shortly.');
  await page.fill('#f_businessName', '');
  await page.click('#host .save-bar .btn-gold');
  await page.waitForTimeout(80);
  ok('blank business name blocks the save',
     await page.evaluate(() => document.querySelector('#f_businessName').closest('.field').classList.contains('bad')));
  await page.fill('#f_businessName', 'Vaultique Boutique Point');

  console.log('\n== hours validation ==');
  // Monday closes before it opens
  await page.evaluate(() => {
    const row = document.querySelectorAll('#host .hrs-row')[0];
    const t = row.querySelectorAll('input[type=time]');
    t[1].value = '07:00';
    t[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.click('#host .save-bar .btn-gold');
  await page.waitForTimeout(80);
  ok('closing before opening is rejected',
     (await page.textContent('#host .err-txt:not(:empty)')).includes('closes before it opens'),
     await page.textContent('#host .hrs').catch(()=>''));
  await page.evaluate(() => {
    const row = document.querySelectorAll('#host .hrs-row')[0];
    const t = row.querySelectorAll('input[type=time]');
    t[1].value = '18:00';
    t[1].dispatchEvent(new Event('change', { bubbles: true }));
  });

  // every day off
  await page.evaluate(() => {
    document.querySelectorAll('#host .hrs-row .hrs-day input').forEach(b => {
      if (b.checked) { b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });
  await page.click('#host .save-bar .btn-gold');
  await page.waitForTimeout(80);
  ok('a week with no open day is rejected',
     (await page.textContent('#host .field.bad .err-txt')).includes('at least one open day'));
  await page.evaluate(() => {
    document.querySelectorAll('#host .hrs-row .hrs-day input').forEach((b, i) => {
      if (i < 6) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });

  console.log('\n== copy monday ==');
  await page.evaluate(() => {
    const t = document.querySelectorAll('#host .hrs-row')[0].querySelectorAll('input[type=time]');
    t[0].value = '08:30'; t[0].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.click('#host .hrs-tools button');
  ok('monday times copied to other open days',
     await page.evaluate(() => {
       const sat = document.querySelectorAll('#host .hrs-row')[5].querySelectorAll('input[type=time]');
       return sat[0].value === '08:30';
     }));
  ok('closed days untouched by the copy',
     await page.evaluate(() => document.querySelectorAll('#host .hrs-row')[6].classList.contains('shut')));

  console.log('\n== save ==');
  await page.fill('#f_city', 'Kitwe');
  await page.click('#host .save-bar .btn-gold');
  await page.waitForTimeout(200);
  const stat = await page.textContent('#host .save-bar .stat');
  ok('save reports success', stat.includes('Saved'), stat);
  ok('save disabled again after saving', await page.isDisabled('#host .save-bar .btn-gold'));

  const saves = await page.evaluate(() => window.__saves);
  const settingsSave = saves.filter(s => s.table === 'site_settings').pop();
  const contentSave  = saves.filter(s => s.table === 'site_content').pop();
  ok('wrote to site_settings under key general',
     settingsSave && settingsSave.payload.key === 'general', settingsSave && settingsSave.payload.key);
  ok('stored city', settingsSave && settingsSave.payload.data.city === 'Kitwe');
  ok('stored maintenance mode as a boolean',
     settingsSave && settingsSave.payload.data.maintenanceMode === true);
  ok('stored hours as a per-day object',
     settingsSave && settingsSave.payload.data.businessHours.sun.open === false,
     settingsSave && settingsSave.payload.data.businessHours);

  console.log('\n== nothing else is written ==');
  // The storefront reads site_settings directly, so General has no business
  // touching site_content. The bridge that used to do so is gone.
  ok('site_content was not written', !contentSave, saves.map(s => s.table));
  ok('site_settings was the only table touched',
     saves.every(s => s.table === 'site_settings'), saves.map(s => s.table));

  console.log('\n== reload from storage ==');
  await page.evaluate(() => {
    window.VBP_ADMIN.store.forget();
    document.getElementById('host').innerHTML = '';
    const A = window.VBP_ADMIN;
    A.setting('general').render(document.getElementById('host'),
      { sb: A.sb, cfg: {}, esc: x => x, navigate: () => {}, ui: A.ui, store: A.store });
  });
  await page.waitForTimeout(250);
  ok('saved city read back', await page.inputValue('#f_city') === 'Kitwe');
  ok('saved hours read back',
     await page.evaluate(() => document.querySelectorAll('#host .hrs-row')[0]
       .querySelectorAll('input[type=time]')[0].value) === '08:30');
  ok('maintenance message visible on reload (mode was saved on)',
     !(await page.evaluate(() => document.querySelector('#f_maintenanceMessage').closest('.field').classList.contains('hide'))));

  console.log('\n== summary ==');
  ok('still no page errors', errors.length === 0, errors);
  // ---------------------------------------------------------- image field
  // Added for Branding & Appearance, which needs five image slots. Driven
  // here through a scratch section so it is exercised on its own.
  console.log('\n== image field ==');
  {
    await page.evaluate(() => {
      window.__uploads = [];
      window.VBP_ADMIN.uploadImage = function (file, prefix) {
        window.__uploads.push({ name: file.name, size: file.size, prefix: prefix });
        return new Promise(res => setTimeout(() => res('https://cdn.test/' + prefix + '.png'), 60));
      };
      window.VBP_ADMIN.store.registerDefaults('imgtest', { logo: '' });
      window.VBP_ADMIN.registerSetting({
        key: 'imgtest', title: 'Image test', summary: '',
        render: function (host, ctx) {
          ctx.ui.form(host, { key: 'imgtest', groups: [{ title: 'Logos', fields: [
            { type: 'image', name: 'logo', label: 'Main logo', prefix: 'branding/logo-main',
              maxSize: 1024, previewOn: 'dark', hint: 'A wide logo works best.' }
          ]}]});
        }
      });
      document.getElementById('host').innerHTML = '';
      const A = window.VBP_ADMIN;
      A.setting('imgtest').render(document.getElementById('host'),
        { sb: A.sb, cfg: {}, esc: x => x, navigate: () => {}, ui: A.ui, store: A.store });
    });
    await page.waitForTimeout(250);

    ok('the field draws with an empty preview',
       await page.evaluate(() => document.querySelector('#host .img-frame').classList.contains('is-empty')));
    ok('Remove is hidden while there is nothing to remove',
       await page.evaluate(() => document.querySelector('#host .img-remove').classList.contains('hide')));
    ok('save is disabled on a clean form', await page.isDisabled('#host .save-bar .btn-gold'));

    // a file that is too large is refused before any upload happens
    await page.setInputFiles('#host input[type=file]', {
      name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(4096)
    });
    await page.waitForTimeout(120);
    ok('an oversized image is refused',
       /under \d+KB/.test(await page.textContent('#host .err-txt')),
       await page.textContent('#host .err-txt'));
    ok('nothing was uploaded', await page.evaluate(() => window.__uploads.length) === 0);

    // a file that is not an image is refused too
    await page.setInputFiles('#host input[type=file]', {
      name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello')
    });
    await page.waitForTimeout(120);
    ok('a non-image is refused',
       /not an image/.test(await page.textContent('#host .err-txt')),
       await page.textContent('#host .err-txt'));

    // a good file uploads
    await page.setInputFiles('#host input[type=file]', {
      name: 'logo.png', mimeType: 'image/png', buffer: Buffer.alloc(500)
    });
    await page.waitForTimeout(300);
    ok('the upload used the given prefix',
       await page.evaluate(() => window.__uploads[0].prefix) === 'branding/logo-main');
    ok('the preview shows the uploaded image',
       !(await page.evaluate(() => document.querySelector('#host .img-frame').classList.contains('is-empty'))));
    ok('the image URL is on the preview',
       (await page.getAttribute('#host .img-frame img', 'src')) === 'https://cdn.test/branding/logo-main.png');
    ok('it reads as an unsaved change', !(await page.isDisabled('#host .save-bar .btn-gold')));
    ok('Remove is offered once there is an image',
       !(await page.evaluate(() => document.querySelector('#host .img-remove').classList.contains('hide'))));

    // saving stores the URL
    await page.click('#host .save-bar .btn-gold');
    await page.waitForTimeout(220);
    const saved = await page.evaluate(() =>
      window.__saves.filter(s => s.payload.key === 'imgtest').pop());
    ok('the URL is what gets stored',
       saved && saved.payload.data.logo === 'https://cdn.test/branding/logo-main.png',
       saved && saved.payload.data.logo);

    // removing clears it
    await page.click('#host .img-remove');
    await page.waitForTimeout(120);
    ok('removing empties the preview',
       await page.evaluate(() => document.querySelector('#host .img-frame').classList.contains('is-empty')));
    ok('removing is an unsaved change', !(await page.isDisabled('#host .save-bar .btn-gold')));

    // an upload still running blocks the save
    await page.evaluate(() => {
      window.VBP_ADMIN.uploadImage = () => new Promise(() => {});   // never settles
    });
    await page.setInputFiles('#host input[type=file]', {
      name: 'slow.png', mimeType: 'image/png', buffer: Buffer.alloc(400)
    });
    await page.waitForTimeout(150);
    await page.click('#host .save-bar .btn-gold');
    await page.waitForTimeout(120);
    ok('saving waits for an upload in flight',
       /Wait for the image/.test(await page.textContent('#host .err-txt')),
       await page.textContent('#host .err-txt'));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');

  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: path.join(HERE, 'general-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.screenshot({ path: path.join(HERE, 'general-desktop.png'), fullPage: true });

  await browser.close();
  process.exit(fail ? 1 : 0);
})();
