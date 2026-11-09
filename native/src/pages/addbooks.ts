// Add Books: pick target clubs, search with a per-row Add (Spotify style), or add by link.
import { api, type Club, type SearchBook } from '../api';
import { esc, errText, refreshPage, scaffold, toast } from '../ui';
import { ratingsLine } from '../ui';

interface Opts { presetClubId?: string }

export async function AddBooksPage(root: HTMLElement, opts: Opts) {
  const body = scaffold(root, {
    title: 'Add books',
    backText: opts.presetClubId ? 'Library' : null,
  });
  body.innerHTML = '<div class="empty-note">Loading…</div>';

  let clubs: Club[] = [];
  try {
    clubs = (await api<{ clubs: Club[] }>('myClubs')).clubs;
  } catch (e) {
    body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`;
    return;
  }
  if (!clubs.length) {
    body.innerHTML = '<div class="empty-note">Join or create a club first.</div>';
    return;
  }

  const selected = new Set<string>(opts.presetClubId ? [opts.presetClubId] : [clubs[0].id]);
  const addedTo = new Map<string, Set<string>>(); // book identity -> club ids added

  body.innerHTML = `
    <div class="section-label">To</div>
    <div style="padding:0 16px 4px" id="toChips">
      ${clubs.map((c) => `<ion-chip class="tochip ${selected.has(c.id) ? 'sel' : ''}" data-club="${c.id}" style="${selected.has(c.id) ? '--background:var(--ion-color-primary);--color:#fff' : ''}">${esc(c.name)}</ion-chip>`).join('')}
    </div>

    <div class="section-label">Search</div>
    <ion-searchbar id="sq" placeholder="Title or author" debounce="0"></ion-searchbar>
    <p id="sErr" style="color:var(--ion-color-danger);min-height:16px;margin:2px 16px;font-size:14px"></p>
    <div id="sres"></div>

    <div class="section-label">Add by link</div>
    <ion-list inset="true">
      <ion-item><ion-input id="linkUrl" label="Link" label-placement="stacked" placeholder="Amazon, Goodreads, Google Books or Open Library link"></ion-input></ion-item>
    </ion-list>
    <ion-button id="linkGo" expand="block" fill="outline" style="margin:10px 16px">Add from link</ion-button>
    <p id="lErr" style="color:var(--ion-color-danger);min-height:16px;margin:2px 16px;font-size:14px"></p>`;

  const res = body.querySelector('#sres') as HTMLElement;
  const ident = (b: SearchBook) => (b.isbn ? 'isbn:' + b.isbn.replace(/[^0-9Xx]/gi, '') : 'ta:' + (b.title || '').toLowerCase() + '|' + (b.author || '').toLowerCase());
  const allAdded = (b: SearchBook) => {
    const s = addedTo.get(ident(b));
    return !!s && [...selected].every((id) => s.has(id));
  };

  function renderResults(results: SearchBook[]) {
    if (!results.length) { res.innerHTML = '<div class="empty-note">No results.</div>'; return; }
    res.innerHTML = `<ion-list inset="true">${results.map((b, i) => `
      <div style="display:flex;align-items:center">
        <div class="book-row" style="flex:1">
          ${b.cover ? `<img class="book-cover" src="${esc(b.cover)}" alt="">` : '<div class="book-cover-ph"><ion-icon name="book-outline"></ion-icon></div>'}
          <div class="grow">
            <div class="book-title">${esc(b.title)}</div>
            <div class="book-sub">${esc(b.author || '')}${b.year ? ' · ' + esc(b.year) : ''}</div>
            ${ratingsLine(b)}
          </div>
        </div>
        ${allAdded(b)
          ? '<ion-button size="small" fill="clear" disabled style="margin-right:10px"><ion-icon slot="start" name="checkmark"></ion-icon>Added</ion-button>'
          : `<ion-button size="small" style="margin-right:10px" data-add="${i}"><ion-icon slot="start" name="plus"></ion-icon>Add</ion-button>`}
      </div>`).join('')}</ion-list>`;
    res.querySelectorAll('[data-add]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const b = results[Number((btn as HTMLElement).dataset.add)];
        if (!selected.size) { (body.querySelector('#sErr') as HTMLElement).textContent = 'Pick a club first'; return; }
        (btn as any).disabled = true;
        try {
          await api('addBooks', { clubIds: [...selected], books: [b] });
          const s = addedTo.get(ident(b)) || new Set<string>();
          selected.forEach((id) => s.add(id));
          addedTo.set(ident(b), s);
          await toast('Added to library');
          renderResults(results);
        } catch (e) {
          (btn as any).disabled = false;
          (body.querySelector('#sErr') as HTMLElement).textContent = errText(e);
        }
      });
    });
  }

  body.querySelectorAll('.tochip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = (chip as HTMLElement).dataset.club!;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      const on = selected.has(id);
      chip.classList.toggle('sel', on);
      (chip as HTMLElement).style.setProperty('--background', on ? 'var(--ion-color-primary)' : '');
      (chip as HTMLElement).style.setProperty('--color', on ? '#fff' : '');
    });
  });

  let lastResults: SearchBook[] = [];
  async function doSearch() {
    const q = ((body.querySelector('#sq') as any).value || '').trim();
    const err = body.querySelector('#sErr') as HTMLElement;
    err.textContent = '';
    if (!q) { res.innerHTML = ''; return; }
    res.innerHTML = '<div class="empty-note">Searching…</div>';
    try {
      const r = await api<{ results: SearchBook[] }>('searchBooks', { q });
      lastResults = r.results;
      renderResults(lastResults);
    } catch (e) {
      res.innerHTML = '';
      err.textContent = errText(e);
    }
  }
  (body.querySelector('#sq') as any).addEventListener('ionChange', () => void doSearch());
  (body.querySelector('#sq') as any).addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') void doSearch();
  });

  (body.querySelector('#linkGo') as any).addEventListener('click', async () => {
    const err = body.querySelector('#lErr') as HTMLElement;
    err.textContent = '';
    const url = ((body.querySelector('#linkUrl') as any).value || '').trim();
    if (!url) { err.textContent = 'Paste a link'; return; }
    if (!selected.size) { err.textContent = 'Pick a club first'; return; }
    try {
      const r = await api('addByLink', { url, clubIds: [...selected] });
      await toast('Added ' + (r.book?.title || 'book'));
      if (opts.presetClubId) refreshPage();
    } catch (e) { err.textContent = errText(e); }
  });
}
