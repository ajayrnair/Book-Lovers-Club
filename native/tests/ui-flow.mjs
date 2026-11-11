// UI drive test: runs the built native web bundle in headless Chrome at iPhone
// size, against the API named by BLC_API_BASE (default: production). The app
// calls the relative /api/handler path on web; those requests are fulfilled
// from the target API here. Screenshots each main screen.
//
// Flow mirrors the current (web-parity) app: landing, Explore Find/Create,
// tap-to-select Add Books, library groups, card-tap poll voting, reading
// progress, in-app date/time pickers, member removal, relaunch landing.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const APP_URL = 'http://127.0.0.1:4173/';
const API_BASE = process.env.BLC_API_BASE || 'https://booklovers-lemon.vercel.app/api/handler';
console.log('API base:', API_BASE);
const SHOTS = new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });
const ts = Date.now();
const USER = { name: 'UI Test', email: `blc.ui.${ts}@example.com`, password: 'ui-test-pass-1' };
const USER2 = { name: 'UI Guest', email: `blc.ui2.${ts}@example.com`, password: 'ui-test-pass-2' };

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};
async function api(token, action, body = {}) {
  const r = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', async (req) => {
  if (req.url().includes('/api/handler')) {
    try {
      const r = await fetch(API_BASE, {
        method: req.method(), headers: { 'content-type': 'application/json', ...(req.headers().authorization ? { authorization: req.headers().authorization } : {}) },
        body: req.postData(),
      });
      await req.respond({ status: r.status, contentType: 'application/json', body: await r.text() });
    } catch { await req.abort().catch(() => {}); }
  } else {
    await req.continue().catch(() => {});
  }
});
await page.emulate({
  viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

const shot = async (name) => { await page.screenshot({ path: SHOTS + name + '.png' }); console.log('  shot ' + name); };
const waitText = (txt, timeout = 20000) =>
  page.waitForFunction((t) => document.body.innerText.toUpperCase().includes(t.toUpperCase()), { timeout }, txt);
const hasText = (txt) => page.evaluate((t) => document.body.innerText.toUpperCase().includes(t.toUpperCase()), txt);
const click = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('missing ' + s); el.click(); }, sel);
const setInput = (sel, v) => page.evaluate((s, val) => {
  const el = document.querySelector(s); if (!el) throw new Error('missing ' + s);
  el.value = val; el.dispatchEvent(new CustomEvent('ionInput', { detail: { value: val } }));
  el.dispatchEvent(new CustomEvent('ionChange', { detail: { value: val } }));
}, sel, v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  console.log('== auth screens ==');
  await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await waitText('Sign in with Google');
  await shot('01-auth-signin');
  await click('#toSignup');
  await waitText('Create account');
  await shot('02-auth-create');

  await setInput('#upName', USER.name);
  await setInput('#upEmail', USER.email);
  await setInput('#upPw', USER.password);
  await click('#signup');
  await waitText('No clubs yet');
  check('signup with zero clubs lands on the clubs list', await hasText('Explore clubs'));
  await shot('03-clubs-empty');

  console.log('== explore: find + create ==');
  await click('#exploreRow');
  await page.waitForSelector('#xq', { timeout: 15000 });
  check('Explore renders Find (name input + filters)', await page.evaluate(() => !!document.querySelector('#xGenres') && !!document.querySelector('#xfSeg')));
  await shot('04-explore-find');
  await click('#xpSeg ion-segment-button[value="create"]');
  await page.waitForSelector('#ccreate', { timeout: 15000 });
  check('Explore renders Create (guided form)', await page.evaluate(() => !!document.querySelector('#cname') && !!document.querySelector('#cfmtSeg')));
  await shot('05-explore-create');

  console.log('== create club via Explore ==');
  await setInput('#cname', 'UI Test Club ' + ts);
  await click('#ccreate');
  await page.waitForSelector('#clubStrip', { timeout: 20000 });
  await waitText('No book picked yet');
  check('club created; club page shows the switcher strip', true);
  await shot('06-club-empty');

  console.log('== meeting availability ==');
  await waitText('Pick the days you are available');
  await click('[data-day]');
  await sleep(1200);
  check('availability tap re-renders without error', await hasText('Group meeting'));
  await shot('07-club-meeting');

  console.log('== add books (tap-to-select) ==');
  const addBook = async (query, titleRe) => {
    await page.waitForSelector('#sq', { timeout: 15000 });
    await setInput('#sq', query);
    await page.waitForFunction((re) => [...document.querySelectorAll('[data-pick]')].some((el) => new RegExp(re, 'i').test(el.innerText)), { timeout: 30000 }, titleRe);
    await page.evaluate((re) => {
      const row = [...document.querySelectorAll('[data-pick]')].find((el) => new RegExp(re, 'i').test(el.innerText));
      row.click();
    }, titleRe);
    await page.waitForFunction(() => {
      const b = document.querySelector('#addBar');
      return b && !b.classList.contains('hide') && document.querySelector('#addSel').innerText.includes('Add 1 book');
    }, { timeout: 10000 });
    await click('#addSel');
    await page.waitForSelector('.lib-book', { timeout: 20000 });
  };
  await click('#libGo');                 // -> Library (empty)
  await waitText('No books yet');
  await click('#libAdd2');                // -> Add Books (preset = this club)
  await addBook('Sapiens', 'Sapiens');
  check('tap-to-select + sticky Add bar adds the book', await hasText('Sapiens'));
  await click('#libAdd');                 // header + on Library -> Add Books
  await addBook('The Silent Patient', 'Silent Patient');
  await click('#libAdd');
  await addBook('Dune Frank Herbert', 'Dune');
  check('library lists all three added books', await page.evaluate(() =>
    ['Sapiens', 'Silent Patient', 'Dune'].every((t) => document.body.innerText.includes(t))));
  await shot('08-library');

  console.log('== poll: start, card-tap vote, close ==');
  await click('#pg-back');                // -> Club page
  await waitText('Start a poll');
  await click('#startPoll');              // -> Poll page (start screen)
  await page.waitForSelector('#pollEndBtn', { timeout: 15000 });
  check('poll start screen uses the in-app date field', await page.evaluate(() => !document.querySelector('input[type="date"]')));
  await click('#startBtn');
  await page.waitForSelector('[data-vote]', { timeout: 20000 });
  await shot('09-poll-running');
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('[data-vote]')].find((el) => /sapiens/i.test(el.innerText));
    card.click();
  });
  await page.waitForFunction(() => {
    const card = [...document.querySelectorAll('[data-vote]')].find((el) => /sapiens/i.test(el.innerText));
    return card && card.classList.contains('mine') && card.innerText.includes('Your vote');
  }, { timeout: 15000 });
  check('poll candidate tap selects (ring + Your vote)', true);
  await shot('10-poll-voted');
  await click('#closeBtn');
  await page.waitForSelector('#progSlider', { timeout: 20000 });
  check('closing the poll settles the winner as current (progress slider present)', await hasText('Sapiens'));
  await shot('11-club-current');

  console.log('== reading progress + rating ==');
  await page.evaluate(() => {
    const s = document.querySelector('#progSlider');
    s.value = 100;
    s.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 100 } }));
  });
  await waitText('✓ Finished');
  check('progress commit to 100% marks the book finished', true);
  const stripBox = await page.evaluate(() => {
    const el = document.querySelector('.ratestars');
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(stripBox.x + stripBox.w * 0.9, stripBox.y + stripBox.h / 2);
  await sleep(1200);
  check('star strip rating shows the average line', await hasText('Average ★'));
  await shot('12-club-rated');

  console.log('== library: three groups ==');
  const token = await page.evaluate(() => localStorage.getItem('blc_token'));
  const mine = await api(token, 'myClubs');
  const clubId = mine.j.clubs[0].id;
  const clubNow = await api(token, 'club', { clubId });
  const silent = clubNow.j.club.library.find((b) => /silent patient/i.test(b.title));
  const prog = await api(token, 'setProgress', { clubId, bookKey: silent.key, percent: 100 });
  check('arrange: second book finished via setProgress API', prog.status === 200);
  await click('#libGo');
  await waitText('Finished by 1 of 1');
  check('library shows Current book / To read / Read groups', await page.evaluate(() => {
    const t = document.body.innerText.toUpperCase(); // section labels are CSS-uppercased
    return t.includes('CURRENT BOOK') && t.includes('TO READ') && t.includes('READ') && t.includes('FINISHED BY 1 OF 1');
  }));
  await shot('13-library-groups');
  await click('#pg-back');                // -> Club page

  console.log('== meeting date/time pickers ==');
  await page.waitForSelector('#pickDateBtn', { timeout: 15000 });
  await click('#pickDateBtn');
  await page.waitForFunction(() => {
    const p = document.querySelector('#pickDatePanel');
    return p && !p.classList.contains('hide') && p.querySelector('.calday');
  }, { timeout: 10000 });
  const calInfo = await page.evaluate(() => ({
    wds: [...document.querySelectorAll('#pickDatePanel .calwd')].map((e) => e.textContent).join(''),
    nativeInputs: document.querySelectorAll('input[type="date"], input[type="time"], ion-datetime').length,
  }));
  check('date picker opens inline, Monday-first grid', calInfo.wds === 'MTWTFSS', JSON.stringify(calInfo));
  check('no native date/time inputs or ion-datetime in the DOM', calInfo.nativeInputs === 0);
  await shot('14-picker-calendar');
  await click('#pickDatePanel [data-calnav="1"]');
  await sleep(300);
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('#pickDatePanel [data-calday]')].find((el) => el.dataset.calday.endsWith('-15'));
    d.click();
  });
  await page.waitForSelector('[data-rsvp="going"]', { timeout: 20000 });
  check('picking a date sets the meeting (RSVP appears)', true);
  await click('#mtimeBtn');
  await page.waitForFunction(() => {
    const p = document.querySelector('#mtimePanel');
    return p && !p.classList.contains('hide') && p.querySelector('[data-tm]');
  }, { timeout: 10000 });
  await shot('15-picker-time');
  await click('#mtimePanel [data-tm="30"]');
  await sleep(1600);
  check('time picker autosaves (meeting line shows 7:30 PM)', await page.evaluate(() =>
    (document.querySelector('#meetWhen')?.innerText || '').includes('7:30 PM')));
  await shot('16-club-meeting-set');

  console.log('== members: invite second user, remove member ==');
  const u2 = await api(null, 'signup', USER2);
  const t2 = u2.j.token;
  const inv = await api(token, 'createInvite', { clubId, email: USER2.email });
  const acc = await api(t2, 'acceptInvite', { inviteToken: inv.j.inviteToken });
  check('arrange: second member joined via invite', acc.status === 200);
  await click('#gear');
  await waitText('Meeting frequency');
  await click('#sMembers');
  await waitText('UI Guest');
  await shot('17-members');
  await click('[data-remove]');
  await page.waitForSelector('#rmYes', { timeout: 10000 });
  await click('#rmYes');
  await page.waitForFunction(() => !document.body.innerText.includes('UI Guest'), { timeout: 15000 });
  check('remove member via inline two-step confirm', true);
  await click('#pg-back');   // -> Settings
  await click('#pg-back');   // -> Club

  console.log('== relaunch landing ==');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#clubStrip', { timeout: 25000 });
  check('landing lands on a club after relaunch', await hasText('Current book'));
  await shot('18-landing-club');

  console.log('== me ==');
  await page.evaluate(() => document.querySelector('[data-tab="me"]').click());
  await waitText('Delete account');
  check('me page shows account + delete', true);
  await shot('19-me');

  console.log('== cleanup via API ==');
  const r2 = await api(t2, 'deleteAccount');
  check('guest account deleted', r2.status === 200);
  const r = await api(token, 'deleteAccount');
  check('test account deleted (club was sole-member, removed with it)', r.status === 200);
} catch (e) {
  fail++;
  console.log('ABORTED:', e.message);
  await shot('99-error-state').catch(() => {});
} finally {
  await browser.close();
  console.log(`\nUI FLOW: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
