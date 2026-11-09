// Club page: Current Book, poll entry, Group meeting, Library link, Settings.
import { api, type Book, type Club } from '../api';
import { esc, errText, fmtDate, fmtDateTime, go, ratingChips, resetTo, scaffold, starsDisplay, toast, wireRatingChips, ratingsLine } from '../ui';
import { LibraryPage } from './library';
import { PollPage } from './poll';
import { SettingsPage } from './settings';

export function coverHtml(b: Book | null, lg = false): string {
  if (!b) return '';
  const cls = lg ? 'cover-lg' : 'book-cover';
  return b.cover
    ? `<img class="${cls}" src="${esc(b.cover)}" alt="" />`
    : `<div class="${cls === 'cover-lg' ? 'book-cover-ph' : 'book-cover-ph'}" style="${lg ? 'width:64px;height:95px' : ''}"><ion-icon name="book-outline"></ion-icon></div>`;
}

export function bookTextHtml(b: Book): string {
  return `<div class="grow">
    <div class="book-title">${esc(b.title)}</div>
    <div class="book-sub">${esc(b.author || '')}${b.year ? ' · ' + esc(b.year) : ''}</div>
    ${ratingsLine(b)}
  </div>`;
}

async function showMembersModal(title: string, rows: { name: string; note: string }[]) {
  const modal = document.createElement('ion-modal') as any;
  modal.innerHTML = `
    <ion-header><ion-toolbar><ion-title>${esc(title)}</ion-title>
      <ion-buttons slot="end"><ion-button id="mmClose">Done</ion-button></ion-buttons></ion-toolbar></ion-header>
    <ion-content>
      <ion-list inset="true">
        ${rows.length ? rows.map((r) => `<ion-item><ion-label>${esc(r.name)}</ion-label><ion-note slot="end">${esc(r.note)}</ion-note></ion-item>`).join('') : '<div class="empty-note">Nobody yet</div>'}
      </ion-list>
    </ion-content>`;
  document.body.appendChild(modal);
  modal.querySelector('#mmClose').addEventListener('click', () => modal.dismiss());
  await modal.present();
}

