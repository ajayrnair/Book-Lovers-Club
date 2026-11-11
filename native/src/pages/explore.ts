// Explore: faceted Find + guided Create (web parity), plus the native invite join.
// Find filters mirror the searchClubs contract: name q, format, genre (one per API
// call — multi-genre intersects client-side, as the web does), audience (exact),
// specialty (substring), near {lat,lng,radiusKm} from the standardized place list.
import { api, type Club } from '../api';
import {
  AUDIENCES, GENRES, PLACES, esc, errText, go, scaffold, toast, type Place,
} from '../ui';
import { ClubPage } from './club';

let xpTab: 'find' | 'create' = 'find';
const xpFind = { genres: new Set<string>(), audience: '', place: null as Place | null, radius: 25 };
const xpCreate = { genres: new Set<string>(), audience: '', place: null as Place | null };

// ---------- shared bits ----------
function genreChipsHTML(sel: Set<string>): string {
  return GENRES.map((g) => `<ion-chip class="${sel.has(g) ? 'sel' : ''}" data-genre="${esc(g)}">${esc(g)}</ion-chip>`).join('');
}
function wireGenreChips(box: HTMLElement | null, sel: Set<string>, max: number) {
  if (!box) return;
  box.querySelectorAll('[data-genre]').forEach((ch) => ch.addEventListener('click', () => {
    const g = (ch as HTMLElement).dataset.genre!;
    if (sel.has(g)) { sel.delete(g); ch.classList.remove('sel'); }
    else {
      if (max && sel.size >= max) { void toast('Up to ' + max + ' genres'); return; }
      sel.add(g); ch.classList.add('sel');
    }
  }));
}
function renderAud(box: HTMLElement | null, state: { audience: string }, withAny: boolean) {
  if (!box) return;
  const opts = withAny ? ['Any', ...AUDIENCES] : AUDIENCES;
  box.innerHTML = opts.map((a) => {
    const on = withAny ? (state.audience === a || (!state.audience && a === 'Any')) : (state.audience === a);
    return `<ion-chip class="${on ? 'sel' : ''}" data-aud="${esc(a)}">${esc(a)}</ion-chip>`;
  }).join('');
  box.querySelectorAll('[data-aud]').forEach((ch) => ch.addEventListener('click', () => {
    const a = (ch as HTMLElement).dataset.aud!;
    if (withAny) state.audience = a === 'Any' ? '' : a;
    else state.audience = state.audience === a ? '' : a;
    renderAud(box, state, withAny);
  }));
}
function placePickerHTML(p: string): string {
  return `<div id="${p}Picked" class="hide"><ion-item><ion-label><b id="${p}PickedLabel"></b></ion-label><ion-button slot="end" fill="clear" id="${p}Change">Change</ion-button></ion-item></div>
  <div id="${p}Search"><ion-item><ion-input id="${p}Q" placeholder="Search places"></ion-input></ion-item><div id="${p}List"></div></div>`;
}
function wirePlacePicker(scope: HTMLElement, p: string, store: { place: Place | null }) {
  const q = scope.querySelector('#' + p + 'Q') as any;
  const list = scope.querySelector('#' + p + 'List') as HTMLElement | null;
  if (!q || !list) return;
  const renderList = () => {
    const t = ((q.value as string) || '').trim().toLowerCase();
    const hits = PLACES.filter((x) => !t || x.label.toLowerCase().includes(t)).slice(0, 8);
    list.innerHTML = hits.length
      ? `<ion-list>${hits.map((x) => `<ion-item button data-place="${esc(x.label)}"><ion-label>${esc(x.label)}</ion-label></ion-item>`).join('')}</ion-list>`
      : '<div class="empty-note" style="padding:12px">No places match</div>';
    list.querySelectorAll('[data-place]').forEach((el) => el.addEventListener('click', () => {
      store.place = PLACES.find((x) => x.label === (el as HTMLElement).dataset.place) || null;
      showPicked();
    }));
  };
  const showPicked = () => {
    const picked = scope.querySelector('#' + p + 'Picked') as HTMLElement;
    const search = scope.querySelector('#' + p + 'Search') as HTMLElement;
    if (store.place) {
      (scope.querySelector('#' + p + 'PickedLabel') as HTMLElement).textContent = store.place.label;
      picked.classList.remove('hide'); search.classList.add('hide');
    } else {
      picked.classList.add('hide'); search.classList.remove('hide');
      q.value = ''; renderList();
    }
  };
  q.addEventListener('ionInput', renderList);
  scope.querySelector('#' + p + 'Change')?.addEventListener('click', () => { store.place = null; showPicked(); });
  if (store.place) showPicked(); else renderList();
}

