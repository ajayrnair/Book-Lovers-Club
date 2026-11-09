// Clubs tab: my clubs, create a club (private by default), find public clubs.
import { api, type Club } from '../api';
import { esc, errText, go, scaffold, toast } from '../ui';
import { ClubPage } from './club';

function clubItem(c: Club): string {
  return `<ion-item button detail="true" data-club="${c.id}">
    <ion-icon name="book-outline" slot="start" color="primary"></ion-icon>
    <ion-label>
      <h2>${esc(c.name)}</h2>
      <p>${c.memberCount} member${c.memberCount === 1 ? '' : 's'}${c.current ? ' · Reading ' + esc(c.current.title) : ''}</p>
    </ion-label>
    ${c.private ? '<ion-icon name="lock-closed-outline" slot="end" color="medium"></ion-icon>' : ''}
  </ion-item>`;
}

export async function ClubsPage(root: HTMLElement) {
  const body = scaffold(root, {
    title: 'Clubs',
    backText: null,
    endButtons: '<ion-button id="newClub"><ion-icon slot="icon-only" name="plus"></ion-icon></ion-button>',
  });
  body.innerHTML = '<div class="empty-note">Loading…</div>';
  root.querySelector('#newClub')?.addEventListener('click', () => go((r) => CreateClubPage(r)));

  let clubs: Club[] = [];
  try {
    clubs = (await api<{ clubs: Club[] }>('myClubs')).clubs;
  } catch (e) {
    body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`;
    return;
  }

  body.innerHTML = `
    ${clubs.length ? `<div class="section-label">My clubs</div><ion-list inset="true">${clubs.map(clubItem).join('')}</ion-list>`
      : '<div class="empty-note">No clubs yet. Create one, or find a public club below.</div>'}
    <div class="section-label">Discover</div>
    <ion-list inset="true">
      <ion-item button detail="true" id="findClubs">
        <ion-icon name="search-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Find a club</ion-label>
      </ion-item>
      <ion-item button detail="true" id="newClub2">
        <ion-icon name="add-circle-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Create a club</ion-label>
      </ion-item>
    </ion-list>`;

  body.querySelectorAll('[data-club]').forEach((el) => {
    const id = (el as HTMLElement).dataset.club!;
    el.addEventListener('click', () => go((r) => ClubPage(r, id)));
  });
  body.querySelector('#findClubs')?.addEventListener('click', () => go((r) => FindClubsPage(r)));
  body.querySelector('#newClub2')?.addEventListener('click', () => go((r) => CreateClubPage(r)));
}

export function CreateClubPage(root: HTMLElement) {
  const body = scaffold(root, { title: 'Create club', backText: 'Clubs' });
  body.innerHTML = `
    <ion-list inset="true">
      <ion-item><ion-input id="clubName" label="Club name" label-placement="stacked" placeholder="e.g. Seattle Readers"></ion-input></ion-item>
      <ion-item>
        <ion-label>Private</ion-label>
        <ion-toggle id="clubPrivate" checked="true" slot="end"></ion-toggle>
      </ion-item>
    </ion-list>
    <p style="margin:8px 32px;color:var(--ion-color-medium);font-size:13px">Private clubs join by invite only.</p>
    <p id="ccErr" style="color:var(--ion-color-danger);min-height:18px;margin:6px 16px;font-size:14px"></p>
    <ion-button id="ccCreate" expand="block" style="margin:6px 16px">Create club</ion-button>`;

  const $ = (id: string) => root.querySelector('#' + id) as any;
  $('ccCreate').addEventListener('click', async () => {
    $('ccErr').textContent = '';
    try {
      const { club } = await api<{ club: Club }>('createClub', {
        name: ($('clubName').value || '').trim(),
        private: !!$('clubPrivate').checked,
      });
      await toast('Club created');
      go((r) => ClubPage(r, club.id), { replace: true });
    } catch (e) { $('ccErr').textContent = errText(e); }
  });
}

export async function FindClubsPage(root: HTMLElement) {
  const body = scaffold(root, { title: 'Find a club', backText: 'Clubs' });
  body.innerHTML = `
    <ion-searchbar id="fq" placeholder="Search public clubs" debounce="300"></ion-searchbar>
    <div id="fres"><div class="empty-note">Loading…</div></div>
    <div class="section-label">Have an invite?</div>
    <ion-list inset="true">
      <ion-item><ion-input id="invToken" label="Invite link or code" label-placement="stacked" placeholder="Paste invite"></ion-input></ion-item>
    </ion-list>
    <ion-button id="invGo" expand="block" fill="outline" style="margin:10px 16px">Join with invite</ion-button>
    <p id="invErr" style="color:var(--ion-color-danger);min-height:18px;margin:6px 16px;font-size:14px"></p>`;

  const res = body.querySelector('#fres') as HTMLElement;
  async function load(q: string) {
    try {
      const { clubs } = await api<{ clubs: Club[] }>('searchClubs', { q });
      res.innerHTML = clubs.length
        ? `<ion-list inset="true">${clubs.map((c) => `
            <ion-item>
              <ion-icon name="book-outline" slot="start" color="primary"></ion-icon>
              <ion-label><h2>${esc(c.name)}</h2><p>${c.memberCount} member${c.memberCount === 1 ? '' : 's'}</p></ion-label>
              ${c.isMember
                ? '<ion-badge color="light" slot="end">Joined</ion-badge>'
                : `<ion-button slot="end" data-join="${c.id}">Join</ion-button>`}
            </ion-item>`).join('')}</ion-list>`
        : '<div class="empty-note">No public clubs found.</div>';
      res.querySelectorAll('[data-join]').forEach((b) => {
        b.addEventListener('click', async () => {
          const id = (b as HTMLElement).dataset.join!;
          try {
            const { club } = await api<{ club: Club }>('joinClub', { clubId: id });
            await toast('Joined ' + club.name);
            go((r) => ClubPage(r, club.id));
          } catch (e) { await toast(errText(e), 'danger'); }
        });
      });
    } catch (e) {
      res.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`;
    }
  }
  await load('');
  (body.querySelector('#fq') as any).addEventListener('ionInput', (e: any) => void load(e.detail.value || ''));

  (body.querySelector('#invGo') as any).addEventListener('click', async () => {
    const err = body.querySelector('#invErr') as HTMLElement;
    err.textContent = '';
    let raw = ((body.querySelector('#invToken') as any).value || '').trim();
    const m = raw.match(/invite=([A-Za-z0-9]+)/) || raw.match(/([A-Za-z0-9]{20,})/);
    const token = m ? m[1] : raw;
    try {
      const { club } = await api<{ club: Club }>('acceptInvite', { inviteToken: token });
      await toast('Joined ' + club.name);
      go((r) => ClubPage(r, club.id));
    } catch (e) { err.textContent = errText(e); }
  });
}