export async function ClubPage(root: HTMLElement, clubId: string) {
  const body = scaffold(root, { title: 'Club', backText: 'Clubs' });
  body.innerHTML = '<div class="empty-note">Loading…</div>';
  let club: Club;
  try {
    club = (await api<{ club: Club }>('club', { clubId })).club;
  } catch (e) {
    body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`;
    return;
  }

  const isAdmin = club.role === 'admin';
  const hdr = root.querySelector('ion-title');
  if (hdr) hdr.textContent = club.name;
  const lgTitle = root.querySelector('ion-title[size="large"]');
  if (lgTitle) lgTitle.textContent = club.name;

  // ----- poll entry state -----
  const libCount = club.library.length;
  let pollEntry = '';
  if (club.poll) {
    pollEntry = `<ion-item button detail="true" id="pollGo">
        <ion-icon name="people-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Pick the next book<p>Poll closes ${fmtDateTime(club.poll.closesAt)} · ${club.poll.totalVotes} vote${club.poll.totalVotes === 1 ? '' : 's'}</p></ion-label>
      </ion-item>`;
  } else if (club.lastResult?.tie?.length) {
    pollEntry = `<ion-item button detail="true" id="pollGo">
        <ion-icon name="people-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Poll tied<p>${club.lastResult.tie.length} books tied — needs a tie-break</p></ion-label>
      </ion-item>`;
  } else if (isAdmin && libCount >= 2) {
    pollEntry = `<ion-item button detail="true" id="pollGo">
        <ion-icon name="people-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Start a poll</ion-label>
      </ion-item>`;
  }

  // ----- current book -----
  let currentHtml = '';
  if (club.current) {
    const cb = club.current;
    const finCount = club.finishedBy.length;
    currentHtml = `
      <div class="book-row">${coverHtml(cb, true)}${bookTextHtml(cb)}</div>
      <div style="padding:2px 16px 4px">
        <div style="font-size:14px;color:var(--ion-color-medium)">Finished: ${finCount} of ${club.memberCount}</div>
        <button id="finList" style="background:none;border:0;padding:4px 0;font-size:15px;color:var(--ion-color-dark);cursor:pointer">
          Average rating ${starsDisplay(cb.memberAverage ?? null)}
        </button>
        <div style="margin-top:6px;font-size:13px;color:var(--ion-color-medium)">My rating</div>
        ${ratingChips(cb.myRating ?? null, 'id="myRate"')}
        <ion-button id="finToggle" expand="block" fill="${club.myFinished ? 'solid' : 'outline'}" style="margin-top:10px">
          ${club.myFinished ? '✓ Finished reading' : "I'm done reading"}
        </ion-button>
      </div>`;
  } else if (libCount === 0) {
    currentHtml = `
      <div style="padding:6px 16px 12px">
        <div style="color:var(--ion-color-medium);font-size:15px;margin-bottom:10px">No book picked yet</div>
        <ion-button id="addBooksBtn" expand="block"><ion-icon slot="start" name="plus"></ion-icon>Add books to library</ion-button>
      </div>`;
  } else if (libCount === 1 && isAdmin) {
    const only = club.library[0];
    currentHtml = `
      <div style="padding:6px 16px 12px">
        <div style="color:var(--ion-color-medium);font-size:15px;margin-bottom:8px">No book picked yet. Only one book in the library:</div>
        <div class="book-row" style="padding-left:0">${coverHtml(only)}${bookTextHtml(only)}</div>
        <ion-button id="pickOnly" expand="block">Pick this book</ion-button>
      </div>`;
  } else {
    currentHtml = `<div style="padding:6px 16px 12px;color:var(--ion-color-medium);font-size:15px">No book picked yet${isAdmin ? ' — start a poll below.' : '.'}</div>`;
  }

  // ----- group meeting -----
  const m = club.meeting;
  const myAvail = club.availability?.[sessionUserId(club)] || [];
  const myRsvp = club.rsvps?.[sessionUserId(club)];
  const going = club.members.filter((mm) => club.rsvps?.[mm.userId] === 'going');
  const notGoing = club.members.filter((mm) => club.rsvps?.[mm.userId] === 'notgoing');
  let meetingHtml = '';
  if (m.date) {
    meetingHtml = `
      <ion-item><ion-label>Next meeting</ion-label><ion-note slot="end">${fmtDate(m.date)}</ion-note></ion-item>
      <ion-item>
        <ion-label>${going.length} going</ion-label>
        <ion-button slot="end" fill="clear" id="whoGo">See who</ion-button>
      </ion-item>
      <div style="padding:10px 16px 14px">
        <ion-segment id="rsvpSeg" value="${myRsvp || ''}">
          <ion-segment-button value="going"><ion-label>Going</ion-label></ion-segment-button>
          <ion-segment-button value="notgoing"><ion-label>Not going</ion-label></ion-segment-button>
        </ion-segment>
      </div>`;
  } else {
    const counts: Record<string, number> = {};
    Object.values(club.availability || {}).forEach((days) => days.forEach((d) => { counts[d] = (counts[d] || 0) + 1; }));
    meetingHtml = `
      <div style="padding:8px 16px 0;color:var(--ion-color-medium);font-size:14px">Pick the days you are available</div>
      <div class="day-grid">
        ${club.week.map((d) => {
          const dt = new Date(d + 'T12:00:00');
          const wd = dt.toLocaleDateString(undefined, { weekday: 'short' });
          return `<div class="day-chip ${myAvail.includes(d) ? 'on' : ''}" data-day="${d}">${wd}<span class="n">${dt.getDate()}</span>${counts[d] ? `<span class="cnt">${counts[d]} free</span>` : ''}</div>`;
        }).join('')}
      </div>`;
  }
  meetingHtml += `
    <ion-item>
      <ion-label>Format</ion-label>
      <ion-select id="mType" value="${m.type}" interface="popover" ${isAdmin ? '' : 'disabled'}>
        <ion-select-option value="online">Online</ion-select-option>
        <ion-select-option value="inperson">In person</ion-select-option>
      </ion-select>
    </ion-item>
    <div id="mOnline" style="display:${m.type === 'online' ? '' : 'none'}">
      <ion-item><ion-input id="mLink" label="Meeting link" label-placement="stacked" placeholder="https://…" value="${esc(m.link || '')}" ${isAdmin ? '' : 'readonly'}></ion-input></ion-item>
    </div>
    <div id="mInperson" style="display:${m.type === 'inperson' ? '' : 'none'}">
      <ion-item><ion-input id="mAddr" label="Address" label-placement="stacked" placeholder="Street address" value="${esc(m.address || '')}" ${isAdmin ? '' : 'readonly'}></ion-input></ion-item>
    </div>
    ${isAdmin ? `
    <ion-item>
      <ion-label>Meeting date</ion-label>
      <ion-datetime-button datetime="mdt"></ion-datetime-button>
    </ion-item>
    <ion-modal id="mdtModal" style="--height:auto;--width:auto">
      <ion-datetime id="mdt" presentation="date" value="${m.date || ''}" min="${new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)}"></ion-datetime>
    </ion-modal>
    <div style="padding:12px 16px"><ion-button id="mSave" expand="block">Save meeting</ion-button></div>` : ''}`;

  body.innerHTML = `
    <div class="section-label">Current book</div>
    <ion-list inset="true">
      ${currentHtml}
      ${pollEntry}
    </ion-list>

    <div class="section-label">Group meeting</div>
    <ion-list inset="true">
      <ion-item><ion-label color="medium">Meets every ${club.meetingFrequencyWeeks} week${club.meetingFrequencyWeeks === 1 ? '' : 's'}</ion-label></ion-item>
      ${meetingHtml}
    </ion-list>

    <div class="section-label">Library</div>
    <ion-list inset="true">
      <ion-item button detail="true" id="libGo">
        <ion-icon name="book-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Library</ion-label>
        <ion-note slot="end">${libCount} book${libCount === 1 ? '' : 's'}</ion-note>
      </ion-item>
    </ion-list>

    <ion-list inset="true" style="margin-top:22px">
      ${isAdmin ? `<ion-item button detail="true" id="setGo">
        <ion-icon name="settings-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Settings</ion-label>
      </ion-item>` : ''}
      <ion-item button id="leaveBtn">
        <ion-icon name="trash-outline" slot="start" color="danger"></ion-icon>
        <ion-label color="danger">Leave club</ion-label>
      </ion-item>
    </ion-list>`;

  // ----- wiring -----
  const q = (sel: string) => body.querySelector(sel) as any;

  q('#pollGo')?.addEventListener('click', () => go((r) => PollPage(r, club.id)));
  q('#libGo')?.addEventListener('click', () => go((r) => LibraryPage(r, club.id)));
  q('#setGo')?.addEventListener('click', () => go((r) => SettingsPage(r, club.id)));
  q('#addBooksBtn')?.addEventListener('click', () => go((r) => LibraryPage(r, club.id)));
  q('#pickOnly')?.addEventListener('click', async () => {
    try {
      // one retry: a brand-new club's state can lag one read behind (known web bug)
      try { await api('adminPick', { clubId: club.id, bookKey: club.library[0].key }); }
      catch { await api('adminPick', { clubId: club.id, bookKey: club.library[0].key }); }
      await toast('Book picked');
      go((r) => ClubPage(r, club.id), { replace: true });
    } catch (e) { await toast(errText(e), 'danger'); }
  });

  if (club.current) {
    q('#finToggle')?.addEventListener('click', async () => {
      try {
        await api('toggleFinished', { clubId: club.id, bookKey: club.current!.key });
        go((r) => ClubPage(r, club.id), { replace: true });
      } catch (e) { await toast(errText(e), 'danger'); }
    });
    wireRatingChips(body, async (v) => {
      if (v === null) return; // API has no un-rate; ignore clearing
      try { await api('rate', { bookKey: club.current!.key, rating: v }); await toast('Rated ' + v + '★'); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
    q('#finList')?.addEventListener('click', () => {
      void showMembersModal('Ratings', club.currentRatings.map((r) => ({
        name: r.name, note: r.rating === null ? 'Not rated' : r.rating + '★',
      })));
    });
  }

  // availability day chips
  body.querySelectorAll('[data-day]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const day = (chip as HTMLElement).dataset.day!;
      const mine = new Set(club.availability?.[sessionUserId(club)] || []);
      if (mine.has(day)) mine.delete(day); else mine.add(day);
      try {
        await api('availability', { clubId: club.id, days: [...mine] });
        go((r) => ClubPage(r, club.id), { replace: true });
      } catch (e) { await toast(errText(e), 'danger'); }
    });
  });

  // RSVP
  q('#rsvpSeg')?.addEventListener('ionChange', async (e: any) => {
    try {
      await api('rsvp', { clubId: club.id, status: e.detail.value });
      go((r) => ClubPage(r, club.id), { replace: true });
    } catch (err) { await toast(errText(err), 'danger'); }
  });
  q('#whoGo')?.addEventListener('click', () => {
    void showMembersModal('Who is going', [
      ...going.map((mm) => ({ name: mm.name, note: 'Going' })),
      ...notGoing.map((mm) => ({ name: mm.name, note: 'Not going' })),
    ]);
  });

  // meeting format toggle shows only the relevant field
  q('#mType')?.addEventListener('ionChange', (e: any) => {
    const t = e.detail.value;
    const on = body.querySelector('#mOnline') as HTMLElement;
    const ip = body.querySelector('#mInperson') as HTMLElement;
    if (on) on.style.display = t === 'online' ? '' : 'none';
    if (ip) ip.style.display = t === 'inperson' ? '' : 'none';
  });

  if (isAdmin) {
    q('#mSave')?.addEventListener('click', async () => {
      const type = q('#mType').value;
      const meeting = {
        type,
        link: type === 'online' ? (q('#mLink').value || '') : (club.meeting.link || ''),
        address: type === 'inperson' ? (q('#mAddr').value || '') : (club.meeting.address || ''),
      };
      try {
        await api('clubSettings', { clubId: club.id, meeting });
        const dt = q('#mdt');
        const newDate = (dt?.value || '').slice(0, 10);
        if (newDate && newDate !== club.meeting.date) {
          await api('pickDate', { clubId: club.id, date: newDate });
        }
        await toast('Meeting saved');
        go((r) => ClubPage(r, club.id), { replace: true });
      } catch (e) { await toast(errText(e), 'danger'); }
    });
  }

  q('#leaveBtn')?.addEventListener('click', async () => {
    const alert = document.createElement('ion-alert') as any;
    alert.header = 'Leave club';
    alert.message = `Leave ${club.name}?`;
    alert.buttons = [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Leave', role: 'destructive', handler: async () => {
          try { await api('leaveClub', { clubId: club.id }); const { ClubsPage } = await import('./clubs'); resetTo(ClubsPage, 'clubs'); }
          catch (e) { await toast(errText(e), 'danger'); }
        },
      },
    ];
    document.body.appendChild(alert);
    await alert.present();
  });
}

// The club payload doesn't carry my own user id; recover it from the members list
// by matching the session user stored at sign-in.
import { sessionUser } from '../store';
function sessionUserId(_club: Club): string {
  return sessionUser()?.id || '';
}
