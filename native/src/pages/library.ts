// Library page (web parity): three groups — Current book, To read, Read —
// with "Your rating" star strips. No set-current here: choosing the club's book
// happens in the Next book / poll flow on the club page.
import { api, type Book, type Club } from '../api';
import { esc, errText, go, scaffold, starStripHTML, toast, wireStarStrips } from '../ui';
import { bookTextHtml, coverHtml } from './club';
import { AddBooksPage } from './addbooks';

export async function LibraryPage(root: HTMLElement, clubId: string) {
  const body = scaffold(root, {
    title: 'Library',
    backText: 'Club',
    endButtons: '<ion-button id="libAdd"><ion-icon slot="icon-only" name="plus"></ion-icon></ion-button>',
  });
  body.innerHTML = '<div class="empty-note">Loading…</div>';
  root.querySelector('#libAdd')?.addEventListener('click', () =>
    go((r) => AddBooksPage(r, { presetClubId: clubId })));

  let club: Club;
  try {
    club = (await api<{ club: Club }>('club', { clubId })).club;
  } catch (e) {
    body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`;
    return;
  }

  if (!club.library.length) {
    body.innerHTML = `
      <div class="empty-note">No books yet</div>
      <ion-button id="libAdd2" expand="block" style="margin:0 16px"><ion-icon slot="start" name="plus"></ion-icon>Add books</ion-button>`;
    body.querySelector('#libAdd2')?.addEventListener('click', () =>
      go((r) => AddBooksPage(r, { presetClubId: clubId })));
    return;
  }

  const curKey = club.current ? club.current.key : null;
  const cur = curKey ? club.library.find((b) => b.key === curKey) : null;
  const rest = club.library.filter((b) => b.key !== curKey);
  const read = rest.filter((b) => (b.finishedBy || []).length > 0);
  const toread = rest.filter((b) => !(b.finishedBy || []).length);
  const memberTotal = club.members.length;

  const row = (b: Book, opts: { badge?: string; subline?: string } = {}) => `
    <div class="lib-book">
      <div class="book-row">${coverHtml(b)}${bookTextHtml(b)}${opts.badge ? `<span class="cs-badge" style="align-self:flex-start">${esc(opts.badge)}</span>` : ''}</div>
      ${opts.subline ? `<div style="padding:0 16px 2px 74px;color:var(--ion-color-medium);font-size:13px">${esc(opts.subline)}</div>` : ''}
      <div class="book-ctl">
        <span style="color:var(--ion-color-medium);font-size:13px">Your rating</span>
        ${starStripHTML(b.key, b.myRating ?? null, b.title)}
      </div>
    </div>`;

  const groups: string[] = [];
  if (cur) groups.push(`<div class="section-label">Current book</div><ion-list inset="true">${row(cur, { badge: 'Current book' })}</ion-list>`);
  if (toread.length) groups.push(`<div class="section-label">To read</div><ion-list inset="true">${toread.map((b) => row(b)).join('')}</ion-list>`);
  if (read.length) groups.push(`<div class="section-label">Read</div><ion-list inset="true">${read.map((b) => row(b, { subline: `Finished by ${(b.finishedBy || []).length} of ${memberTotal}` })).join('')}</ion-list>`);

  body.innerHTML = groups.join('');

  const reload = () => go((r) => LibraryPage(r, clubId), { replace: true });
  wireStarStrips(body, async (key, v) => {
    try { await api('rate', { bookKey: key, rating: v }); await toast('Saved'); reload(); }
    catch (e) { await toast(errText(e), 'danger'); }
  });
}
