// Clubs tab root: my clubs list + the Explore entry row (web parity).
// Finding and creating clubs live on the Explore page.
import { api, type Club } from '../api';
import { esc, errText, go, scaffold } from '../ui';
import { ClubPage } from './club';
import { ExplorePage } from './explore';

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
  const body = scaffold(root, { title: 'Clubs', backText: null });
  body.innerHTML = '<div class="empty-note">Loading…</div>';

  let clubs: Club[] = [];
  try {
    clubs = (await api<{ clubs: Club[] }>('myClubs')).clubs;
  } catch (e) {
    body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`;
    return;
  }

  body.innerHTML = `
    <div class="section-label">My clubs</div>
    ${clubs.length ? `<ion-list inset="true">${clubs.map(clubItem).join('')}</ion-list>`
      : '<div class="empty-note">No clubs yet</div>'}
    <ion-list inset="true" style="margin-top:22px">
      <ion-item button detail="true" id="exploreRow">
        <ion-icon name="compass-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Explore clubs<p>Find a club or start your own</p></ion-label>
      </ion-item>
    </ion-list>`;

  body.querySelectorAll('[data-club]').forEach((el) => {
    const id = (el as HTMLElement).dataset.club!;
    el.addEventListener('click', () => go((r) => ClubPage(r, id)));
  });
  body.querySelector('#exploreRow')?.addEventListener('click', () => go((r) => ExplorePage(r)));
}
