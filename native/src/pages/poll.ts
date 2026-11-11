// Poll page (web parity): tappable candidate cards with my-vote ring/check and
// share fill, standings header, tie-breaks, and an in-app date picker for the
// end date when an admin starts a poll.
import { api, type Club } from '../api';
import { esc, errText, go, pickerFieldHTML, scaffold, toast, wireDatePicker } from '../ui';
import { bookTextHtml, coverHtml, pollCandidatesOf } from './club';
import { ClubPage } from './club';

function pollDefaultEnd(club: Club): string {
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  if (club.meeting?.date) {
    const d = new Date(club.meeting.date + 'T12:00:00');
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() - 1);
      const ds = d.toISOString().slice(0, 10);
      return ds < week ? ds : week;
    }
  }
  return week;
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
                : '<div class="empty-note">The admin picks the winner.</div>'}`;
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
    if (pollCandidatesOf(club).length < 2) {
      body.innerHTML = '<div class="empty-note">No poll running. A poll needs at least two books that nobody has finished yet.</div>';
      return;
    }
    body.innerHTML = `
      <div class="club-card">
        <h3>${club.current ? 'Pick the next book' : 'Pick a book'}</h3>
        <div style="color:var(--ion-color-medium);font-size:14px;margin:6px 0 0">End date</div>
        ${pickerFieldHTML('pollEnd', 'date', pollDefaultEnd(club))}
        <ion-button id="startBtn" expand="block" style="margin-top:12px"><ion-icon slot="start" name="bar-chart-outline"></ion-icon>Start poll</ion-button>
        <p id="pErr" style="color:var(--ion-color-danger);min-height:18px;margin:6px 0 0;font-size:14px"></p>
      </div>
      <p style="margin:8px 32px;color:var(--ion-color-medium);font-size:13px">Defaults to one day before the next meeting, and never runs past a week.</p>`;
    wireDatePicker(body, 'pollEnd');
    body.querySelector('#startBtn')?.addEventListener('click', async () => {
      const endDate = ((body.querySelector('#pollEnd') as HTMLInputElement | null)?.value || '').slice(0, 10);
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
  const myVote = poll.myVote || null;
  body.innerHTML = `
    <div class="section-label">${poll.runoff ? 'Runoff' : (club.current ? 'Pick the next book' : 'Pick a book')}</div>
    <div style="padding:0 16px 4px;color:var(--ion-color-medium);font-size:14px">${total} vote${total === 1 ? '' : 's'} · Closes ${new Date(poll.closesAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
    <ion-list inset="true">
      ${poll.options.filter((o) => !!o.book).map((o) => {
        const mine = myVote === o.book.key;
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        return `<div class="pickcard ${mine ? 'mine' : ''}" data-vote="${esc(o.book.key)}" role="button" aria-pressed="${mine}" aria-label="Vote for ${esc(o.book.title)}">
          <span class="sharefill" style="width:${pct}%"></span>
          <div class="book-row" style="position:relative">${coverHtml(o.book)}
            <div class="grow">
              <div class="book-title">${esc(o.book.title)}</div>
              <div class="book-sub">${esc(o.book.author || '')}</div>
              ${mine ? '<div class="yourvote">Your vote</div>' : ''}
            </div>
            ${mine ? '<span class="selcheck"><ion-icon name="checkmark"></ion-icon></span>' : ''}
            <b style="position:relative;flex:none;min-width:20px;text-align:right">${o.votes}</b>
          </div>
        </div>`;
      }).join('')}
    </ion-list>
    ${isAdmin ? '<div style="padding:14px 16px"><ion-button id="closeBtn" expand="block" fill="outline" color="danger">Close poll</ion-button></div>' : ''}`;

  body.querySelectorAll('[data-vote]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await api('vote', { clubId, bookKey: (b as HTMLElement).dataset.vote }); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
  });
  body.querySelector('#closeBtn')?.addEventListener('click', async () => {
    try { await api('closePoll', { clubId }); await toast('Poll closed'); backToClub(); }
    catch (e) { await toast(errText(e), 'danger'); }
  });
}
