// Book Lovers Club — single-file API. State is one JSON document.
// Storage priority: (1) BLC_LOCAL_STORE local JSON file (test seam), (2) Upstash
// Redis via its REST API when its env vars are present (key rp:state), (3) the
// private Vercel Blob store. Whole-document semantics are identical on all three.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BLOB_PATH = 'state/db.json';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const LOCAL_STORE = process.env.BLC_LOCAL_STORE || '';
const REDIS_KEY = 'rp:state';

// Upstash REST credentials: accept either env-name pair, whichever is fully set.
function redisConfig() {
  const pairs = [
    [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN],
    [process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN],
  ];
  for (const [u, t] of pairs) {
    if (u && t) return { url: String(u).replace(/\/+$/, ''), token: t };
  }
  return null;
}
async function redisGetState(rc) {
  const r = await fetch(rc.url + '/get/' + encodeURIComponent(REDIS_KEY), {
    headers: { authorization: `Bearer ${rc.token}` },
  });
  if (!r.ok) throw new Error('Redis read failed: HTTP ' + r.status);
  const j = await r.json();
  if (!j || j.result === null || j.result === undefined) return null; // missing key = fresh state
  return JSON.parse(j.result);
}
async function redisSetState(rc, db) {
  const r = await fetch(rc.url + '/set/' + encodeURIComponent(REDIS_KEY), {
    method: 'POST',
    headers: { authorization: `Bearer ${rc.token}`, 'content-type': 'text/plain' },
    body: JSON.stringify(db),
  });
  if (!r.ok) throw new Error('Redis write failed: HTTP ' + r.status);
}

// ---------- persistence ----------
let cache = null, cacheAt = 0;
async function readDB() {
  if (cache && Date.now() - cacheAt < 3000) return cache;
  let db = null;
  const rc = LOCAL_STORE ? null : redisConfig();
  if (LOCAL_STORE) {
    try { db = JSON.parse(fs.readFileSync(LOCAL_STORE, 'utf8')); } catch (e) { /* fall through to fresh db */ }
  } else if (rc) {
    db = await redisGetState(rc);
  } else if (TOKEN) {
    try {
      const list = await fetch('https://blob.vercel-storage.com/?prefix=state/', {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      if (list.ok) {
        const j = await list.json();
        const b = (j.blobs || []).find((x) => x.pathname === BLOB_PATH);
        if (b) {
          const r = await fetch(b.downloadUrl || b.url, { headers: { authorization: `Bearer ${TOKEN}` } });
          if (r.ok) db = await r.json();
        }
      }
    } catch (e) { /* fall through to fresh db */ }
  }
  if (!db) db = { users: [], sessions: {}, books: {}, clubs: [], invites: [], ratings: {}, progress: {} };
  db.progress = db.progress || {};
  (db.clubs || []).forEach((club) => {
    club.finished = club.finished || {};
    club.rsvps = club.rsvps || {};
    club.availability = club.availability || {};
    club.library = club.library || [];
    club.meeting = { type: 'online', link: '', address: '', date: '', ...(club.meeting || {}) };
  });
  cache = db; cacheAt = Date.now();
  return db;
}
async function writeDB(db) {
  cache = db; cacheAt = Date.now();
  if (LOCAL_STORE) {
    try {
      fs.mkdirSync(path.dirname(LOCAL_STORE), { recursive: true });
      fs.writeFileSync(LOCAL_STORE, JSON.stringify(db));
    } catch (e) { }
    return;
  }
  const rc = redisConfig();
  if (rc) { await redisSetState(rc, db); return; }
  if (!TOKEN) return;
  await fetch('https://blob.vercel-storage.com/' + BLOB_PATH, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'x-add-random-suffix': '0',
      'x-allow-overwrite': '1',
      'x-vercel-blob-access': 'private',
    },
    body: JSON.stringify(db),
  });
}

