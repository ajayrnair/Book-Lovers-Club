// Add Books (web parity): pick target clubs, search results as library-grammar
// rows with tap-to-select (violet ring + check) and a sticky "Add N books" bar,
// or add by link. Default targets: the preset club from Library, else ALL clubs.
import { api, type Club, type SearchBook } from '../api';
import { back, esc, errText, go, ratingsLine, scaffold, toast } from '../ui';
import { loadUsage, usageOrder } from '../store';
import { ClubPage } from './club';
import { ClubsPage } from './clubs';

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

  const selected = new Set<string>(opts.presetClubId ? [opts.presetClubId] : clubs.map((c) => c.id));
  let searchResults: SearchBook[] = [];
  const addSel = new Map<number, SearchBook>();

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

  // Sticky action bar: appended to the page host (outside ion-content) so
  // position:fixed anchors to the viewport, as on the web.
  const bar = document.createElement('div');
  bar.className = 'addbar hide';
  bar.id = 'addBar';
  bar.innerHTML = '<ion-button id="addSel" expand="block">Add 1 book</ion-button>';
  root.appendChild(bar);

  const res = body.querySelector('#sres') as HTMLElement;
  const clubIds = () => [...selected];

  const updateBar = () => {
    bar.classList.toggle('hide', !addSel.size);
    if (addSel.size) (bar.querySelector('#addSel') as HTMLElement).textContent = `Add ${addSel.size} book${addSel.size === 1 ? '' : 's'}`;
  };

  function renderResults() {
    if (!searchResults.length) { res.innerHTML = '<div class="empty-note">Nothing found</div>'; return; }
    res.innerHTML = `<ion-list inset="true">${searchResults.map((b, i) => {
      const sel = addSel.has(i);
      return `<div class="book ${sel ? 'picks' : ''}" data-pick="${i}" role="button" aria-pressed="${sel}" aria-label="${esc(b.title)}" style="display:flex;gap:12px;padding:10px 16px;align-items:flex-start;cursor:pointer">
        ${b.cover ? `<img class="book-cover" src="${esc(b.cover)}" alt="">` : '<div class="book-cover-ph"><ion-icon name="book-outline"></ion-icon></div>'}
        <div class="grow">
          <div class="book-title">${esc(b.title)}</div>
          <div class="book-sub">${esc(b.author || '')}${b.year ? ' · ' + esc(b.year) : ''}</div>
          ${ratingsLine(b)}
        </div>
        ${sel ? '<span class="selcheck"><ion-icon name="checkmark"></ion-icon></span>' : ''}
      </div>`;
    }).join('')}</ion-list>`;
    updateBar();
    res.querySelectorAll('[data-pick]').forEach((row) => {
      row.addEventListener('click', () => {
        const i = Number((row as HTMLElement).dataset.pick);
        if (addSel.has(i)) addSel.delete(i); else addSel.set(i, searchResults[i]);
        renderResults();
      });
    });
  }

  const afterAdd = async () => {
    // Preset entry points (Library, club page) sit directly below on the stack:
    // pop back to them instead of stacking a duplicate page.
    if (opts.presetClubId) { back(); return; }
    const usage = await loadUsage().catch(() => ({}));
    const first = usageOrder(clubs, usage)[0];
    if (first) go((r) => ClubPage(r, first.id), { replace: true });
    else go((r) => ClubsPage(r), { replace: true });
  };

  (bar.querySelector('#addSel') as HTMLElement).addEventListener('click', async () => {
    if (!clubIds().length) { await toast('Pick a club first', 'danger'); return; }
    try {
      await api('addBooks', { clubIds: clubIds(), books: [...addSel.values()] });
      await toast('Added');
      addSel.clear();
      await afterAdd();
    } catch (e) { await toast(errText(e), 'danger'); }
  });

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

  async function doSearch() {
    const q = ((body.querySelector('#sq') as any).value || '').trim();
    const err = body.querySelector('#sErr') as HTMLElement;
    err.textContent = '';
    if (!q) { res.innerHTML = ''; searchResults = []; addSel.clear(); updateBar(); return; }
    res.innerHTML = '<div class="empty-note">Searching…</div>';
    try {
      const r = await api<{ results: SearchBook[] }>('searchBooks', { q });
      searchResults = r.results;
      addSel.clear();
      renderResults();
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
      const r = await api<{ book?: SearchBook }>('addByLink', { url, clubIds: [...selected] });
      await toast('Added ' + (r.book?.title || 'book'));
      if (opts.presetClubId) back();
    } catch (e) { err.textContent = errText(e); }
  });
}