// ---------- page ----------
export function ExplorePage(root: HTMLElement) {
  const body = scaffold(root, { title: 'Explore clubs', backText: 'Clubs' });
  body.innerHTML = `
    <div style="padding:14px 16px 0">
      <ion-segment id="xpSeg" value="${xpTab}">
        <ion-segment-button value="find"><ion-label>Find a club</ion-label></ion-segment-button>
        <ion-segment-button value="create"><ion-label>Create a club</ion-label></ion-segment-button>
      </ion-segment>
    </div>
    <div id="xpBody"></div>`;
  const seg = body.querySelector('#xpSeg') as any;
  seg.addEventListener('ionChange', (e: any) => { xpTab = e.detail.value; renderXpBody(body); });
  renderXpBody(body);
}

function renderXpBody(body: HTMLElement) {
  if (xpTab === 'create') xpCreateHTML(body); else xpFindHTML(body);
}

function xpFindHTML(body: HTMLElement) {
  const box = body.querySelector('#xpBody') as HTMLElement;
  box.innerHTML = `
    <ion-list inset="true">
      <ion-item><ion-input id="xq" placeholder="Club name"></ion-input></ion-item>
    </ion-list>
    <div class="fldlabel">Format</div>
    <div style="padding:0 16px">
      <ion-segment id="xfSeg" value="any">
        <ion-segment-button value="any"><ion-label>Any</ion-label></ion-segment-button>
        <ion-segment-button value="online"><ion-label>Online</ion-label></ion-segment-button>
        <ion-segment-button value="in-person"><ion-label>In person</ion-label></ion-segment-button>
      </ion-segment>
    </div>
    <div class="fldlabel">Genres</div>
    <div class="xchips" id="xGenres">${genreChipsHTML(xpFind.genres)}</div>
    <div class="fldlabel">Audience</div>
    <div class="xchips" id="xAud"></div>
    <div class="fldlabel">Specialty</div>
    <ion-list inset="true"><ion-item><ion-input id="xspec" placeholder="Specialty"></ion-input></ion-item></ion-list>
    <div class="fldlabel">Near</div>
    <ion-list inset="true">${placePickerHTML('np')}</ion-list>
    <div style="padding:8px 16px 0">
      <ion-segment id="xradSeg" value="${xpFind.radius}">
        ${[10, 25, 50].map((km) => `<ion-segment-button value="${km}"><ion-label>${km} km</ion-label></ion-segment-button>`).join('')}
      </ion-segment>
    </div>
    <ion-button id="xsearch" expand="block" style="margin:14px 16px 4px">Search</ion-button>
    <div id="xresults"></div>
    <div class="section-label">Have an invite?</div>
    <ion-list inset="true">
      <ion-item><ion-input id="invToken" label="Invite link or code" label-placement="stacked" placeholder="Paste invite"></ion-input></ion-item>
    </ion-list>
    <ion-button id="invGo" expand="block" fill="outline" style="margin:10px 16px">Join with invite</ion-button>
    <p id="invErr" style="color:var(--ion-color-danger);min-height:18px;margin:6px 16px;font-size:14px"></p>`;

  wireGenreChips(box.querySelector('#xGenres'), xpFind.genres, 0);
  renderAud(box.querySelector('#xAud'), xpFind, true);
  wirePlacePicker(box, 'np', xpFind);
  box.querySelector('#xradSeg')?.addEventListener('ionChange', (e: any) => { xpFind.radius = Number(e.detail.value); });

  const run = async () => {
    try {
      const base: Record<string, any> = {};
      const qv = ((box.querySelector('#xq') as any).value || '').trim(); if (qv) base.q = qv;
      const f = (box.querySelector('#xfSeg') as any).value; if (f && f !== 'any') base.format = f;
      if (xpFind.audience) base.audience = xpFind.audience;
      const sp = ((box.querySelector('#xspec') as any).value || '').trim(); if (sp) base.specialty = sp;
      if (xpFind.place) base.near = { lat: xpFind.place.lat, lng: xpFind.place.lng, radiusKm: xpFind.radius };
      let clubs: Club[];
      if (!xpFind.genres.size) {
        clubs = (await api<{ clubs: Club[] }>('searchClubs', base)).clubs;
      } else {
        let acc: Club[] | null = null;
        for (const g of xpFind.genres) {
          const j = await api<{ clubs: Club[] }>('searchClubs', { ...base, genre: g });
          acc = acc === null ? j.clubs : acc.filter((c) => j.clubs.some((x) => x.id === c.id));
        }
        clubs = acc || [];
      }
      renderXpResults(box, clubs);
    } catch (e) { void toast(errText(e), 'danger'); }
  };
  box.querySelector('#xsearch')?.addEventListener('click', () => void run());
  void run();

  box.querySelector('#invGo')?.addEventListener('click', async () => {
    const err = box.querySelector('#invErr') as HTMLElement;
    err.textContent = '';
    const raw = (((box.querySelector('#invToken') as any).value as string) || '').trim();
    const m = raw.match(/invite=([A-Za-z0-9]+)/) || raw.match(/([A-Za-z0-9]{20,})/);
    const token = m ? m[1] : raw;
    try {
      const { club } = await api<{ club: Club }>('acceptInvite', { inviteToken: token });
      await toast('Joined ' + club.name);
      go((r) => ClubPage(r, club.id));
    } catch (e) { err.textContent = errText(e); }
  });
}