// ---------- helpers ----------
const uid = () => crypto.randomBytes(9).toString('hex');
const nowISO = () => new Date().toISOString();
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPw(pw, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, salt, 32));
}
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const hasField = (obj, field) => Object.prototype.hasOwnProperty.call(obj || {}, field);
function finiteNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  if (typeof value === 'string' && !value.trim()) return NaN;
  return Number(value);
}
function clubIdentity(club) {
  const format = club && club.format === 'in-person' ? 'in-person' : 'online';
  return {
    format,
    location: format === 'in-person' ? (club.location || null) : null,
    genres: club && Array.isArray(club.genres) ? club.genres : [],
    audience: club && typeof club.audience === 'string' ? club.audience : '',
    specialty: club && typeof club.specialty === 'string' ? club.specialty : '',
  };
}
function parseClubLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Location needed for an in-person club' };
  }
  const lat = finiteNumber(value.lat);
  const lng = finiteNumber(value.lng);
  if (typeof value.label !== 'string' || !value.label.trim()) {
    return { error: 'Location label needed' };
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { error: 'Location latitude and longitude must be numeric' };
  }
  return { location: { ...value } };
}
function parseClubGenres(value) {
  if (!Array.isArray(value)) return { error: 'Genres must be a list' };
  const seen = new Set();
  const genres = [];
  for (const item of value) {
    if (typeof item !== 'string') return { error: 'Genres must be text' };
    const genre = item.trim();
    const key = genre.toLowerCase();
    if (!genre || seen.has(key)) continue;
    seen.add(key);
    genres.push(genre);
    if (genres.length === 8) break;
  }
  return { genres };
}
function parseClubIdentity(body, base) {
  const current = base || { format: 'online', location: null, genres: [], audience: '', specialty: '' };
  let format = current.format;
  if (hasField(body, 'format')) {
    if (!['online', 'in-person'].includes(body.format)) {
      return { error: 'Format must be online or in-person' };
    }
    format = body.format;
  }

  let location = format === 'in-person' ? current.location : null;
  if (format === 'in-person' && hasField(body, 'location')) {
    const parsed = parseClubLocation(body.location);
    if (parsed.error) return parsed;
    location = parsed.location;
  }
  if (format === 'in-person' && !location) {
    return { error: 'Location needed for an in-person club' };
  }

  let genres = current.genres;
  if (hasField(body, 'genres')) {
    const parsed = parseClubGenres(body.genres);
    if (parsed.error) return parsed;
    genres = parsed.genres;
  }

  let audience = current.audience;
  if (hasField(body, 'audience')) {
    if (typeof body.audience !== 'string') return { error: 'Audience must be text' };
    audience = body.audience.trim();
  }

  let specialty = current.specialty;
  if (hasField(body, 'specialty')) {
    if (typeof body.specialty !== 'string') return { error: 'Specialty must be text' };
    specialty = body.specialty.trim();
  }

  return { identity: { format, location, genres, audience, specialty } };
}
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function bookKey(isbn, title, author) {
  const clean = (isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (clean.length >= 10) return 'isbn:' + clean;
  return 'ta:' + norm(title) + '|' + norm(author);
}
function ensureAdmin(db, club) {
  if (club.members.length && !club.members.some((m) => m.role === 'admin')) {
    const first = [...club.members].sort((a, b) => a.joinedAt < b.joinedAt ? -1 : 1)[0];
    first.role = 'admin';
  }
}
function capClose(club, iso) {
  let t = new Date(iso).getTime();
  if (club.meeting && club.meeting.date) {
    const md = new Date(club.meeting.date + 'T23:59:59').getTime();
    if (!isNaN(md) && md > Date.now()) t = Math.min(t, md);
  }
  return new Date(t).toISOString();
}
function defaultClose(club) {
  const weekCap = Date.now() + 7 * 864e5;
  if (club.meeting && club.meeting.date) {
    const d = new Date(club.meeting.date + 'T12:00:00');
    if (!isNaN(d.getTime())) {
      d.setDate(d.getDate() - 1);
      const t = new Date(d.toISOString().slice(0, 10) + 'T23:59:59').getTime();
      return new Date(Math.min(t, weekCap)).toISOString();
    }
  }
  return new Date(weekCap).toISOString();
}
function settlePoll(db, club) {
  const p = club.poll;
  if (!p) return;
  const counts = {}; p.options.forEach((k) => (counts[k] = 0));
  Object.values(p.votes).forEach((k) => { if (counts[k] !== undefined) counts[k]++; });
  const max = Math.max(...Object.values(counts));
  const top = Object.keys(counts).filter((k) => counts[k] === max);
  if (top.length === 1 && max > 0) {
    club.current = top[0];
    club.lastResult = { winner: top[0], tie: null, at: nowISO() };
    club.poll = null;
    club.pendingTie = null;
    club.cycleEnd = new Date(Date.now() + (club.meetingFrequencyWeeks * 7 + 7) * 864e5).toISOString();
  } else {
    club.lastResult = { winner: null, tie: top, at: nowISO() };
    club.poll = null; club.pendingTie = top;
  }
}
function expirePolls(db) {
  let dirty = false;
  (db.clubs || []).forEach((club) => {
    if (club.poll && club.poll.closesAt && Date.now() > new Date(club.poll.closesAt).getTime()) {
      settlePoll(db, club);
      dirty = true;
    }
  });
  return dirty;
}
function maybeAutoPoll(db, club) {
  if (!club.autoPoll || club.poll || !club.cycleEnd || club.library.length < 2) return;
  const opens = new Date(club.cycleEnd).getTime() - 7 * 864e5;
  if (Date.now() >= opens) {
    club.poll = {
      id: uid(), options: [...club.library], votes: {}, runoff: false,
      closesAt: defaultClose(club), createdAt: nowISO(), auto: true,
    };
  }
}
function publicClub(db, club, userId) {
  ensureAdmin(db, club);
  const identity = clubIdentity(club);
  const me = club.members.find((m) => m.userId === userId);
  return {
    id: club.id, name: club.name, private: club.private,
    format: identity.format, location: identity.location, genres: identity.genres,
    audience: identity.audience, specialty: identity.specialty,
    memberCount: club.members.length, isMember: !!me, role: me ? me.role : null,
    members: club.members.map((m) => {
      const u = db.users.find((x) => x.id === m.userId);
      return { userId: m.userId, name: u ? u.name : '', role: m.role, joinedAt: m.joinedAt };
    }),
    library: club.library.map((k) => bookView(db, k, userId)),
    current: club.current ? bookView(db, club.current, userId) : null,
    currentRatings: club.current ? memberRatings(db, club, club.current) : [],
    meetingFrequencyWeeks: club.meetingFrequencyWeeks, cycleEnd: club.cycleEnd,
    autoPoll: club.autoPoll, meeting: club.meeting,
    week: meetingWeek(club),
    availability: club.availability,
    finishedBy: club.current ? club.members.filter((m) => ((club.finished || {})[m.userId] || []).includes(club.current)).map((m) => m.userId) : [],
    myFinished: club.current ? ((club.finished || {})[userId] || []).includes(club.current) : false,
    progress: club.current ? club.members.map((m) => {
      const p = (db.progress || {})[m.userId + '|' + club.id + '|' + club.current];
      return p ? { userId: m.userId, percent: p.percent, page: p.page, totalPages: p.totalPages, updatedAt: p.updatedAt } : null;
    }).filter(Boolean) : [],
    rsvps: club.rsvps || {},
    poll: club.poll ? pollView(db, club) : null,
    lastResult: club.lastResult || null,
  };
}
function meetingWeek(club) {
  if (!club.cycleEnd) return [];
  const end = new Date(club.cycleEnd);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 864e5);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
function memberRatings(db, club, key) {
  return club.members.map((m) => {
    const u = db.users.find((x) => x.id === m.userId);
    const r = db.ratings[m.userId + '|' + key];
    return { userId: m.userId, name: u ? u.name : '', rating: r === undefined ? null : r };
  });
}
function bookView(db, key, userId) {
  const b = db.books[key];
  if (!b) return null;
  const mine = db.ratings[userId + '|' + key];
  const all = Object.keys(db.ratings).filter((k) => k.endsWith('|' + key)).map((k) => db.ratings[k]);
  return {
    key, isbn: b.isbn, title: b.title, author: b.author, cover: b.cover, year: b.year, pageCount: b.pageCount || null,
    google: b.google || null, hardcover: b.hardcover || null, openlibrary: b.openlibrary || null,
    myRating: mine === undefined ? null : mine,
    memberAverage: all.length ? Math.round((all.reduce((a, c) => a + c, 0) / all.length) * 10) / 10 : null,
    memberCount: all.length,
  };
}
function pollView(db, club) {
  const p = club.poll;
  const counts = {};
  p.options.forEach((k) => (counts[k] = 0));
  Object.values(p.votes).forEach((k) => { if (counts[k] !== undefined) counts[k]++; });
  return {
    id: p.id, runoff: p.runoff, closesAt: p.closesAt, auto: !!p.auto,
    options: p.options.map((k) => ({ book: bookView(db, k, null), votes: counts[k] })),
    totalVotes: Object.keys(p.votes).length,
  };
}

// ---------- external book data ----------
async function hardcover(isbn) {
  const t = process.env.HARDCOVER_TOKEN;
  if (!t || !isbn) return null;
  try {
    const r = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
      body: JSON.stringify({ query: `query{ books(where:{isbns:{_contains:["${isbn}"]}}, limit:1){ rating ratings_count } }` }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const b = j.data && j.data.books && j.data.books[0];
    return b && b.rating ? { rating: Math.round(b.rating * 100) / 100, count: b.ratings_count || 0 } : null;
  } catch (e) { return null; }
}
function googleBook(v) {
  const info = v.volumeInfo || {};
  const ids = info.industryIdentifiers || [];
  const isbn = (ids.find((i) => i.type === 'ISBN_13') || ids.find((i) => i.type === 'ISBN_10') || {}).identifier || '';
  return {
    isbn, title: info.title || '', author: (info.authors || []).join(', '),
    cover: info.imageLinks ? (info.imageLinks.thumbnail || '').replace('http:', 'https:') : '',
    year: (info.publishedDate || '').slice(0, 4),
    pageCount: info.pageCount ? Number(info.pageCount) : null,
    google: info.averageRating ? { rating: info.averageRating, count: info.ratingsCount || 0 } : null,
    hardcover: null, openlibrary: null,
  };
}
function olBook(d) {
  return {
    isbn: (d.isbn && d.isbn[0]) || '',
    title: d.title || '', author: (d.author_name || []).join(', '),
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
    year: d.first_publish_year ? String(d.first_publish_year) : '',
    pageCount: d.number_of_pages || d.number_of_pages_median || null,
    google: null, hardcover: null,
    openlibrary: d.ratings_average ? { rating: Math.round(d.ratings_average * 100) / 100, count: d.ratings_count || 0 } : null,
  };
}
async function searchBooks(q) {
  let out = [];
  try {
    const r = await fetch('https://www.googleapis.com/books/v1/volumes?maxResults=20&q=' + encodeURIComponent(q));
    if (r.ok) { const j = await r.json(); out = (j.items || []).map(googleBook).filter((b) => b.title); }
  } catch (e) { }
  if (out.length < 3) {
    try {
      const r = await fetch('https://openlibrary.org/search.json?limit=20&fields=title,author_name,isbn,cover_i,first_publish_year,ratings_average,ratings_count,number_of_pages,number_of_pages_median&q=' + encodeURIComponent(q));
      if (r.ok) {
        const j = await r.json();
        const seen = new Set(out.map((b) => norm(b.title) + '|' + norm(b.author)));
        for (const d of j.docs || []) {
          const b = olBook(d);
          if (b.title && !seen.has(norm(b.title) + '|' + norm(b.author))) out.push(b);
        }
      }
    } catch (e) { }
  }
  for (const b of out.slice(0, 8)) if (b.isbn && !b.hardcover) b.hardcover = await hardcover(b.isbn);
  return out;
}
function parsePagination(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+)\s*(?:pages?|p\.)/);
  return m ? Number(m[1]) : null;
}
async function olPageCount(isbn) {
  try {
    const r = await fetch('https://openlibrary.org/isbn/' + isbn + '.json');
    if (r.ok) { const j = await r.json(); return j.number_of_pages || parsePagination(j.pagination); }
  } catch (e) { }
  return null;
}
async function lookupISBN(isbn) {
  const clean = isbn.replace(/[^0-9Xx]/g, '');
  try {
    const r = await fetch('https://www.googleapis.com/books/v1/volumes?q=isbn:' + clean);
    if (r.ok) { const j = await r.json(); if (j.items && j.items[0]) return googleBook(j.items[0]); }
  } catch (e) { }
  try {
    const r = await fetch('https://openlibrary.org/search.json?limit=1&fields=title,author_name,isbn,cover_i,first_publish_year,ratings_average,ratings_count,number_of_pages,number_of_pages_median&q=' + encodeURIComponent('isbn:' + clean));
    if (r.ok) {
      const j = await r.json();
      if (j.docs && j.docs[0]) {
        const b = olBook(j.docs[0]);
        if (!b.pageCount) b.pageCount = await olPageCount(clean);
        return b;
      }
    }
  } catch (e) { }
  return null;
}
async function resolveLink(url) {
  const m = url.match(/(97[89][0-9-]{9,}[\dXx]|(?<![0-9])[0-9]{9}[\dXx](?![0-9]))/);
  if (m) { const b = await lookupISBN(m[0]); if (b) return b; }
  try {
    const u = new URL(url);
    if (u.hostname.includes('openlibrary.org')) {
      const r = await fetch(url.split('?')[0] + '.json');
      if (r.ok) {
        const j = await r.json();
        const isbn = (j.isbn_13 && j.isbn_13[0]) || (j.isbn_10 && j.isbn_10[0]) || '';
        if (isbn) { const b = await lookupISBN(isbn); if (b) return b; }
        return { isbn, title: j.title || '', author: '', cover: '', year: '', pageCount: j.number_of_pages || parsePagination(j.pagination), google: null, hardcover: null, openlibrary: null };
      }
    }
    if (u.hostname.includes('google')) {
      const id = u.searchParams.get('id') || (u.pathname.match(/\/edition\/(\w+)/) || [])[1];
      if (id) {
        const r = await fetch('https://www.googleapis.com/books/v1/volumes/' + id);
        if (r.ok) return googleBook(await r.json());
      }
    }
  } catch (e) { }
  return null;
}
function storeBook(db, data) {
  const key = bookKey(data.isbn, data.title, data.author);
  if (!db.books[key]) db.books[key] = { key, addedAt: nowISO(), ...data };
  else {
    const b = db.books[key];
    if (data.google && (!b.google || (data.google.count || 0) > (b.google.count || 0))) b.google = data.google;
    if (data.hardcover) b.hardcover = data.hardcover;
    if (data.openlibrary && !b.openlibrary) b.openlibrary = data.openlibrary;
    if (!b.cover && data.cover) b.cover = data.cover;
    if (!b.isbn && data.isbn) b.isbn = data.isbn;
    if (!b.pageCount && data.pageCount) b.pageCount = data.pageCount;
  }
  return key;
}

