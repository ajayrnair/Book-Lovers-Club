// Club page (web parity): switcher strip, Current book + reading progress,
// Next book, Group meeting (autosave editor, in-app pickers), Library, Leave.
import { api, type Book, type Club } from '../api';
import {
  esc, errText, fmtDate, fmtRangeShort, fmtTime, go, pickerFieldHTML, ratingsLine,
  resetTo, scaffold, shiftDayStr, starStripHTML, toast, wireDatePicker, wireStarStrips, wireTimePicker,
} from '../ui';
import { loadUsage, sessionUser, trackUsage, usageOrder } from '../store';
import { ClubsPage } from './clubs';
import { LibraryPage } from './library';
import { PollPage } from './poll';
import { SettingsPage } from './settings';

export function coverHtml(b: Book | null, lg = false): string {
  if (!b) return '';
  const cls = lg ? 'cover-lg' : 'book-cover';
  return b.cover
    ? `<img class="${cls}" src="${esc(b.cover)}" alt="" />`
    : `<div class="book-cover-ph" style="${lg ? 'width:64px;height:95px' : ''}"><ion-icon name="book-outline"></ion-icon></div>`;
}

export function bookTextHtml(b: Book): string {
  return `<div class="grow" style="flex:1;min-width:0">
    <div class="book-title">${esc(b.title)}</div>
    <div class="book-sub">${esc(b.author || '')}${b.year ? ' · ' + esc(b.year) : ''}</div>
    ${ratingsLine(b)}
    ${b.memberCount ? `<div class="book-sub">Members ★ ${b.memberAverage} (${b.memberCount})</div>` : ''}
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

// The "To read" set: library books that are not the current book and that
// no member has finished. Polls and picks run against this set only.
export function pollCandidatesOf(c: Club): Book[] {
  return (c.library || []).filter((b) => (!c.current || b.key !== c.current.key) && !(b.finishedBy && b.finishedBy.length));
}

function clubStripHTML(c: Club, ids: string[]): string {
  const idx = ids.indexOf(c.id);
  const multi = ids.length > 1;
  let sub = '';
  if (multi && ids.length <= 8) sub = `<div class="cs-dots">${ids.map((id) => `<span class="cs-dot${id === c.id ? ' on' : ''}"></span>`).join('')}</div>`;
  else if (multi) sub = `<div class="cs-count">${idx + 1} of ${ids.length}</div>`;
  return `<div class="clubstrip" id="clubStrip" data-club="${c.id}">
    <span class="cs-side">${multi && idx > 0 ? `<button class="iconbtn" id="clubPrev" aria-label="Previous club"><ion-icon name="chevron-back"></ion-icon></button>` : ''}</span>
    <div class="cs-main"><div class="cs-title">${esc(c.name)}${c.private ? '<span class="cs-badge">Private</span>' : ''}</div>${sub}</div>
    <span class="cs-side">${multi && idx < ids.length - 1 ? `<button class="iconbtn" id="clubNext" aria-label="Next club"><ion-icon name="chevron-forward"></ion-icon></button>` : ''}</span>
    <button class="iconbtn" id="clubList" aria-label="All clubs"><ion-icon name="list-outline"></ion-icon></button>
    ${c.role === 'admin' ? `<button class="iconbtn" id="gear" aria-label="Settings"><ion-icon name="settings-outline"></ion-icon></button>` : ''}
  </div>`;
}

function nextBookHTML(c: Club): string {
  const isAdmin = c.role === 'admin';
  const cand = pollCandidatesOf(c);
  let inner = '';
  if (c.poll) {
    const opts = c.poll.options || [];
    const total = c.poll.totalVotes || 0;
    const leader = opts.reduce((a: any, o) => (!a || o.votes > a.votes) ? o : a, null);
    const mine = c.poll.myVote ? opts.find((o) => o.book.key === c.poll.myVote) : null;
    let status = total ? `${esc(leader.book.title)} leads · ${total} vote${total === 1 ? '' : 's'}` : 'No votes yet';
    if (mine) status += ` · Your vote: ${esc(mine.book.title)}`;
    inner = `<div id="pollRow" style="display:flex;gap:10px;align-items:center;cursor:pointer">
      <ion-icon name="bar-chart-outline" style="color:#8b5cf6;font-size:20px"></ion-icon>
      <div style="flex:1;min-width:0"><b>${c.current ? 'Pick the next book' : 'Pick a book'}${c.poll.runoff ? ' · Runoff' : ''}</b>
      <div style="color:var(--ion-color-medium);font-size:14px">${status}</div></div>
      <span style="color:var(--ion-color-medium);font-size:14px">Closes ${new Date(c.poll.closesAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
      <ion-icon name="chevron-forward" style="color:var(--ion-color-medium)"></ion-icon></div>`;
  } else if (c.lastResult && c.lastResult.tie) {
    inner = `<div id="pollRow" style="display:flex;gap:10px;align-items:center;cursor:pointer">
      <ion-icon name="bar-chart-outline" style="color:#8b5cf6;font-size:20px"></ion-icon>
      <b style="flex:1">Poll tied</b><ion-icon name="chevron-forward" style="color:var(--ion-color-medium)"></ion-icon></div>`;
  } else if (c.library.length === 0) {
    inner = `<ion-button id="addBooksBtn" size="small"><ion-icon slot="start" name="plus"></ion-icon>Add books to library</ion-button>`;
  } else if (cand.length === 0) {
    return '';
  } else if (cand.length === 1) {
    const only = cand[0];
    inner = `<div style="color:var(--ion-color-medium);font-size:15px">Only one book to pick</div>
      <ion-button size="small" style="margin-top:6px" data-setcurrent="${esc(only.key)}">Pick ${esc(only.title)}</ion-button>`;
  } else if (!isAdmin) {
    return '';
  } else {
    inner = `<ion-button id="startPoll" size="small"><ion-icon slot="start" name="bar-chart-outline"></ion-icon>Start a poll</ion-button>`;
  }
  if (!inner) return '';
  return `<div class="club-card violet"><h3>${c.current ? 'Next book' : 'Pick a book'}</h3>${inner}</div>`;
}

export async function ClubPage(root: HTMLElement, clubId: string) {
  const body = scaffold(root, { title: 'Club', backText: 'Clubs' });
  body.innerHTML = '<div class="empty-note">Loading…</div>';
  let club: Club;
  let myClubs: Club[] = [];
  try {
    const [cj, mj] = await Promise.all([
      api<{ club: Club }>('club', { clubId }),
      api<{ clubs: Club[] }>('myClubs').catch(() => ({ clubs: [] as Club[] })),
    ]);
    club = cj.club;
    myClubs = mj.clubs;
  } catch (e) {
    body.innerHTML = `<div class="empty-note">${esc(errText(e))}</div>`;
    return;
  }
  void trackUsage(clubId);

  const me = sessionUser();
  const myId = me?.id || '';
  const isAdmin = club.role === 'admin';
  const hdr = root.querySelector('ion-title');
  if (hdr) hdr.textContent = club.name;
  const lgTitle = root.querySelector('ion-title[size="large"]');
  if (lgTitle) lgTitle.textContent = club.name;

  const usage = await loadUsage().catch(() => ({}));
  let flipIds = usageOrder(myClubs, usage).map((c) => c.id);
  if (flipIds.length !== myClubs.length) flipIds = myClubs.map((c) => c.id);
  if (!flipIds.includes(club.id)) flipIds.push(club.id);
  const flipIdx = flipIds.indexOf(club.id);

  const reload = () => go((r) => ClubPage(r, club.id), { replace: true });

  // ----- current book -----
  let currentHtml = '';
  if (club.current) {
    const cb = club.current;
    const fin = club.finishedBy || [];
    const rated = club.currentRatings.filter((r) => r.rating !== null && r.rating !== undefined);
    const avg = rated.length ? Math.round(rated.reduce((a, r) => a + (r.rating || 0), 0) / rated.length * 10) / 10 : null;
    // progress
    const total = cb.pageCount ? Math.max(1, Math.round(Number(cb.pageCount))) : null;
    const mine = (club.progress || []).find((p) => p.userId === myId);
    const pct = mine ? mine.percent : (club.myFinished ? 100 : 0);
    const page = mine && mine.page !== null && mine.page !== undefined ? mine.page : (total ? Math.round(pct / 100 * total) : null);
    const byId: Record<string, any> = {};
    (club.progress || []).forEach((p) => { byId[p.userId] = p; });
    const ordered = [...club.members].sort((a, b) => ((a.userId === myId ? 0 : 1) - (b.userId === myId ? 0 : 1)));
    const memberRows = ordered.map((m) => {
      const p = byId[m.userId];
      const isFin = (p && p.percent >= 100) || fin.includes(m.userId);
      let txt: string, w: number, cls = 'ptxt';
      if (p) { w = p.percent; txt = isFin ? 'Finished' : ((p.page !== null && p.page !== undefined) ? `p. ${p.page} · ${p.percent}%` : `${p.percent}%`); }
      else if (isFin) { w = 100; txt = 'Finished'; }
      else { w = 0; txt = 'Not started'; cls = 'ptxt'; }
      if (isFin) cls = 'pfin';
      return `<div class="prow"><span class="pname">${m.userId === myId ? 'You' : esc(m.name)}</span><span class="progBar"><i style="width:${w}%"></i></span><span class="${cls}">${txt}</span></div>`;
    }).join('');
    currentHtml = `
      <div class="book-row" style="padding-left:0;padding-right:0">${coverHtml(cb, true)}${bookTextHtml(cb)}</div>
      <div class="book-ctl" style="padding-left:74px">${starStripHTML(cb.key, cb.myRating ?? null, cb.title)}</div>
      <div class="prog" id="myProg">
        <div style="font-size:15px"><b>You</b></div>
        <ion-range id="progSlider" min="0" max="100" step="1" value="${pct}" aria-label="Your reading progress"
          style="--bar-background-active:#c93a54;--knob-background:#c93a54;--bar-height:5px;padding:0 2px"></ion-range>
        <div class="pinputs">
          ${total ? `<span class="pfield"><span>Page</span><ion-input class="pnum" id="progPage" type="number" inputmode="numeric" min="0" max="${total}" value="${page}" aria-label="Current page"></ion-input><span>/ ${total}</span></span>` : ''}
          <span class="pfield"><ion-input class="pnum" id="progPct" type="number" inputmode="numeric" min="0" max="100" value="${pct}" aria-label="Percent read"></ion-input><span>%</span></span>
        </div>
      </div>
      <div style="margin-top:10px">${memberRows}</div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
        <ion-button id="finBtn" size="small" fill="${club.myFinished ? 'solid' : 'outline'}">${club.myFinished ? '✓ Finished' : 'I finished reading'}</ion-button>
        <span style="color:var(--ion-color-medium);font-size:14px">${fin.length} of ${club.members.length} finished</span>
      </div>
      <div id="rateSummary" style="display:flex;margin-top:10px;cursor:pointer">
        <span style="flex:1;color:var(--ion-color-medium);font-size:14px">${rated.length ? `Average ★ ${avg} (${rated.length} rating${rated.length > 1 ? 's' : ''})` : 'No ratings yet'}</span>
        <span style="color:var(--ion-color-medium);font-size:14px">Ratings ›</span>
      </div>
      <div id="rateList" class="hide">${club.currentRatings.map((r) => `<div style="display:flex;padding:3px 0"><span style="flex:1">${esc(r.name)}</span><span>${r.rating === null || r.rating === undefined ? '—' : '★ ' + r.rating}</span></div>`).join('')}</div>`;
  } else {
    currentHtml = '<div style="color:var(--ion-color-medium);font-size:15px">No book picked yet</div>';
  }

  // ----- group meeting -----
  const c0 = club;
  const overlap: Record<string, number> = {};
  Object.values(c0.availability || {}).forEach((days) => days.forEach((d) => { overlap[d] = (overlap[d] || 0) + 1; }));
  let meetingHtml = `<div style="color:var(--ion-color-medium);font-size:14px">Meets every ${c0.meetingFrequencyWeeks} week${c0.meetingFrequencyWeeks > 1 ? 's' : ''}</div>`;
  if (c0.week && c0.week.length) {
    const wFirst = c0.week[0], wLast = c0.week[c0.week.length - 1];
    if (isAdmin) {
      meetingHtml += `<div class="weekrow"><button class="wkbtn" id="shiftPrev" aria-label="Previous week">‹ ${fmtRangeShort(shiftDayStr(wFirst, -7), shiftDayStr(wLast, -7))}</button><span class="wklabel" id="weekLabel">${fmtRangeShort(wFirst, wLast)}</span><button class="wkbtn" id="shiftNext" aria-label="Next week">${fmtRangeShort(shiftDayStr(wFirst, 7), shiftDayStr(wLast, 7))} ›</button></div>`;
    } else {
      meetingHtml += `<div class="weekrow"><span class="wklabel" id="weekLabel" style="flex:1;color:var(--ion-color-medium)">${fmtRangeShort(wFirst, wLast)}</span></div>`;
    }
  }
  if (c0.meeting.date) {
    const going = c0.members.filter((m) => (c0.rsvps || {})[m.userId] === 'going');
    const myR = (c0.rsvps || {})[myId];
    meetingHtml += `<div style="margin:8px 0" id="meetWhen"><b>${fmtDate(c0.meeting.date)}${fmtTime(c0.meeting.time) ? ' · ' + fmtTime(c0.meeting.time) : ''}</b></div>
    <div style="display:flex;gap:8px;align-items:center">
      <ion-button size="small" fill="${myR === 'going' ? 'solid' : 'outline'}" data-rsvp="going">Going</ion-button>
      <ion-button size="small" fill="${myR === 'notgoing' ? 'solid' : 'outline'}" data-rsvp="notgoing">Not going</ion-button>
      <span id="goingCount" style="margin-left:auto;color:var(--ion-color-medium);font-size:14px;cursor:pointer">${going.length} going ›</span>
    </div>`;
  } else {
    const myAvail = c0.availability?.[myId] || [];
    meetingHtml += `<div style="color:var(--ion-color-medium);font-size:14px;margin-top:8px">Pick the days you are available</div>
    <div class="day-grid" style="padding-left:0;padding-right:0">
      ${c0.week.map((d) => {
        const dt = new Date(d + 'T12:00:00');
        const wd = dt.toLocaleDateString(undefined, { weekday: 'short' });
        return `<div class="day-chip ${myAvail.includes(d) ? 'on' : ''}" data-day="${d}"><span class="n">${wd}</span>${dt.getDate()}${overlap[d] ? `<span class="cnt">${overlap[d]} ✓</span>` : ''}</div>`;
      }).join('')}
    </div>`;
  }
  if (c0.meeting.type === 'online') {
    meetingHtml += c0.meeting.link
      ? `<div style="margin-top:8px"><a href="${esc(c0.meeting.link)}" target="_blank" rel="noopener">Join online</a></div>`
      : '<div style="color:var(--ion-color-medium);font-size:14px;margin-top:8px">Online</div>';
  } else {
    meetingHtml += c0.meeting.address
      ? `<div style="color:var(--ion-color-medium);font-size:14px;margin-top:8px">📍 ${esc(c0.meeting.address)}</div>`
      : '<div style="color:var(--ion-color-medium);font-size:14px;margin-top:8px">In person</div>';
  }
  if (isAdmin) {
    meetingHtml += `<div style="border-top:1px solid var(--ion-color-light);margin-top:10px;padding-top:2px">
      ${pickerFieldHTML('pickDate', 'date', c0.meeting.date || '')}
      ${pickerFieldHTML('mtime', 'time', c0.meeting.time || '')}
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px">
        <ion-segment id="mtypeSeg" value="${c0.meeting.type}" style="width:auto">
          <ion-segment-button value="online"><ion-label>Online</ion-label></ion-segment-button>
          <ion-segment-button value="inperson"><ion-label>In person</ion-label></ion-segment-button>
        </ion-segment>
        <span class="savedot" id="meetSaved">Saved</span>
      </div>
      <ion-input class="txtin ${c0.meeting.type === 'online' ? '' : 'hide'}" id="mlink" placeholder="Meeting link" value="${esc(c0.meeting.link || '')}"></ion-input>
      <ion-input class="txtin ${c0.meeting.type === 'inperson' ? '' : 'hide'}" id="maddr" placeholder="Address" value="${esc(c0.meeting.address || '')}"></ion-input>
    </div>`;
  }

  body.innerHTML = `
    ${clubStripHTML(club, flipIds)}
    <div class="club-card"><h3>Current book</h3>${currentHtml}</div>
    ${nextBookHTML(club)}
    <div class="club-card"><h3>Group meeting</h3>${meetingHtml}</div>
    <ion-list inset="true">
      <ion-item button detail="true" id="libGo">
        <ion-icon name="book-outline" slot="start" color="primary"></ion-icon>
        <ion-label>Library</ion-label>
        <ion-note slot="end">${club.library.length} book${club.library.length === 1 ? '' : 's'}</ion-note>
      </ion-item>
    </ion-list>
    <div style="padding:4px 16px"><ion-button id="leaveBtn" fill="outline" color="danger" size="small">Leave club</ion-button></div>`;

  // ----- wiring -----
  const q = (sel: string) => body.querySelector(sel) as any;
  const flipTo = (id: string) => go((r) => ClubPage(r, id), { replace: true });

  if (q('#clubPrev')) q('#clubPrev').addEventListener('click', () => flipTo(flipIds[flipIdx - 1]));
  if (q('#clubNext')) q('#clubNext').addEventListener('click', () => flipTo(flipIds[flipIdx + 1]));
  q('#clubList')?.addEventListener('click', () => go((r) => ClubsPage(r)));
  if (q('#gear')) q('#gear').addEventListener('click', () => go((r) => SettingsPage(r, club.id)));
  q('#libGo')?.addEventListener('click', () => go((r) => LibraryPage(r, club.id)));
  q('#pollRow')?.addEventListener('click', () => go((r) => PollPage(r, club.id)));
  q('#startPoll')?.addEventListener('click', () => go((r) => PollPage(r, club.id)));
  q('#addBooksBtn')?.addEventListener('click', () => go((r) => LibraryPage(r, club.id)));

  // swipe between clubs (ignored when the gesture starts on an interactive element)
  let sx: number | null = null, sy: number | null = null, fromEl: EventTarget | null = null;
  body.addEventListener('touchstart', (e: TouchEvent) => {
    const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; fromEl = e.target;
  }, { passive: true });
  body.addEventListener('touchend', (e: TouchEvent) => {
    if (sx === null || sy === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy; sx = null; sy = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return;
    if (fromEl && (fromEl as HTMLElement).closest && (fromEl as HTMLElement).closest('input, textarea, select, button, a, ion-button, ion-range, ion-segment, .ratestars, .day-chip, .dtfield')) return;
    if (!document.getElementById('clubStrip')) return;
    if (dx < 0 && flipIdx < flipIds.length - 1) flipTo(flipIds[flipIdx + 1]);
    else if (dx > 0 && flipIdx > 0) flipTo(flipIds[flipIdx - 1]);
  }, { passive: true });

  // set-current (single-candidate pick), with the web's one-retry pattern
  body.querySelectorAll('[data-setcurrent]').forEach((b) => {
    b.addEventListener('click', async () => {
      const key = (b as HTMLElement).dataset.setcurrent!;
      const attempt = () => api('setCurrent', { clubId: club.id, bookKey: key });
      try { await attempt(); }
      catch { await new Promise((r) => setTimeout(r, 900)); try { await attempt(); } catch (e2) { await toast(errText(e2), 'danger'); return; } }
      await toast('Book picked');
      reload();
    });
  });

  if (club.current) {
    wireStarStrips(body, async (key, v) => {
      try { await api('rate', { bookKey: key, rating: v }); await toast('Saved'); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
    q('#finBtn')?.addEventListener('click', async () => {
      try { await api('toggleFinished', { clubId: club.id }); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
    q('#rateSummary')?.addEventListener('click', () => { q('#rateList')?.classList.toggle('hide'); });

    // reading progress
    const total = club.current.pageCount ? Math.max(1, Math.round(Number(club.current.pageCount))) : null;
    const slider = q('#progSlider');
    const pageIn = q('#progPage');
    const pctIn = q('#progPct');
    if (slider) {
      const paint = (p: number) => {
        if (pctIn) pctIn.value = String(p);
        if (total && pageIn) pageIn.value = String(Math.round(p / 100 * total));
      };
      const commit = async (payload: Record<string, number>) => {
        const attempt = () => api('setProgress', { clubId: club.id, bookKey: club.current!.key, ...payload });
        try { await attempt(); await toast('Saved'); reload(); }
        catch {
          await new Promise((r) => setTimeout(r, 900));
          try { await attempt(); await toast('Saved'); reload(); } catch (e2) { await toast(errText(e2), 'danger'); }
        }
      };
      slider.addEventListener('ionInput', (e: any) => paint(Number(e.detail.value)));
      slider.addEventListener('ionChange', (e: any) => void commit({ percent: Math.round(Number(e.detail.value)) }));
      if (pageIn) pageIn.addEventListener('ionChange', () => {
        if (!total) return;
        let p = Math.round(Number(pageIn.value));
        if (isNaN(p)) { reload(); return; }
        p = Math.min(total, Math.max(0, p));
        void commit({ page: p });
      });
      if (pctIn) pctIn.addEventListener('ionChange', () => {
        let p = Math.round(Number(pctIn.value));
        if (isNaN(p)) { reload(); return; }
        p = Math.min(100, Math.max(0, p));
        void commit({ percent: p });
      });
    }
  }

  // availability day chips
  body.querySelectorAll('[data-day]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const day = (chip as HTMLElement).dataset.day!;
      const mine = new Set(club.availability?.[myId] || []);
      if (mine.has(day)) mine.delete(day); else mine.add(day);
      try { await api('availability', { clubId: club.id, days: [...mine] }); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
  });

  // RSVP toggle buttons (tapping the active one clears it, web parity)
  body.querySelectorAll('[data-rsvp]').forEach((b) => {
    b.addEventListener('click', async () => {
      const status = (b as HTMLElement).dataset.rsvp!;
      const cur = (club.rsvps || {})[myId];
      try { await api('rsvp', { clubId: club.id, status: cur === status ? '' : status }); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
  });
  q('#goingCount')?.addEventListener('click', () => {
    const g = club.members.filter((m) => (club.rsvps || {})[m.userId] === 'going');
    const ng = club.members.filter((m) => (club.rsvps || {})[m.userId] === 'notgoing');
    void showMembersModal(fmtDate(club.meeting.date), [
      ...g.map((m) => ({ name: m.name, note: 'Going' })),
      ...ng.map((m) => ({ name: m.name, note: 'Not going' })),
    ]);
  });

  if (isAdmin) {
    q('#shiftPrev')?.addEventListener('click', async () => {
      try { await api('shiftMeetingWeek', { clubId: club.id, weeks: -1 }); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });
    q('#shiftNext')?.addEventListener('click', async () => {
      try { await api('shiftMeetingWeek', { clubId: club.id, weeks: 1 }); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
    });

    // autosaving meeting editor (serialized, web parity)
    let meetSaving = false, meetDirty = false;
    const flashSaved = () => {
      const s = q('#meetSaved'); if (!s) return;
      s.style.opacity = '1';
      setTimeout(() => { const s2 = q('#meetSaved'); if (s2) s2.style.opacity = '0'; }, 1600);
    };
    const saveMeeting = async (rerender: boolean) => {
      if (meetSaving) { meetDirty = true; return; }
      meetSaving = true;
      try {
        do {
          meetDirty = false;
          const type = q('#mtypeSeg')?.value || club.meeting.type;
          const j = await api<{ club: Club }>('clubSettings', {
            clubId: club.id,
            meeting: {
              type,
              link: q('#mlink')?.value || '',
              address: q('#maddr')?.value || '',
              time: (body.querySelector('#mtime') as HTMLInputElement | null)?.value || '',
            },
          });
          club = j.club;
        } while (meetDirty);
        flashSaved();
        if (rerender) reload();
      } catch (e) { await toast(errText(e), 'danger'); }
      meetSaving = false;
    };
    q('#mtypeSeg')?.addEventListener('ionChange', (e: any) => {
      const on = e.detail.value === 'online';
      q('#mlink')?.classList.toggle('hide', !on);
      q('#maddr')?.classList.toggle('hide', on);
      void saveMeeting(true);
    });
    q('#mlink')?.addEventListener('ionChange', () => void saveMeeting(false));
    q('#maddr')?.addEventListener('ionChange', () => void saveMeeting(false));
    wireTimePicker(body, 'mtime', async () => {
      await saveMeeting(false);
      const mw = q('#meetWhen');
      if (mw && club.meeting.date) mw.innerHTML = `<b>${fmtDate(club.meeting.date)}${fmtTime(club.meeting.time) ? ' · ' + fmtTime(club.meeting.time) : ''}</b>`;
    });
    wireDatePicker(body, 'pickDate', async (v) => {
      try { await api('pickDate', { clubId: club.id, date: v }); reload(); }
      catch (e) { await toast(errText(e), 'danger'); }
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
          try { await api('leaveClub', { clubId: club.id }); resetTo(ClubsPage, 'clubs'); }
          catch (e) { await toast(errText(e), 'danger'); }
        },
      },
    ];
    document.body.appendChild(alert);
    await alert.present();
  });
}
