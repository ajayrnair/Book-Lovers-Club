// Settings: one entry per page — Members, Frequency & auto-poll, Delete club.
import { api, type Club } from '../api';
import { back, esc, errText, go, resetTo, scaffold, toast } from '../ui';
import { sessionUser } from '../store';
import { ClubsPage } from './clubs';

async function loadClub(clubId: string): Promise<Club> {
  return (await api<{ club: Club }>('club', { clubId })).club;
}

export async function SettingsPage(root: HTMLElement, clubId: string) {
  const body = scaffold(root, { title: 'Settings', backText: 'Club' });
  body.innerHTML = `
    <ion-list inset="true">
      <ion-item button detail="true" id="sMembers">
        <ion-icon name="people-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Members</ion-label>
      </ion-item>
      <ion-item button detail="true" id="sFreq">
        <ion-icon name="calendar-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Meeting frequency</ion-label>
      </ion-item>
      <ion-item button detail="true" id="sDelete">
        <ion-icon name="trash-outline" slot="start" color="danger"></ion-icon>
        <ion-label color="danger">Delete club</ion-label>
      </ion-item>
    </ion-list>`;
  body.querySelector('#sMembers')?.addEventListener('click', () => go((r) => MembersPage(r, clubId)));
  body.querySelector('#sFreq')?.addEventListener('click', () => go((r) => FrequencyPage(r, clubId)));
  body.querySelector('#sDelete')?.addEventListener('click', () => go((r) => DeleteClubPage(r, clubId)));
}