// ---------- Google sign-in ----------
const GOOGLE_REDIRECT_URI = 'https://booklovers-lemon.vercel.app/api/auth/google';
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function redirectTo(res, loc, cookie) {
  res.statusCode = 302;
  res.setHeader('location', loc);
  if (cookie) res.setHeader('set-cookie', cookie);
  res.end();
}
async function googleAuth(req, res, u) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const code = u.searchParams.get('code');
  if (!code) {
    const state = crypto.randomBytes(16).toString('hex');
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.searchParams.set('client_id', clientId);
    auth.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('scope', 'openid email profile');
    auth.searchParams.set('state', state);
    auth.searchParams.set('access_type', 'online');
    auth.searchParams.set('prompt', 'select_account');
    return redirectTo(res, auth.toString(), `gstate=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  }
  const fail = () => redirectTo(res, '/?auth=failed', 'gstate=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  try {
    const cookies = parseCookies(req);
    const state = u.searchParams.get('state');
    if (!state || !cookies.gstate || state !== cookies.gstate) return fail();
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: GOOGLE_REDIRECT_URI, grant_type: 'authorization_code' }).toString(),
    });
    if (!tr.ok) return fail();
    const tj = await tr.json();
    if (!tj.access_token) return fail();
    const ur = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tj.access_token}` } });
    if (!ur.ok) return fail();
    const profile = await ur.json();
    const email = (profile.email || '').toLowerCase();
    const verified = profile.email_verified === true || profile.email_verified === 'true';
    if (!email || !verified) return fail();
    const db = await readDB();
    let gu = db.users.find((x) => x.email === email);
    if (!gu) {
      gu = { id: uid(), name: profile.name || email.split('@')[0], email, pass: null, createdAt: nowISO() };
      db.users.push(gu);
    }
    const t = uid() + uid();
    db.sessions[t] = gu.id;
    await writeDB(db);
    return redirectTo(res, '/#t=' + t, 'gstate=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  } catch (e) { return fail(); }
}

