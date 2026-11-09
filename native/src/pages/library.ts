// Library page: stacked book rows — cover+title block, then Rate + Reading now line.
import { api, type Club } from '../api';
import { esc, errText, go, ratingChips, scaffold, toast } from '../ui';
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
      <div class="empty-note">No books in this library yet.</div>
      <ion-button id="libAdd2" expand="block" style="margin:0 16px"><ion-icon slot="start" name="plus"></ion-icon>Add books</ion-button>`;
    body.querySelector('#libAdd2')?.addEventListener('click', () =>
      go((r) => AddBooksPage(r, { presetClubId: clubId })));
    return;
  }

  body.innerHTML = `<ion-list inset="true">
    ${club.library.map((b, i) => `
      <div class="lib-book" style="${i ? 'border-top:1px solid var(--ion-color-light)' : ''}">
        <div class="book-row">${coverHtml(b)}${bookTextHtml(b)}</div>
        <div class="book-ctl">
          ${ratingChips(b.myRating ?? null, `data-rate-for="${esc(b.key)}"`)}
          ${club.current?.key === b.key
            ? '<ion-badge color="primary">Reading now</ion-badge>'
            : `<ion-button size="small" fill="outline" data-setcurrent="${esc(b.key)}">Reading now</ion-button>`}
        </div>
      </div>`).join('')}
  </ion-list>`;

  // Per-row rating wiring: each chips row knows its book via the wrapper attribute.
  body.querySelectorAll('[data-rate-for]').forEach((row) => {
    const key = (row as HTMLElement).dataset.rateFor!;
    row.querySelectorAll('.rchip').forEach((chip) => {
      chip.addEventListener('click', async () => {
        row.querySelectorAll('.rchip').forEach((c) => c.classList.remove('sel'));
        chip.classList.add('sel');
        const raw = (chip as HTMLElement).dataset.r;
        if (raw === '' || raw === undefined) return;
        try { await api('rate', { bookKey: key, rating: Number(raw) }); await toast('Rated ' + raw + '★'); }
        catch (e) { await toast(errText(e), 'danger'); }
      });
    });
  });
  body.querySelectorAll('[data-setcurrent]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await api('setCurrent', { clubId, bookKey: (b as HTMLElement).dataset.setcurrent });
        await toast('Now reading');
        go((r) => LibraryPage(r, clubId), { replace: true });
      } catch (e) { await toast(errText(e), 'danger'); }
    });
  });
}