export async function MembersPage(root: HTMLElement, clubId: string) {
  const body = scaffold(root, { title: 'Members', backText: 'Settings' });
  body.innerHTML = '<div class="empty-note">Loading…</div>';
  let club: Club;
  try { club = await loadClub(clubId); }
  catch (e) { body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`; return; }
  const reload = () => go((r) => MembersPage(r, clubId), { replace: true });
  const myId = sessionUser()?.id || '';
  const admins = club.members.filter((m) => m.role === 'admin').length;

  body.innerHTML = `
    <ion-list inset="true">
      ${club.members.map((m) => `
        <ion-item>
          <ion-icon name="person-circle-outline" slot="start" color="medium"></ion-icon>
          <ion-label>${esc(m.name)}${m.role === 'admin' ? ' <ion-badge color="primary">Admin</ion-badge>' : ''}</ion-label>
          <span slot="end" id="mact-${m.userId}">
            ${m.role === 'admin'
              ? (admins > 1 ? `<ion-button fill="outline" size="small" data-remove-admin="${m.userId}">Remove admin</ion-button>` : '')
              : `<ion-button fill="outline" size="small" data-make-admin="${m.userId}">Make admin</ion-button>`}
            ${m.userId !== myId ? `<ion-button fill="outline" size="small" color="danger" data-remove="${m.userId}" data-name="${esc(m.name)}">Remove</ion-button>` : ''}
          </span>
        </ion-item>`).join('')}
    </ion-list>

    <div class="section-label">Invite a member</div>
    <ion-list inset="true">
      <ion-item><ion-input id="invEmail" type="email" label="Email" label-placement="stacked" placeholder="friend@example.com"></ion-input></ion-item>
    </ion-list>
    <ion-button id="invCreate" expand="block" fill="outline" style="margin:10px 16px">Create invite</ion-button>
    <div id="invOut"></div>
    <p id="invErr" style="color:var(--ion-color-danger);min-height:16px;margin:2px 16px;font-size:14px"></p>`;

  body.querySelectorAll('[data-make-admin]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await api('makeAdmin', { clubId, userId: (b as HTMLElement).dataset.makeAdmin }); await toast('Admin added'); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
  });
  body.querySelectorAll('[data-remove-admin]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await api('removeAdmin', { clubId, userId: (b as HTMLElement).dataset.removeAdmin }); await toast('Admin removed'); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
  });
  // Remove member: quiet danger button swaps inline to a two-step confirm (web parity, no modal).
  body.querySelectorAll('[data-remove]').forEach((b) => {
    b.addEventListener('click', () => {
      const el = b as HTMLElement;
      const box = body.querySelector('#mact-' + el.dataset.remove) as HTMLElement | null;
      if (!box) return;
      box.innerHTML = `<span style="color:var(--ion-color-medium);font-size:14px">Remove ${esc(el.dataset.name || '')}?</span>
        <ion-button size="small" color="danger" id="rmYes">Remove</ion-button>
        <ion-button size="small" fill="outline" id="rmNo">Cancel</ion-button>`;
      box.querySelector('#rmNo')?.addEventListener('click', () => reload());
      box.querySelector('#rmYes')?.addEventListener('click', async () => {
        try {
          await api('removeMember', { clubId, userId: el.dataset.remove });
          await toast('Removed');
          reload();
        } catch (e) { await toast(errText(e), 'danger'); }
      });
    });
  });
  (body.querySelector('#invCreate') as any).addEventListener('click', async () => {
    const err = body.querySelector('#invErr') as HTMLElement;
    err.textContent = '';
    const email = ((body.querySelector('#invEmail') as any).value || '').trim();
    try {
      const r = await api<{ inviteToken: string; email: string }>('createInvite', { clubId, email });
      const link = 'https://www.readingpeeps.com/?invite=' + r.inviteToken;
      (body.querySelector('#invOut') as HTMLElement).innerHTML = `
        <ion-list inset="true"><ion-item><ion-label class="ion-text-wrap">
          <h3>Invite for ${esc(r.email)}</h3>
          <p>Send this link to ${esc(r.email)} (works once):</p>
          <p style="font-family:monospace;word-break:break-all">${esc(link)}</p>
        </ion-label></ion-item></ion-list>`;
    } catch (e) { err.textContent = errText(e); }
  });
}

export async function FrequencyPage(root: HTMLElement, clubId: string) {
  const body = scaffold(root, { title: 'Meeting frequency', backText: 'Settings' });
  body.innerHTML = '<div class="empty-note">Loading…</div>';
  let club: Club;
  try { club = await loadClub(clubId); }
  catch (e) { body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`; return; }

  body.innerHTML = `
    <ion-list inset="true">
      <ion-item>
        <ion-label>Meets every</ion-label>
        <ion-select id="freqW" value="${club.meetingFrequencyWeeks}" interface="popover">
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((w) => `<ion-select-option value="${w}">${w} week${w === 1 ? '' : 's'}</ion-select-option>`).join('')}
        </ion-select>
      </ion-item>
      <ion-item>
        <ion-label>Auto-poll<ion-note style="display:block">Start a poll automatically a week before the cycle ends</ion-note></ion-label>
        <ion-toggle id="freqAuto" slot="end" ${club.autoPoll ? 'checked' : ''}></ion-toggle>
      </ion-item>
    </ion-list>
    <div style="padding:14px 16px"><ion-button id="freqSave" expand="block">Save</ion-button></div>`;
  (body.querySelector('#freqSave') as any).addEventListener('click', async () => {
    try {
      await api('clubSettings', {
        clubId,
        meetingFrequencyWeeks: Number((body.querySelector('#freqW') as any).value),
        autoPoll: !!(body.querySelector('#freqAuto') as any).checked,
      });
      await toast('Saved');
      back();
    } catch (e) { await toast(errText(e), 'danger'); }
  });
}

export async function DeleteClubPage(root: HTMLElement, clubId: string) {
  const body = scaffold(root, { title: 'Delete club', backText: 'Settings' });
  body.innerHTML = '<div class="empty-note">Loading…</div>';
  let club: Club;
  try { club = await loadClub(clubId); }
  catch (e) { body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`; return; }

  body.innerHTML = `
    <div class="empty-note">Deleting ${esc(club.name)} removes it for every member. This cannot be undone.</div>
    <div style="padding:0 16px"><ion-button id="delBtn" expand="block" color="danger">Delete club</ion-button></div>`;
  (body.querySelector('#delBtn') as any).addEventListener('click', async () => {
    const alert = document.createElement('ion-alert') as any;
    alert.header = 'Delete club';
    alert.message = `Delete ${club.name} for everyone?`;
    alert.buttons = [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete', role: 'destructive', handler: async () => {
          try { await api('deleteClub', { clubId }); await toast('Club deleted'); resetTo(ClubsPage, 'clubs'); }
          catch (e) { await toast(errText(e), 'danger'); }
        },
      },
    ];
    document.body.appendChild(alert);
    await alert.present();
  });
}
