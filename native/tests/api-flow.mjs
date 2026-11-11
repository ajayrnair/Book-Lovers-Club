// End-to-end lifecycle test against the Book Lovers Club API.
// Creates fresh throwaway accounts, exercises the full feature flow the native
// app uses, then deletes the accounts (which also removes their data/clubs).
// Target: production by default; set BLC_API_BASE to run against a local
// handler instance (e.g. http://127.0.0.1:4188/api/handler).
const BASE = process.env.BLC_API_BASE || 'https://booklovers-lemon.vercel.app/api/handler';
console.log('API base:', BASE);
const ts = Date.now();
const U1 = { name: 'Native Test One', email: `blc.native.${ts}@example.com`, password: 'test-pass-123' };
const U2 = { name: 'Native Test Two', email: `blc.native2.${ts}@example.com`, password: 'test-pass-456' };

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
async function api(token, action, body = {}) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

console.log('== auth ==');
let r = await api(null, 'signup', U1);
check('signup user1', r.status === 200 && !!r.j.token, JSON.stringify(r.j));
const t1 = r.j.token;
r = await api(t1, 'me');
check('me returns user1', r.j.user?.email === U1.email);

console.log('== club ==');
r = await api(t1, 'createClub', { name: 'Native Test Club ' + ts, private: true });
check('createClub private', r.status === 200 && r.j.club?.private === true && r.j.club?.role === 'admin');
const clubId = r.j.club.id;

console.log('== books ==');
r = await api(t1, 'searchBooks', { q: 'Sapiens Yuval Noah Harari' });
check('searchBooks returns results', r.status === 200 && r.j.results?.length > 0, 'got ' + (r.j.results?.length ?? 0));
const book1 = r.j.results.find((b) => /sapiens/i.test(b.title)) || r.j.results[0];
r = await api(t1, 'searchBooks', { q: 'The Silent Patient' });
const book2 = (r.j.results || []).find((b) => /silent patient/i.test(b.title)) || r.j.results?.[0];
check('second book found', !!book2);
r = await api(t1, 'addBooks', { clubIds: [clubId], books: [book1, book2] });
check('addBooks', r.status === 200 && r.j.added?.length === 2, JSON.stringify(r.j));
const key1 = r.j.added[0], key2 = r.j.added[1];
r = await api(t1, 'club', { clubId });
check('library has 2 books', r.j.club.library.length === 2);

console.log('== current book / finished / rating ==');
r = await api(t1, 'setCurrent', { clubId, bookKey: key1 });
check('setCurrent', r.j.club?.current?.key === key1);
r = await api(t1, 'toggleFinished', { clubId, bookKey: key1 });
check('toggleFinished -> myFinished', r.j.club?.myFinished === true);
r = await api(t1, 'rate', { bookKey: key1, rating: 4.5 });
check('rate 4.5', r.status === 200);
r = await api(t1, 'club', { clubId });
check('rating visible (mine + member list)', r.j.club.current.myRating === 4.5 && r.j.club.currentRatings?.[0]?.rating === 4.5,
  JSON.stringify(r.j.club.currentRatings));

console.log('== poll ==');
const endDate = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
r = await api(t1, 'startPoll', { clubId, endDate });
check('startPoll', r.status === 200 && !!r.j.club?.poll, JSON.stringify(r.j).slice(0, 200));
check('poll closes by chosen end date', new Date(r.j.club.poll.closesAt) <= new Date(endDate + 'T23:59:59.999Z'));
r = await api(t1, 'vote', { clubId, bookKey: key2 });
check('vote counted', r.j.club?.poll?.totalVotes === 1);
r = await api(t1, 'closePoll', { clubId });
check('closePoll settles winner as current', r.j.club?.poll === null && r.j.club?.current?.key === key2,
  JSON.stringify({ poll: r.j.club?.poll, cur: r.j.club?.current?.key }));

console.log('== meeting: availability, date, RSVP ==');
r = await api(t1, 'club', { clubId });
const week = r.j.club.week;
check('meeting week present (7 days)', Array.isArray(week) && week.length === 7, JSON.stringify(week));
const availDay = week[week.length - 1];
r = await api(t1, 'availability', { clubId, days: [availDay] });
check('availability saved', (r.j.club.availability?.[r.j.club.members[0].userId] || []).includes(availDay));
r = await api(t1, 'pickDate', { clubId, date: availDay });
check('pickDate sets meeting date', r.j.club?.meeting?.date === availDay, JSON.stringify(r.j.club?.meeting));
check('available member auto-marked going', r.j.club?.rsvps?.[r.j.club.members[0].userId] === 'going',
  JSON.stringify(r.j.club?.rsvps));
r = await api(t1, 'rsvp', { clubId, status: 'going' });
check('rsvp going', r.j.club?.rsvps?.[r.j.club.members[0].userId] === 'going');

console.log('== settings: frequency, auto-poll, meeting ==');
r = await api(t1, 'clubSettings', { clubId, meetingFrequencyWeeks: 3, autoPoll: true, meeting: { type: 'online', link: 'https://meet.example.com/x', address: '' } });
check('clubSettings applied', r.j.club?.meetingFrequencyWeeks === 3 && r.j.club?.autoPoll === true && r.j.club?.meeting?.link === 'https://meet.example.com/x',
  JSON.stringify(r.j.club?.meeting));

console.log('== members: invite, join, promote, demote ==');
r = await api(t1, 'createInvite', { clubId, email: U2.email });
check('createInvite', r.status === 200 && !!r.j.inviteToken);
const inviteToken = r.j.inviteToken;
r = await api(null, 'signup', U2);
const t2 = r.j.token;
check('signup user2', !!t2);
r = await api(t2, 'acceptInvite', { inviteToken });
check('acceptInvite joins club', r.status === 200 && r.j.club?.isMember === true, JSON.stringify(r.j).slice(0, 160));
r = await api(t2, 'acceptInvite', { inviteToken });
check('invite is single-use', r.status === 400, 'status ' + r.status);
const u2id = (await api(t2, 'me')).j.user.id;
r = await api(t1, 'makeAdmin', { clubId, userId: u2id });
check('makeAdmin', r.j.club?.members?.find((m) => m.userId === u2id)?.role === 'admin');
r = await api(t1, 'removeAdmin', { clubId, userId: u2id });
check('removeAdmin', r.j.club?.members?.find((m) => m.userId === u2id)?.role === 'member');

console.log('== cleanup: delete accounts ==');
r = await api(t2, 'deleteAccount');
check('deleteAccount user2', r.status === 200);
r = await api(t1, 'club', { clubId });
check('club survives with user1 only', r.status === 200 && r.j.club.memberCount === 1, 'members=' + r.j.club?.memberCount);
r = await api(t1, 'deleteAccount');
check('deleteAccount user1', r.status === 200);
r = await api(null, 'signin', { email: U1.email, password: U1.password });
check('deleted user1 cannot sign in', r.status === 400, 'status ' + r.status);
r = await api(null, 'signin', { email: U2.email, password: U2.password });
check('deleted user2 cannot sign in', r.status === 400, 'status ' + r.status);

console.log(`\nAPI FLOW: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
