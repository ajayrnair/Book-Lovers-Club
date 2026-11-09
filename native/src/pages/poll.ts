// Poll page: Start a poll (admin, end date), voting, enforced close, tie-breaks.
import { api, type Club } from '../api';
import { esc, errText, fmtDate, fmtDateTime, go, scaffold, toast } from '../ui';
import { bookTextHtml, coverHtml } from './club';
import { ClubPage } from './club';

function defaultEndDate(club: Club): string {
  const week = new Date(Date.now() + 7 * 864e5);
  let d = week;
  if (club.meeting?.date) {
    const md = new Date(club.meeting.date + 'T12:00:00');
    if (!isNaN(md.getTime())) {
      md.setDate(md.getDate() - 1);
      if (md.getTime() > Date.now() && md.getTime() < week.getTime()) d = md;
    }
  }
  return d.toISOString().slice(0, 10);
}

export async function PollPage(root: HTMLElement, clubId: string) {
  const body = scaffold(root, { title: 'Poll', backText: 'Club' });
  body.innerHTML = '<div class="empty-note">Loading…</div>';
  let club: Club;
  try {
    club = (await api<{ club: Club }>('club', { clubId })).club;
  } catch (e) {
    body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`;
    return;
  }
  const isAdmin = club.role === 'admin';
  const reload = () => go((r) => PollPage(r, clubId), { replace: true });
  const backToClub = () => go((r) => ClubPage(r, clubId), { replace: true });

  // ----- tie state -----
  if (!club.poll && club.lastResult?.tie?.length) {
    const tied = club.lastResult.tie
      .map((k) => club.library.find((b) => b.key === k))
      .filter(Boolean);
    body.innerHTML = `
      <div class="empty-note">The poll tied between ${tied.length} books.</div>
      <ion-list inset="true">
        ${tied.map((b) => `
          <div>
            <div class="book-row">${coverHtml(b!)}${bookTextHtml(b!)}</div>
            ${isAdmin ? `<div class="book-ctl"><ion-button size="small" data-pick="${esc(b!.key)}">Pick this book</ion-button></div>` : ''}
          </div>`).join('')}
      </ion-list>
      ${isAdmin ? '<div style="padding:14px 16px"><ion-button id="runoffBtn" expand="block" fill="outline">Run a one-day runoff</ion-button></div>'
                : '<div class="empty-note">An admin will break the tie.</div>'}`;
    body.querySelectorAll('[data-pick]').forEach((b) => {
      b.addEventListener('click', async () => {
        try { await api('adminPick', { clubId, bookKey: (b as HTMLElement).dataset.pick }); await toast('Book picked'); backToClub(); }
        catch (e) { await toast(errText(e), 'danger'); }
      });
    });
    body.querySelector('#runoffBtn')?.addEventListener('click', async () => {
      try { await api('runoff', { clubId }); await toast('Runoff started'); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
    return;
  }

  // ----- no poll: start screen -----
  if (!club.poll) {
    if (!isAdmin) {
      body.innerHTML = '<div class="empty-note">No poll is running. An admin can start one.</div>';
      return;
    }
    if (club.library.length < 2) {
      body.innerHTML = '<div class="empty-note">Add at least two books to the library before starting a poll.</div>';
      return;
    }
    body.innerHTML = `
      <ion-list inset="true">
        <ion-item>
          <ion-label>Poll ends</ion-label>
          <ion-datetime-button datetime="pdt"></ion-datetime-button>
        </ion-item>
      </ion-list>
      <ion-modal id="pdtModal" style="--height:auto;--width:auto">
        <ion-datetime id="pdt" presentation="date" value="${defaultEndDate(club)}"
          min="${new Date(Date.now() + 864e5).toISOString().slice(0, 10)}"
          max="${new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)}"></ion-datetime>
      </ion-modal>
      <p style="margin:8px 32px;color:var(--ion-color-medium);font-size:13px">Defaults to one day before the next meeting, and never runs past a week.</p>
      <div style="padding:6px 16px"><ion-button id="startBtn" expand="block">Start a poll</ion-button></div>
      <p id="pErr" style="color:var(--ion-color-danger);min-height:18px;margin:6px 16px;font-size:14px"></p>`;
    body.querySelector('#startBtn')?.addEventListener('click', async () => {
      const endDate = ((body.querySelector('#pdt') as any).value || '').slice(0, 10);
      try {
        await api('startPoll', { clubId, endDate });
        await toast('Poll started');
        reload();
      } catch (e) { (body.querySelector('#pErr') as HTMLElement).textContent = errText(e); }
    });
    return;
  }

  // ----- running poll -----
  const poll = club.poll;
  const total = poll.totalVotes || 0;
  body.innerHTML = `
    <div class="section-label">${poll.runoff ? 'Runoff' : 'Pick the next book'} · closes ${fmtDateTime(poll.closesAt)}</div>
    <ion-list inset="true">
      ${poll.options.filter((o) => !!o.book).map((o) => {
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        return `<div>
          <div class="book-row">${coverHtml(o.book)}${bookTextHtml(o.book)}</div>
          <div style="padding:0 16px 12px 74px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:13px;color:var(--ion-color-medium)">${o.votes} vote${o.votes === 1 ? '' : 's'}</span>
              <ion-button size="small" data-vote="${esc(o.book.key)}">Vote</ion-button>
            </div>
            <div class="vote-bar"><i style="width:${pct}%"></i></div>
          </div>
        </div>`;
      }).join('')}
    </ion-list>
    ${isAdmin ? '<div style="padding:14px 16px"><ion-button id="closeBtn" expand="block" fill="outline" color="danger">Close poll</ion-button></div>' : ''}
    <p style="text-align:center;color:var(--ion-color-medium);font-size:13px">${total} vote${total === 1 ? '' : 's'} so far · ${fmtDate(poll.closesAt)} close</p>`;

  body.querySelectorAll('[data-vote]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await api('vote', { clubId, bookKey: (b as HTMLElement).dataset.vote }); await toast('Vote counted'); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
  });
  body.querySelector('#closeBtn')?.addEventListener('click', async () => {
    try { await api('closePoll', { clubId }); await toast('Poll closed'); backToClub(); }
    catch (e) { await toast(errText(e), 'danger'); }
  });
}