// ---------- main ----------
module.exports = async (req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    let gu = null;
    try { gu = new URL(req.url, 'https://' + (req.headers.host || 'booklovers-lemon.vercel.app')); } catch (e) { }
    if (gu && (gu.pathname.endsWith('/auth/google') || (gu.searchParams.has('code') && gu.searchParams.has('state')))) {
      return googleAuth(req, res, gu);
    }
  }
  res.setHeader('content-type', 'application/json');
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(await stream(req) || '{}'); } catch (e) { }
  const db = await readDB();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const me = db.users.find((u) => db.sessions[token] === u.id);
  const action = body.action || '';
  const needAuth = !['signup', 'signin'].includes(action);
  if (needAuth && !me) return send(401, { error: 'Sign in first' });
  if (me && expirePolls(db)) await writeDB(db);

  try {
    switch (action) {
      case 'signup': {
        const { name, email, password } = body;
        if (!name || !email || !password) return send(400, { error: 'Name, email and password needed' });
        if (db.users.some((u) => u.email === email.toLowerCase())) return send(400, { error: 'That email already has an account' });
        const u = { id: uid(), name, email: email.toLowerCase(), pass: hashPw(password), createdAt: nowISO() };
        db.users.push(u);
        const t = uid() + uid(); db.sessions[t] = u.id;
        await writeDB(db);
        return send(200, { token: t, user: { id: u.id, name: u.name, email: u.email } });
      }
      case 'signin': {
        const u = db.users.find((x) => x.email === (body.email || '').toLowerCase());
        if (!u || !checkPw(body.password || '', u.pass)) return send(400, { error: 'Email or password is wrong' });
        const t = uid() + uid(); db.sessions[t] = u.id;
        await writeDB(db);
        return send(200, { token: t, user: { id: u.id, name: u.name, email: u.email } });
      }
      case 'signout': { delete db.sessions[token]; await writeDB(db); return send(200, { ok: true }); }
      case 'me': return send(200, { user: { id: me.id, name: me.name, email: me.email } });
      case 'searchClubs': {
        const q = norm(body.q || '');
        if (body.format !== undefined && !['online', 'in-person'].includes(body.format)) {
          return send(400, { error: 'Format must be online or in-person' });
        }
        if (body.genre !== undefined && typeof body.genre !== 'string') {
          return send(400, { error: 'Genre must be text' });
        }
        if (body.audience !== undefined && typeof body.audience !== 'string') {
          return send(400, { error: 'Audience must be text' });
        }
        if (body.specialty !== undefined && typeof body.specialty !== 'string') {
          return send(400, { error: 'Specialty must be text' });
        }
        const genre = body.genre ? body.genre.trim().toLowerCase() : '';
        const audience = norm(body.audience || '');
        const specialty = norm(body.specialty || '');
        let near = null;
        if (body.near !== undefined) {
          if (!body.near || typeof body.near !== 'object' || Array.isArray(body.near)) {
            return send(400, { error: 'Near must include latitude, longitude and radiusKm' });
          }
          near = {
            lat: finiteNumber(body.near.lat),
            lng: finiteNumber(body.near.lng),
            radiusKm: finiteNumber(body.near.radiusKm),
          };
          if (!Number.isFinite(near.lat) || near.lat < -90 || near.lat > 90
            || !Number.isFinite(near.lng) || near.lng < -180 || near.lng > 180
            || !Number.isFinite(near.radiusKm) || near.radiusKm <= 0) {
            return send(400, { error: 'Near must include latitude, longitude and radiusKm' });
          }
        }
        const list = db.clubs.filter((c) => {
          if (c.private) return false;
          if (q && !norm(c.name).includes(q)) return false;
          const identity = clubIdentity(c);
          if (body.format && identity.format !== body.format) return false;
          if (genre && !identity.genres.some((g) => typeof g === 'string' && g.trim().toLowerCase() === genre)) return false;
          if (audience && norm(identity.audience) !== audience) return false;
          if (specialty && !norm(identity.specialty).includes(specialty)) return false;
          if (near) {
            if (identity.format !== 'in-person' || !identity.location) return false;
            const distance = haversineKm(
              near.lat, near.lng,
              finiteNumber(identity.location.lat), finiteNumber(identity.location.lng),
            );
            if (!Number.isFinite(distance) || distance > near.radiusKm) return false;
          }
          return true;
        }).map((c) => publicClub(db, c, me.id));
        return send(200, { clubs: list });
      }
      case 'myClubs': {
        return send(200, { clubs: db.clubs.filter((c) => c.members.some((m) => m.userId === me.id)).map((c) => publicClub(db, c, me.id)) });
      }
      case 'createClub': {
        if (!body.name) return send(400, { error: 'Club name needed' });
        const parsedIdentity = parseClubIdentity(body);
        if (parsedIdentity.error) return send(400, { error: parsedIdentity.error });
        const identity = parsedIdentity.identity;
        const club = {
          id: uid(), name: body.name, private: !!body.private, createdBy: me.id,
          format: identity.format, location: identity.location, genres: identity.genres,
          audience: identity.audience, specialty: identity.specialty,
          members: [{ userId: me.id, role: 'admin', joinedAt: nowISO() }],
          library: [], current: null, meetingFrequencyWeeks: 2,
          cycleEnd: new Date(Date.now() + (2 * 7 + 7) * 864e5).toISOString(),
          autoPoll: false, meeting: { type: 'online', link: '', address: '', date: '' },
          availability: {}, finished: {}, rsvps: {}, poll: null, lastResult: null,
        };
        db.clubs.push(club); await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'joinClub': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club || club.private) return send(404, { error: 'Club not found' });
        if (!club.members.some((m) => m.userId === me.id)) {
          club.members.push({ userId: me.id, role: 'member', joinedAt: nowISO() });
          ensureAdmin(db, club); await writeDB(db);
        }
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'leaveClub': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        club.members = club.members.filter((m) => m.userId !== me.id);
        ensureAdmin(db, club); await writeDB(db);
        return send(200, { ok: true });
      }
      case 'club': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        if (club.private && !club.members.some((m) => m.userId === me.id)) return send(403, { error: 'Private club' });
        maybeAutoPoll(db, club); await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'createInvite': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        if (!body.email) return send(400, { error: 'Email needed' });
        const inv = { id: uid(), clubId: club.id, email: body.email.toLowerCase(), token: uid() + uid(), used: false, createdBy: me.id, createdAt: nowISO() };
        db.invites.push(inv); await writeDB(db);
        return send(200, { inviteToken: inv.token, email: inv.email });
      }
      case 'acceptInvite': {
        const inv = db.invites.find((i) => i.token === body.inviteToken);
        if (!inv) return send(404, { error: 'Invite not found' });
        if (inv.used) return send(400, { error: 'That invite link was already used' });
        if (inv.email !== me.email) return send(403, { error: 'That invite was sent to a different email' });
        const club = db.clubs.find((c) => c.id === inv.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        if (!club.members.some((m) => m.userId === me.id)) club.members.push({ userId: me.id, role: 'member', joinedAt: nowISO() });
        inv.used = true; ensureAdmin(db, club); await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'makeAdmin': case 'makeAllAdmins': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        club.members.forEach((m) => { if (action === 'makeAllAdmins' || m.userId === body.userId) m.role = 'admin'; });
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'searchBooks': {
        if (!body.q) return send(400, { error: 'Type a title or author' });
        return send(200, { results: await searchBooks(body.q) });
      }
      case 'addBooks': {
        const clubIds = body.clubIds || [];
        if (!clubIds.length) return send(400, { error: 'Pick at least one club' });
        const keys = [];
        for (const data of body.books || []) {
          if (data.isbn && !data.hardcover) data.hardcover = await hardcover(data.isbn);
          keys.push(storeBook(db, data));
        }
        for (const cid of clubIds) {
          const club = db.clubs.find((c) => c.id === cid);
          if (!club || !club.members.some((m) => m.userId === me.id)) continue;
          keys.forEach((k) => { if (!club.library.includes(k)) club.library.push(k); });
        }
        await writeDB(db);
        return send(200, { added: keys });
      }
      case 'addByLink': {
        if (!body.url) return send(400, { error: 'Paste a link' });
        const data = await resolveLink(body.url);
        if (!data || !data.title) return send(400, { error: 'Could not read that link. Try search instead.' });
        if (data.isbn && !data.hardcover) data.hardcover = await hardcover(data.isbn);
        const key = storeBook(db, data);
        for (const cid of body.clubIds || []) {
          const club = db.clubs.find((c) => c.id === cid);
          if (!club || !club.members.some((m) => m.userId === me.id)) continue;
          if (!club.library.includes(key)) club.library.push(key);
        }
        await writeDB(db);
        return send(200, { book: bookView(db, key, me.id) });
      }
      case 'rate': {
        const v = Number(body.rating);
        if (!(v >= 0 && v <= 5) || (v * 2) % 1 !== 0) return send(400, { error: 'Rating must be 0 to 5 in half steps' });
        if (!db.books[body.bookKey]) return send(404, { error: 'Book not found' });
        db.ratings[me.id + '|' + body.bookKey] = v;
        await writeDB(db);
        return send(200, { ok: true });
      }
      case 'setCurrent': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        if (!club.library.includes(body.bookKey)) club.library.push(body.bookKey);
        club.current = body.bookKey;
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'clubSettings': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        let identity = null;
        if (['format', 'location', 'genres', 'audience', 'specialty'].some((field) => hasField(body, field))) {
          const parsedIdentity = parseClubIdentity(body, clubIdentity(club));
          if (parsedIdentity.error) return send(400, { error: parsedIdentity.error });
          identity = parsedIdentity.identity;
        }
        if (identity) Object.assign(club, identity);
        if (body.meetingFrequencyWeeks) {
          const w = Math.min(8, Math.max(1, Number(body.meetingFrequencyWeeks)));
          club.meetingFrequencyWeeks = w;
          club.cycleEnd = new Date(Date.now() + (w * 7 + 7) * 864e5).toISOString();
        }
        if (body.autoPoll !== undefined) club.autoPoll = !!body.autoPoll;
        if (body.meeting) club.meeting = { ...club.meeting, ...body.meeting };
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'availability': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club || !club.members.some((m) => m.userId === me.id)) return send(403, { error: 'Members only' });
        club.availability = club.availability || {};
        club.availability[me.id] = body.days || [];
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'pickDate': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        const chosen = new Date(body.date + 'T12:00:00');
        if (chosen.getTime() - Date.now() < 7 * 864e5) return send(400, { error: 'The date has to be picked at least a week before it happens' });
        if (club.meeting.date !== body.date) club.rsvps = {};
        club.meeting.date = body.date;
        club.members.forEach((m) => {
          if (!club.rsvps[m.userId] && ((club.availability || {})[m.userId] || []).includes(body.date)) club.rsvps[m.userId] = 'going';
        });
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'startPoll': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        if (club.library.length < 2) return send(400, { error: 'Add at least two books first' });
        let closesAt = defaultClose(club);
        if (body.endDate && /^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) {
          const t = new Date(body.endDate + 'T23:59:59').getTime();
          if (!isNaN(t) && t > Date.now()) closesAt = new Date(Math.min(t, new Date(closesAt).getTime())).toISOString();
        }
        club.poll = { id: uid(), options: [...club.library], votes: {}, runoff: false, closesAt, createdAt: nowISO(), auto: false };
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'vote': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club || !club.poll) return send(404, { error: 'No poll running' });
        if (!club.members.some((m) => m.userId === me.id)) return send(403, { error: 'Members only' });
        if (!club.poll.options.includes(body.bookKey)) return send(400, { error: 'That book is not in the poll' });
        club.poll.votes[me.id] = body.bookKey;
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'closePoll': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club || !club.poll) return send(404, { error: 'No poll running' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        settlePoll(db, club);
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'runoff': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club || !club.pendingTie) return send(400, { error: 'No tie to run off' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        club.poll = { id: uid(), options: club.pendingTie, votes: {}, runoff: true, closesAt: new Date(Math.min(Date.now() + 864e5, new Date(defaultClose(club)).getTime())).toISOString(), createdAt: nowISO(), auto: false };
        club.pendingTie = null; club.lastResult = null;
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'adminPick': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        club.current = body.bookKey; club.pendingTie = null; club.lastResult = null;
        club.cycleEnd = new Date(Date.now() + (club.meetingFrequencyWeeks * 7 + 7) * 864e5).toISOString();
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'removeAdmin': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        const target = club.members.find((m) => m.userId === body.userId);
        if (target) { target.role = 'member'; ensureAdmin(db, club); }
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'setProgress': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club || !club.members.some((m) => m.userId === me.id)) return send(403, { error: 'Members only' });
        const key = body.bookKey || club.current;
        if (!key) return send(400, { error: 'No book picked yet' });
        const book = db.books[key];
        if (!book) return send(404, { error: 'Book not found' });
        const total = book.pageCount ? Math.max(1, Math.round(Number(book.pageCount))) : null;
        const hasPage = body.page !== undefined && body.page !== null && body.page !== '';
        const hasPercent = body.percent !== undefined && body.percent !== null && body.percent !== '';
        if (!hasPage && !hasPercent) return send(400, { error: 'Give a page or a percent' });
        let page = null, percent = null;
        if (total) {
          if (hasPage) {
            page = Math.round(Number(body.page));
            if (isNaN(page)) return send(400, { error: 'Page must be a number' });
            page = Math.min(total, Math.max(0, page));
            percent = Math.round((page / total) * 100);
          } else {
            percent = Math.round(Number(body.percent));
            if (isNaN(percent)) return send(400, { error: 'Percent must be a number' });
            percent = Math.min(100, Math.max(0, percent));
            page = Math.round((percent / 100) * total);
          }
        } else {
          if (!hasPercent) return send(400, { error: 'This book has no page count yet, so set progress as a percent' });
          percent = Math.round(Number(body.percent));
          if (isNaN(percent)) return send(400, { error: 'Percent must be a number' });
          percent = Math.min(100, Math.max(0, percent));
          page = null;
        }
        db.progress = db.progress || {};
        const entry = { percent, page, totalPages: total, updatedAt: nowISO() };
        db.progress[me.id + '|' + club.id + '|' + key] = entry;
        club.finished = club.finished || {};
        const arr = new Set(club.finished[me.id] || []);
        if (percent >= 100) arr.add(key); else arr.delete(key);
        club.finished[me.id] = [...arr];
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id), progress: { bookKey: key, ...entry } });
      }
      case 'toggleFinished': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club || !club.members.some((m) => m.userId === me.id)) return send(403, { error: 'Members only' });
        const key = body.bookKey || club.current;
        if (!key) return send(400, { error: 'No book picked yet' });
        club.finished = club.finished || {};
        const arr = new Set(club.finished[me.id] || []);
        if (arr.has(key)) arr.delete(key); else arr.add(key);
        club.finished[me.id] = [...arr];
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'rsvp': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club || !club.members.some((m) => m.userId === me.id)) return send(403, { error: 'Members only' });
        club.rsvps = club.rsvps || {};
        if (body.status === 'going' || body.status === 'maybe' || body.status === 'notgoing') club.rsvps[me.id] = body.status;
        else delete club.rsvps[me.id];
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'deleteClub': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        db.clubs = db.clubs.filter((c) => c.id !== club.id);
        db.invites = db.invites.filter((i) => i.clubId !== club.id);
        await writeDB(db);
        return send(200, { ok: true });
      }
      case 'deleteAccount': {
        for (const club of db.clubs) {
          club.members = club.members.filter((m) => m.userId !== me.id);
          if (club.availability) delete club.availability[me.id];
          if (club.rsvps) delete club.rsvps[me.id];
          if (club.finished) delete club.finished[me.id];
          if (club.poll) delete club.poll.votes[me.id];
          ensureAdmin(db, club);
        }
        db.clubs = db.clubs.filter((c) => c.members.length > 0);
        Object.keys(db.ratings).forEach((k) => { if (k.startsWith(me.id + '|')) delete db.ratings[k]; });
        Object.keys(db.progress || {}).forEach((k) => { if (k.startsWith(me.id + '|')) delete db.progress[k]; });
        Object.keys(db.sessions).forEach((t) => { if (db.sessions[t] === me.id) delete db.sessions[t]; });
        db.invites = db.invites.filter((i) => i.email !== me.email && i.createdBy !== me.id);
        db.users = db.users.filter((u) => u.id !== me.id);
        await writeDB(db);
        return send(200, { ok: true });
      }
      default: return send(400, { error: 'Unknown action' });
    }
  } catch (e) {
    return send(500, { error: 'Something went wrong: ' + e.message });
  }
};
function stream(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d)); req.on('error', () => resolve(''));
  });
}