function renderXpResults(body: HTMLElement, clubs: Club[]) {
  const box = body.querySelector('#xresults') as HTMLElement;
  if (!box) return;
  box.innerHTML = clubs.length ? `<ion-list inset="true">${clubs.map((c) => `
    <ion-item>
      <ion-label class="ion-text-wrap">
        <h2>${esc(c.name)}</h2>
        <p>${c.memberCount} member${c.memberCount > 1 ? 's' : ''} · ${c.format === 'in-person' ? esc((c.location && c.location.label) || 'In person') : 'Online'}</p>
        ${c.audience ? `<p>${esc(c.audience)}</p>` : ''}
        ${c.specialty ? `<p>${esc(c.specialty)}</p>` : ''}
        ${(c.genres && c.genres.length) ? `<p>${c.genres.map((g) => `<ion-chip style="height:24px;font-size:12px;cursor:default">${esc(g)}</ion-chip>`).join('')}</p>` : ''}
      </ion-label>
      ${c.isMember ? '<ion-badge color="light" slot="end">Joined</ion-badge>' : `<ion-button slot="end" data-join="${c.id}">Join</ion-button>`}
    </ion-item>`).join('')}</ion-list>`
    : '<div class="empty-note">No clubs match</div>';
  box.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api('joinClub', { clubId: (b as HTMLElement).dataset.join });
      (b as HTMLElement).outerHTML = '<ion-badge color="light" slot="end">Joined</ion-badge>';
      await toast('Joined');
    } catch (e) { void toast(errText(e), 'danger'); }
  }));
}

function xpCreateHTML(body: HTMLElement) {
  const box = body.querySelector('#xpBody') as HTMLElement;
  box.innerHTML = `
    <ion-list inset="true">
      <ion-item><ion-input id="cname" placeholder="Club name"></ion-input></ion-item>
    </ion-list>
    <div class="fldlabel">Visibility</div>
    <div style="padding:0 16px">
      <ion-segment id="cvisSeg" value="private">
        <ion-segment-button value="private"><ion-label>Private</ion-label></ion-segment-button>
        <ion-segment-button value="public"><ion-label>Public</ion-label></ion-segment-button>
      </ion-segment>
    </div>
    <div class="fldlabel">Format</div>
    <div style="padding:0 16px">
      <ion-segment id="cfmtSeg" value="online">
        <ion-segment-button value="online"><ion-label>Online</ion-label></ion-segment-button>
        <ion-segment-button value="in-person"><ion-label>In person</ion-label></ion-segment-button>
      </ion-segment>
    </div>
    <div id="cPlace" class="hide"><ion-list inset="true">${placePickerHTML('cp')}</ion-list></div>
    <div class="fldlabel">Genres</div>
    <div class="xchips" id="cGenres">${genreChipsHTML(xpCreate.genres)}</div>
    <div class="fldlabel">Audience</div>
    <div class="xchips" id="cAud"></div>
    <div class="fldlabel">Specialty</div>
    <ion-list inset="true"><ion-item><ion-input id="cspec" placeholder="Specialty (optional)"></ion-input></ion-item></ion-list>
    <ion-button id="ccreate" expand="block" style="margin:14px 16px 4px">Create club</ion-button>`;

  wireGenreChips(box.querySelector('#cGenres'), xpCreate.genres, 8);
  renderAud(box.querySelector('#cAud'), xpCreate, false);
  wirePlacePicker(box, 'cp', xpCreate);
  const fmt = () => (box.querySelector('#cfmtSeg') as any).value || 'online';
  box.querySelector('#cfmtSeg')?.addEventListener('ionChange', () => {
    box.querySelector('#cPlace')?.classList.toggle('hide', fmt() !== 'in-person');
  });

  box.querySelector('#ccreate')?.addEventListener('click', async () => {
    const name = (((box.querySelector('#cname') as any).value as string) || '').trim();
    if (!name) { void toast('Club name needed'); return; }
    const f = fmt();
    if (f === 'in-person' && !xpCreate.place) { void toast('Pick a place for an in-person club'); return; }
    try {
      const payload: Record<string, any> = {
        name,
        private: (box.querySelector('#cvisSeg') as any).value === 'private',
        format: f,
        genres: [...xpCreate.genres],
        audience: xpCreate.audience,
        specialty: (((box.querySelector('#cspec') as any).value as string) || '').trim(),
      };
      if (f === 'in-person') payload.location = xpCreate.place;
      const j = await api<{ club: Club }>('createClub', payload);
      xpCreate.genres.clear(); xpCreate.audience = ''; xpCreate.place = null;
      await toast('Club created');
      go((r) => ClubPage(r, j.club.id), { replace: true });
    } catch (e) { void toast(errText(e), 'danger'); }
  });
}
