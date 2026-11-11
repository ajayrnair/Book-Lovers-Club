// Book Lovers Club — single-file API.
// Storage priority: (1) BLC_LOCAL_STORE local JSON file (test seam),
// (2) Upstash Redis via its REST API when its env vars are present — state is
// split into one key per top-level collection (rp:col:<name>) marked by an
// rp:meta key; the legacy single-document key rp:state is migrated on first
// read and then left untouched as a backup — (3) the private Vercel Blob
// store (whole document). Actions always work on one assembled state object
// via readDB/writeDB; only this persistence layer knows how it is stored.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BLOB_PATH = 'state/db.json';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const LOCAL_STORE = process.env.BLC_LOCAL_STORE || '';
const REDIS_KEY = 'rp:state';            // legacy single-document key; never written by the split layout
const REDIS_COL_PREFIX = 'rp:col:';      // rp:col:<collection> — one key per top-level collection
const REDIS_META_KEY = 'rp:meta';
const SPLIT_MARKER = 'split1';

// The whole top-level state shape: [name, empty value]. The default state is
// built from this list, and the Redis split stores exactly one key per entry.
const COLLECTIONS = [
  ['users', []],
  ['sessions', {}],
  ['books', {}],
  ['clubs', []],
  ['invites', []],
  ['ratings', {}],
  ['progress', {}],
  ['notifications', []],
  ['events', []],
];
const COLLECTION_NAMES = COLLECTIONS.map(([n]) => n);
function emptyCollection(name) {
  const found = COLLECTIONS.find(([n]) => n === name);
  return JSON.parse(JSON.stringify(found ? found[1] : {}));
}
function defaultDB() {
  const db = {};
  for (const name of COLLECTION_NAMES) db[name] = emptyCollection(name);
  return db;
}
// Fill any missing collection with its empty value and repair club subfields,
// exactly as the assembled state has always been normalized after a read.
function normalizeDB(db) {
  for (const name of COLLECTION_NAMES) {
    if (db[name] === undefined || db[name] === null) db[name] = emptyCollection(name);
  }
  db.progress = db.progress || {};
  (db.clubs || []).forEach((club) => {
    club.finished = club.finished || {};
    club.rsvps = club.rsvps || {};
    club.availability = club.availability || {};
    club.library = club.library || [];
    club.questions = club.questions || {};
    club.privateQuestions = club.privateQuestions || {};
    club.discussionTemplate = club.discussionTemplate || [];
    club.reactions = club.reactions || [];
    club.meeting = { type: 'online', link: '', address: '', date: '', ...(club.meeting || {}) };
  });
  const userIds = new Set((db.users || []).map((u) => u.id));
  db.notifications = (db.notifications || []).filter((n) => userIds.has(n.userId));
  db.notifications.forEach((n) => {
    if (!n.dedupeKey) n.dedupeKey = 'legacy:' + n.id;
    if (n.readVia === undefined) n.readVia = null;
    if (!n.channels) {
      n.channels = {
        inbox: { status: 'delivered', at: n.createdAt },
        email: { status: 'unknown' },
        push: { status: 'unavailable' },
      };
    }
  });
  return db;
}

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
// One HTTP round trip per load/save regardless of collection count: commands
// are sent through the Upstash pipeline endpoint as [verb, key, value?].
async function redisPipeline(rc, commands) {
  const r = await fetch(rc.url + '/pipeline', {
    method: 'POST',
    headers: { authorization: `Bearer ${rc.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('Redis request failed: HTTP ' + r.status);
  const j = await r.json();
  if (!Array.isArray(j) || j.length !== commands.length) throw new Error('Redis pipeline reply malformed');
  for (const item of j) if (item && item.error) throw new Error('Redis command failed: ' + item.error);
  return j.map((item) => (item ? item.result : null));
}
function parseCollection(raw, name) {
  if (raw === null || raw === undefined) return emptyCollection(name);
  const v = JSON.parse(raw);
  return v === null || v === undefined ? emptyCollection(name) : v;
}

// Redis split-layout state for this instance: whether the rp:meta marker has
// been confirmed, and the per-collection JSON this instance last read or
// wrote (the baseline that makes write-back dirty-only).
let redisSplitKnown = false;
let savedJson = null;
function snapshot(db) {
  savedJson = {};
  for (const name of COLLECTION_NAMES) savedJson[name] = JSON.stringify(db[name]);
}

async function redisLoad(rc) {
  if (redisSplitKnown) {
    const results = await redisPipeline(rc, COLLECTION_NAMES.map((n) => ['GET', REDIS_COL_PREFIX + n]));
    const db = {};
    COLLECTION_NAMES.forEach((n, i) => { db[n] = parseCollection(results[i], n); });
    return db;
  }
  // Split not yet confirmed on this instance: probe the marker, the legacy
  // document and every collection key in a single pipeline.
  const probes = [['GET', REDIS_META_KEY], ['GET', REDIS_KEY],
    ...COLLECTION_NAMES.map((n) => ['GET', REDIS_COL_PREFIX + n])];
  const results = await redisPipeline(rc, probes);
  if (results[0] === SPLIT_MARKER) {
    redisSplitKnown = true;
    const db = {};
    COLLECTION_NAMES.forEach((n, i) => { db[n] = parseCollection(results[i + 2], n); });
    return db;
  }
  const legacyRaw = results[1];
  if (legacyRaw !== null && legacyRaw !== undefined) {
    // Migration: split the legacy document into collection keys. rp:state is
    // never written or deleted — it stays as the pre-split backup. The marker
    // is written LAST, so a crash mid-migration leaves the marker absent and
    // the next read simply re-runs the same split of the same document
    // (idempotent; two instances doing it write identical data).
    const legacy = JSON.parse(legacyRaw);
    const db = {};
    for (const n of COLLECTION_NAMES) {
      db[n] = legacy[n] === undefined || legacy[n] === null ? emptyCollection(n) : legacy[n];
    }
    const cmds = COLLECTION_NAMES.map((n) => ['SET', REDIS_COL_PREFIX + n, JSON.stringify(db[n])]);
    cmds.push(['SET', REDIS_META_KEY, SPLIT_MARKER]);
    await redisPipeline(rc, cmds);
    redisSplitKnown = true;
    return db;
  }
  // Fresh store: no marker, no legacy document. Serve whatever the collection
  // keys hold (normally nothing yet) WITHOUT marking the split known, so a
  // legacy document appearing later (e.g. an older instance still draining
  // during a deploy) would still be migrated instead of shadowed.
  const db = {};
  COLLECTION_NAMES.forEach((n, i) => { db[n] = parseCollection(results[i + 2], n); });
  return db;
}

async function redisSave(rc, db) {
  // Dirty-only write-back: a collection is SET only when its JSON differs
  // from what this instance last read or wrote. A save from an instance
  // holding a stale assembled state therefore cannot clobber collections it
  // never touched — the pre-split whole-document write could and did.
  const cmds = [];
  for (const n of COLLECTION_NAMES) {
    const s = JSON.stringify(db[n]);
    if (!savedJson || savedJson[n] !== s) cmds.push(['SET', REDIS_COL_PREFIX + n, s]);
  }
  if (!redisSplitKnown) cmds.push(['SET', REDIS_META_KEY, SPLIT_MARKER]); // marker last
  if (cmds.length) await redisPipeline(rc, cmds);
  redisSplitKnown = true;
  snapshot(db);
}

// ---------- persistence ----------
// Backend adapters behind readDB/writeDB. Selection is unchanged: local file
// seam first, then Redis, then Blob. Only the Redis adapter uses the
// per-collection layout; the file seam and the Blob fallback keep their
// whole-document behavior.
function fileLoad() {
  try { return JSON.parse(fs.readFileSync(LOCAL_STORE, 'utf8')); } catch (e) { return null; }
}
function fileSave(db) {
  try {
    fs.mkdirSync(path.dirname(LOCAL_STORE), { recursive: true });
    fs.writeFileSync(LOCAL_STORE, JSON.stringify(db));
  } catch (e) { }
}
async function blobLoad() {
  try {
    const list = await fetch('https://blob.vercel-storage.com/?prefix=state/', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (list.ok) {
      const j = await list.json();
      const b = (j.blobs || []).find((x) => x.pathname === BLOB_PATH);
      if (b) {
        const r = await fetch(b.downloadUrl || b.url, { headers: { authorization: `Bearer ${TOKEN}` } });
        if (r.ok) return await r.json();
      }
    }
  } catch (e) { /* fall through to fresh db */ }
  return null;
}
async function blobSave(db) {
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

let cache = null, cacheAt = 0;
async function readDB() {
  if (cache && Date.now() - cacheAt < 3000) return cache;
  let db = null;
  const rc = LOCAL_STORE ? null : redisConfig();
  if (LOCAL_STORE) db = fileLoad();
  else if (rc) db = await redisLoad(rc);
  else if (TOKEN) db = await blobLoad();
  if (!db) db = defaultDB();
  normalizeDB(db);
  if (rc) snapshot(db); // dirty-detection baseline for the Redis write-back
  cache = db; cacheAt = Date.now();
  return db;
}
async function writeDB(db) {
  cache = db; cacheAt = Date.now();
  if (LOCAL_STORE) { fileSave(db); return; }
  const rc = redisConfig();
  if (rc) { await redisSave(rc, db); return; }
  if (!TOKEN) return;
  await blobSave(db);
}

// ---------- helpers ----------
const uid = () => crypto.randomBytes(9).toString('hex');
const nowISO = () => new Date().toISOString();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// Sends one club-invite email via Resend. Only called when RESEND_API_KEY is
// configured; returns {sent} or {sent:false, error} — a failed send never
// throws, so it can never fail the createInvite request itself.
async function sendInviteEmail(apiKey, { to, inviterLabel, clubName, link }) {
  const base = process.env.RESEND_API_BASE || 'https://api.resend.com';
  const subject = `You're invited to join ${clubName} on Reading Peeps`;
  const text = [
    `${inviterLabel} invited you to join ${clubName} on Reading Peeps.`,
    '',
    `Join the club here: ${link}`,
    '',
    'This link works once, and only for the email address it was sent to.',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#fff9f1;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3a1b2e">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #f0e2d4">
    <p style="margin:0 0 12px;font-size:18px"><strong>${escHtml(inviterLabel)}</strong> invited you to join <strong>${escHtml(clubName)}</strong> on Reading Peeps.</p>
    <p style="margin:20px 0"><a href="${escHtml(link)}" style="display:inline-block;background:#c93a54;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Join the club</a></p>
    <p style="margin:0 0 8px;font-size:14px">Or open this link: <a href="${escHtml(link)}" style="color:#c93a54">${escHtml(link)}</a></p>
    <p style="margin:0;font-size:13px;color:#8a6d7d">This link works once, and only for the email address it was sent to.</p>
  </div>
</body></html>`;
  try {
    const r = await fetch(base + '/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'Reading Peeps <invites@readingpeeps.com>', to: [to], subject, text, html }),
    });
    if (r.ok) return { sent: true };
    let msg = 'Email service returned ' + r.status;
    try { const j = await r.json(); if (j && (j.message || j.error)) msg = String(j.message || j.error); } catch (e) { }
    return { sent: false, error: msg };
  } catch (e) {
    return { sent: false, error: 'Email send failed: ' + (e && e.message ? e.message : 'network error') };
  }
}
// ---------------------------------------------------------------------------
// Notifications, in two layers. Generation (emitNotifications) turns an
// event into per-user delivery records; delivery (deliverNotifications)
// attempts each channel and records the outcome on the record itself.
// Events: a poll opens (start, runoff, auto), a poll settles (winner or
// tie), a meeting date is picked, meeting details change, and a day-before
// meeting reminder swept on any signed-in request. The member who caused
// the event is never notified about it.
// ---------------------------------------------------------------------------
const APP_URL = 'https://www.readingpeeps.com/';
function prettyDay(dateStr) {
  const d = new Date(String(dateStr) + 'T12:00:00Z');
  if (isNaN(d.getTime())) return String(dateStr || '');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
function prettyDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}
function fmtTime(t) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t || ''));
  if (!m) return '';
  let h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + m[2] + ' ' + suffix;
}
function bookTitleOf(db, key) {
  const b = (db.books || {})[key];
  return b && b.title ? b.title : 'A book';
}
async function sendNoticeEmail(apiKey, { to, subject, text }) {
  const base = process.env.RESEND_API_BASE || 'https://api.resend.com';
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#fff9f1;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3a1b2e">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #f0e2d4">
    <p style="margin:0 0 12px;font-size:18px"><strong>${escHtml(subject)}</strong></p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escHtml(text)}</p>
    <p style="margin:20px 0 4px"><a href="${APP_URL}" style="display:inline-block;background:#c93a54;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Open Reading Peeps</a></p>
  </div>
</body></html>`;
  try {
    const r = await fetch(base + '/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'Reading Peeps <notifications@readingpeeps.com>', to: [to], subject, text: text + '\n\nOpen Reading Peeps: ' + APP_URL, html }),
    });
    if (!r.ok) return { sent: false, error: 'Email provider returned ' + r.status };
    let providerId = '';
    try { const j = await r.json(); providerId = j && j.id ? String(j.id) : ''; } catch (e) { }
    return { sent: true, providerId };
  } catch (e) {
    return { sent: false, error: 'Email send failed: ' + (e && e.message ? e.message : 'network error') };
  }
}
// ---------------------------------------------------------------------------
// Notification generation layer. emitNotifications turns an event into at
// most one delivery record per member, actor excluded. Every record carries
// a dedupeKey identifying the event instance, so re-emitting the same event
// (an autosave re-save, a sweep re-entry, a retried request) never creates
// a second copy for the same user.
// ---------------------------------------------------------------------------
function emitNotifications(db, club, { exceptUserId = null, type, title, body, dedupeKey }) {
  const created = [];
  (club.members || []).forEach((m) => {
    if (m.userId === exceptUserId) return;
    if (dedupeKey && db.notifications.some((n) => n.userId === m.userId && n.dedupeKey === dedupeKey)) return;
    const rec = {
      id: uid(), userId: m.userId, clubId: club.id, type, title, body,
      createdAt: nowISO(), readAt: 0, readVia: null,
      dedupeKey: dedupeKey || ('evt:' + uid()),
      channels: {
        inbox: { status: 'delivered', at: nowISO() },
        email: { status: 'pending' },
        push: { status: 'unavailable' },
      },
    };
    db.notifications.push(rec);
    created.push(rec);
  });
  return created;
}
// ---------------------------------------------------------------------------
// Notification delivery layer. Attempts each channel for freshly generated
// records and writes the outcome back onto the record's channels map, so
// delivery and seen status are tracked per user per notification. The inbox
// channel is the record itself: the web bell and the app inbox read the same
// record, so a notification read anywhere is read everywhere. Email goes
// through Resend and records the provider's message id. Push stays
// 'unavailable' until an APNs key exists; this is the one place it plugs in.
// ---------------------------------------------------------------------------
async function deliverNotifications(db, records) {
  if (!records.length) return records;
  const apiKey = process.env.RESEND_API_KEY || '';
  const byId = {};
  (db.users || []).forEach((u) => { byId[u.id] = u; });
  await Promise.allSettled(records.map(async (rec) => {
    const ch = rec.channels.email;
    if (!apiKey) { ch.status = 'skipped'; ch.error = 'email_not_configured'; ch.at = nowISO(); return; }
    const u = byId[rec.userId];
    if (!u || !u.email) { ch.status = 'skipped'; ch.error = 'no_email_address'; ch.at = nowISO(); return; }
    const r = await sendNoticeEmail(apiKey, { to: u.email, subject: rec.title, text: rec.body });
    ch.status = r.sent ? 'sent' : 'failed';
    ch.at = nowISO();
    if (r.providerId) ch.providerId = r.providerId;
    if (r.error) ch.error = r.error;
  }));
  return records;
}
// Generate, then deliver. Every event call site goes through here.
async function notifyMembers(db, club, opts) {
  const records = emitNotifications(db, club, opts);
  await deliverNotifications(db, records);
  return records;
}
async function notifyPollResult(db, club, result, exceptUserId) {
  if (!result) return;
  if (result.winner) {
    await notifyMembers(db, club, {
      exceptUserId, type: 'poll_result', dedupeKey: 'poll-result:' + club.id + ':' + (result.at || ''),
      title: 'Next book for ' + club.name,
      body: bookTitleOf(db, result.winner) + ' won the vote and is the club\u2019s next book.',
    });
  } else if (result.tie) {
    await notifyMembers(db, club, {
      exceptUserId, type: 'poll', dedupeKey: 'poll-result:' + club.id + ':' + (result.at || ''),
      title: 'The vote tied in ' + club.name,
      body: 'No book won outright. The admin can run a runoff or pick the next book.',
    });
  }
}
// Day-before meeting reminders. Meeting times are wall clock with no stored
// timezone, so the sweep treats them as UTC and fires when the start is
// within the next 24 hours; reminderFor stamps the date+time so it fires
// exactly once per scheduled meeting. Returns created records for emailing.
function sweepMeetingReminders(db) {
  const created = [];
  const now = Date.now();
  (db.clubs || []).forEach((club) => {
    const mtg = club.meeting || {};
    if (!mtg.date) return;
    const key = mtg.date + 'T' + (mtg.time || '');
    if (mtg.reminderFor === key) return;
    const start = new Date(mtg.date + 'T' + (mtg.time || '18:00') + ':00Z').getTime();
    if (isNaN(start) || start <= now || start - now > 24 * 3600e3) return;
    mtg.reminderFor = key;
    created.push(...emitNotifications(db, club, {
      type: 'meeting_reminder', dedupeKey: 'reminder:' + club.id + ':' + key,
      title: 'Meeting coming up in ' + club.name,
      body: 'Your club meets on ' + prettyDay(mtg.date) + (mtg.time ? ' at ' + fmtTime(mtg.time) : '') + '. See you there.',
    }));
  });
  return created;
}
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
// Reactions: a fixed small palette, one tap to add, same tap again to remove.
// Targets are a member's finish of a book, a member's rating of a book, or a
// poll result. Nobody reacts to their own finish or rating; a poll result
// belongs to the whole club, so anyone may react to it.
const REACTION_EMOJIS = ['❤️', '👏', '🔥', '😮', '😂', '🎉'];
function reactionChips(db, club, userId, pred) {
  const byEmoji = new Map();
  (club.reactions || []).filter(pred).forEach((r) => {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
    byEmoji.get(r.emoji).push(r);
  });
  return REACTION_EMOJIS.filter((e) => byEmoji.has(e)).map((emoji) => {
    const list = byEmoji.get(emoji);
    return {
      emoji, count: list.length, mine: list.some((r) => r.userId === userId),
      names: list.map((r) => { const u = db.users.find((x) => x.id === r.userId); return u ? u.name : ''; }),
    };
  });
}
// Discussion questions for the current book: the group list starts as a copy
// of the admin's template the first time a book becomes current, and members
// add more from there. Private questions live per user inside the club record
// and are only ever exposed to their owner (see publicClub).
function seedDiscussion(club) {
  if (!club.current) return;
  club.questions = club.questions || {};
  if (!club.questions[club.current]) {
    club.questions[club.current] = (club.discussionTemplate || []).map((text) => ({ id: uid(), text, byUserId: null, createdAt: nowISO() }));
  }
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
    seedDiscussion(club);
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
  const outcomes = [];
  (db.clubs || []).forEach((club) => {
    if (club.poll && club.poll.closesAt && Date.now() > new Date(club.poll.closesAt).getTime()) {
      settlePoll(db, club);
      if (club.lastResult) outcomes.push({ club, result: club.lastResult });
    }
  });
  return outcomes;
}
// Books a poll may run on: in the library, not the current book, and not
// finished by any member (the "To read" set).
function pollCandidates(club) {
  const finished = club.finished || {};
  return (club.library || []).filter((k) => k !== club.current
    && !club.members.some((m) => (finished[m.userId] || []).includes(k)));
}
function maybeAutoPoll(db, club) {
  if (!club.autoPoll || club.poll || !club.cycleEnd || pollCandidates(club).length < 2) return;
  const opens = new Date(club.cycleEnd).getTime() - 7 * 864e5;
  if (Date.now() >= opens) {
    club.poll = {
      id: uid(), options: pollCandidates(club), votes: {}, runoff: false,
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
    library: club.library.map((k) => {
      const v = bookView(db, k, userId);
      if (!v) return v;
      v.finishedBy = club.members.filter((m) => ((club.finished || {})[m.userId] || []).includes(k)).map((m) => m.userId);
      return v;
    }),
    current: club.current ? bookView(db, club.current, userId) : null,
    currentRatings: club.current ? memberRatings(db, club, club.current).map((r) => ({
      ...r,
      reactions: r.rating === null || r.rating === undefined ? [] : reactionChips(db, club, userId, (x) => x.type === 'rating' && x.bookKey === club.current && x.subjectUserId === r.userId),
    })) : [],
    meetingFrequencyWeeks: club.meetingFrequencyWeeks, cycleEnd: club.cycleEnd,
    autoPoll: club.autoPoll, meeting: club.meeting,
    week: meetingWeek(club),
    availability: club.availability,
    finishedBy: club.current ? club.members.filter((m) => ((club.finished || {})[m.userId] || []).includes(club.current)).map((m) => m.userId) : [],
    myFinished: club.current ? ((club.finished || {})[userId] || []).includes(club.current) : false,
    progress: club.current ? club.members.map((m) => {
      const p = (db.progress || {})[m.userId + '|' + club.id + '|' + club.current];
      return p ? { userId: m.userId, percent: p.percent, page: p.page, totalPages: p.totalPages, updatedAt: p.updatedAt, reactions: p.percent === 100 ? reactionChips(db, club, userId, (x) => x.type === 'finish' && x.bookKey === club.current && x.subjectUserId === m.userId) : [] } : null;
    }).filter(Boolean) : [],
    rsvps: club.rsvps || {},
    poll: club.poll ? pollView(db, club, userId) : null,
    lastResult: club.lastResult || null,
    pollReactions: club.lastResult && club.lastResult.winner ? reactionChips(db, club, userId, (x) => x.type === 'poll' && x.at === club.lastResult.at) : [],
    discussion: {
      template: club.discussionTemplate || [],
      group: club.current ? ((club.questions || {})[club.current] || []).map((q) => {
        const u = q.byUserId ? db.users.find((x) => x.id === q.byUserId) : null;
        return { id: q.id, text: q.text, byUserId: q.byUserId || null, byName: u ? u.name : '', mine: q.byUserId === userId };
      }) : [],
      mine: club.current ? (((club.privateQuestions || {})[userId] || {})[club.current] || []).map((q) => ({ id: q.id, text: q.text })) : [],
    },
  };
}
function meetingWeek(club) {
  // The meeting week is the Monday-Sunday week containing cycleEnd.
  if (!club.cycleEnd) return [];
  const end = new Date(club.cycleEnd);
  if (isNaN(end.getTime())) return [];
  const day = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const back = (new Date(day).getUTCDay() + 6) % 7; // days since Monday
  const monday = day - back * 864e5;
  const days = [];
  for (let i = 0; i < 7; i++) days.push(new Date(monday + i * 864e5).toISOString().slice(0, 10));
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
function pollView(db, club, userId) {
  const p = club.poll;
  const counts = {};
  p.options.forEach((k) => (counts[k] = 0));
  Object.values(p.votes).forEach((k) => { if (counts[k] !== undefined) counts[k]++; });
  return {
    id: p.id, runoff: p.runoff, closesAt: p.closesAt, auto: !!p.auto,
    options: p.options.map((k) => ({ book: bookView(db, k, null), votes: counts[k] })),
    totalVotes: Object.keys(p.votes).length,
    myVote: userId ? (p.votes[userId] || null) : null,
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
function googleRedirectUri(req) {
  const host = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'www.readingpeeps.com';
  return 'https://' + host + '/api/auth/google';
}
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
    auth.searchParams.set('redirect_uri', googleRedirectUri(req));
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('scope', 'openid email profile');
    auth.searchParams.set('state', state);
    auth.searchParams.set('access_type', 'online');
    auth.searchParams.set('prompt', 'select_account');
    // Native app sign-in (?native=1): a parallel cookie carries the flag through
    // the Google round-trip (state keeps its CSRF purpose, untouched), so the
    // callback can return to the app's booklovers:// deep link instead of the web.
    const startCookies = [`gstate=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`];
    if (u.searchParams.get('native') === '1') startCookies.push('gnative=1; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600');
    return redirectTo(res, auth.toString(), startCookies);
  }
  const cookies = parseCookies(req);
  const isNative = cookies.gnative === '1';
  const clearCookies = ['gstate=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0', 'gnative=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'];
  const fail = () => redirectTo(res, isNative ? 'booklovers://auth?auth=failed' : '/?auth=failed', clearCookies);
  try {
    const state = u.searchParams.get('state');
    if (!state || !cookies.gstate || state !== cookies.gstate) return fail();
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: googleRedirectUri(req), grant_type: 'authorization_code' }).toString(),
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
    return redirectTo(res, isNative ? 'booklovers://auth#t=' + t : '/#t=' + t, clearCookies);
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
  const isTestUser = (u) => {
    const e = (u.email || '').toLowerCase();
    const local = e.split('@')[0]; const domain = e.split('@')[1] || '';
    return /^(rp\.smoke\.|rp\.xp\.|blc\.dbg\.)/.test(local)
      || local.includes('smoke')
      || ['example.com', 'example.org', 'example.net', 'test.com'].includes(domain)
      || /^(smoke|test|debug|ship)/.test(local);
  };
  // Super admin is exactly two identities, defined here in server code.
  // No API action can grant it, and no other account can hold it.
  const SUPER_ADMIN_EMAILS = ['ajay.r.nair@gmail.com', 'hazel@readingpeeps.com'];
  const isSuperAdmin = !!me && SUPER_ADMIN_EMAILS.includes(me.email);
  const action = body.action || '';
  const needAuth = !['signup', 'signin', 'track'].includes(action);
  if (needAuth && !me) return send(401, { error: 'Sign in first' });
  if (me) {
    let dirty = false;
    const outcomes = expirePolls(db);
    for (const o of outcomes) { await notifyPollResult(db, o.club, o.result, null); dirty = true; }
    const reminded = sweepMeetingReminders(db);
    if (reminded.length) { await deliverNotifications(db, reminded); dirty = true; }
    if (dirty) await writeDB(db);
  }

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
      case 'track': {
        const name = String(body.name || '');
        if (!/^[a-z0-9][a-z0-9_.-]{0,39}$/.test(name)) return send(400, { error: 'Event name must be a short identifier' });
        const clean = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
        const ev = {
          id: uid(), userId: me ? me.id : null, name,
          page: clean(body.page, 40), feature: clean(body.feature, 40),
          clubId: clean(body.clubId, 64), at: nowISO(),
        };
        Object.keys(ev).forEach((k) => { if (ev[k] === undefined) delete ev[k]; });
        db.events.push(ev);
        if (db.events.length > 5000) db.events.splice(0, db.events.length - 5000);
        await writeDB(db);
        return send(200, { ok: true });
      }
      case 'notifications': {
        const mine = db.notifications.filter((n) => n.userId === me.id)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return send(200, { notifications: mine.slice(0, 50), unread: mine.filter((n) => !n.readAt).length });
      }
      case 'markNotificationsRead': {
        const ids = Array.isArray(body.ids) ? body.ids : null;
        const via = ['web', 'app'].includes(body.via) ? body.via : null;
        let changed = false;
        db.notifications.forEach((n) => {
          if (n.userId === me.id && !n.readAt && (!ids || ids.includes(n.id))) { n.readAt = nowISO(); if (via) n.readVia = via; changed = true; }
        });
        if (changed) await writeDB(db);
        return send(200, { unread: db.notifications.filter((n) => n.userId === me.id && !n.readAt).length });
      }
      case 'stats': {
        if (!isSuperAdmin) return send(403, { error: 'Super admin only' });
        const full = true;
        const byId = {}; db.users.forEach((u) => { byId[u.id] = u; });
        const userList = db.users.map((u) => ({ name: u.name, email: u.email, createdAt: u.createdAt, isTest: isTestUser(u), isSuperAdmin: SUPER_ADMIN_EMAILS.includes(u.email) }));
        const clubList = db.clubs.map((c) => ({
          name: c.name, private: !!c.private, memberCount: (c.members || []).length,
          ...(full ? { members: (c.members || []).map((m) => { const u = byId[m.userId]; return u ? { name: u.name, email: u.email, role: m.role } : { userId: m.userId, role: m.role, missing: true }; }) } : {}),
        }));
        const notifStats = (() => {
          const all = db.notifications || [];
          const byType = {}; const email = {}; let read = 0; const perUser = {};
          all.forEach((n) => {
            byType[n.type] = (byType[n.type] || 0) + 1;
            const st = (n.channels && n.channels.email && n.channels.email.status) || 'unknown';
            email[st] = (email[st] || 0) + 1;
            if (n.readAt) read++;
            const pu = perUser[n.userId] || (perUser[n.userId] = { delivered: 0, read: 0 });
            pu.delivered++; if (n.readAt) pu.read++;
          });
          return {
            total: all.length, read, unread: all.length - read, byType, email,
            byUser: Object.keys(perUser).map((userId) => {
              const u = byId[userId];
              return { name: u ? u.name : '(deleted account)', email: u ? u.email : '', delivered: perUser[userId].delivered, read: perUser[userId].read };
            }),
          };
        })();
        const telemetryStats = (() => {
          const all = db.events || [];
          const byName = {}; const byPage = {}; const byFeature = {}; const perUser = {};
          const nowMs = Date.now(); let last7 = 0; let last30 = 0; const active = new Set();
          const byDay = [];
          for (let i = 13; i >= 0; i--) byDay.push({ day: new Date(nowMs - i * 864e5).toISOString().slice(0, 10), count: 0 });
          const dayIndex = {}; byDay.forEach((d, i) => { dayIndex[d.day] = i; });
          all.forEach((e) => {
            byName[e.name] = (byName[e.name] || 0) + 1;
            if (e.page) byPage[e.page] = (byPage[e.page] || 0) + 1;
            if (e.feature) byFeature[e.feature] = (byFeature[e.feature] || 0) + 1;
            const t = new Date(e.at).getTime();
            if (!isNaN(t)) { if (nowMs - t < 7 * 864e5) last7++; if (nowMs - t < 30 * 864e5) last30++; }
            const dk = String(e.at || '').slice(0, 10);
            if (dayIndex[dk] !== undefined) byDay[dayIndex[dk]].count++;
            if (e.userId) { active.add(e.userId); perUser[e.userId] = (perUser[e.userId] || 0) + 1; }
          });
          return {
            total: all.length, last7Days: last7, last30Days: last30, activeUsers: active.size,
            byName, byPage, byFeature, byDay,
            byUser: Object.keys(perUser).map((userId) => {
              const u = byId[userId];
              return { name: u ? u.name : '(deleted account)', email: u ? u.email : '', events: perUser[userId] };
            }),
          };
        })();
        return send(200, {
          scope: full ? 'full' : 'counts',
          notifications: notifStats,
          telemetry: telemetryStats,
          users: {
            total: userList.length,
            real: userList.filter((u) => !u.isTest).length,
            test: userList.filter((u) => u.isTest).length,
            ...(full ? { list: userList } : {}),
          },
          clubs: { total: clubList.length, list: clubList },
        });
      }
      case 'deleteTestUser': {
        if (!isSuperAdmin) return send(403, { error: 'Super admin only' });
        const target = db.users.find((u) => u.email === (body.email || '').toLowerCase());
        if (!target) return send(404, { error: 'No such account' });
        if (target.id === me.id) return send(400, { error: 'Use Delete account for your own account' });
        if (!isTestUser(target)) return send(400, { error: 'That is not a test account' });
        for (const club of db.clubs) {
          club.members = club.members.filter((m) => m.userId !== target.id);
          if (club.availability) delete club.availability[target.id];
          if (club.rsvps) delete club.rsvps[target.id];
          if (club.finished) delete club.finished[target.id];
          if (club.poll) delete club.poll.votes[target.id];
          ensureAdmin(db, club);
        }
        db.clubs = db.clubs.filter((c) => c.members.length > 0);
        Object.keys(db.ratings).forEach((k) => { if (k.startsWith(target.id + '|')) delete db.ratings[k]; });
        Object.keys(db.progress || {}).forEach((k) => { if (k.startsWith(target.id + '|')) delete db.progress[k]; });
        Object.keys(db.sessions).forEach((t) => { if (db.sessions[t] === target.id) delete db.sessions[t]; });
        db.notifications = db.notifications.filter((n) => n.userId !== target.id);
        db.invites = db.invites.filter((i) => i.email !== target.email && i.createdBy !== target.id);
        db.users = db.users.filter((u) => u.id !== target.id);
        await writeDB(db);
        return send(200, { ok: true, deleted: target.email });
      }
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
        const pollBefore = club.poll;
        maybeAutoPoll(db, club);
        if (!pollBefore && club.poll) {
          await notifyMembers(db, club, {
            type: 'poll', dedupeKey: 'poll-open:' + club.poll.id,
            title: 'Voting is open in ' + club.name,
            body: 'Vote for the next book to read together. Voting closes ' + prettyDateTime(club.poll.closesAt) + '.',
          });
        }
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'createInvite': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        // Accept a list in any of three shapes: body.emails (array),
        // body.emailList (comma-separated string), or legacy body.email.
        let rawList = [];
        if (Array.isArray(body.emails)) rawList = body.emails.flatMap((x) => String(x == null ? '' : x).split(','));
        else if (typeof body.emailList === 'string') rawList = body.emailList.split(',');
        else if (body.email) rawList = [String(body.email)];
        const MAX_INVITES = 20;
        const seen = new Set();
        const valid = [], invalid = [], overLimit = [];
        for (const piece of rawList) {
          const email = piece.trim().toLowerCase();
          if (!email) continue;
          if (seen.has(email)) continue;
          seen.add(email);
          if (!EMAIL_RE.test(email)) { invalid.push({ email, error: 'invalid email' }); continue; }
          if (valid.length >= MAX_INVITES) { overLimit.push(email); continue; }
          valid.push(email);
        }
        if (!valid.length && !invalid.length && !overLimit.length) return send(400, { error: 'No valid emails' });
        if (!valid.length && invalid.length) {
          return send(200, { emailed: !!process.env.RESEND_API_KEY, results: invalid.map((x) => ({ email: x.email, sent: false, error: x.error })) });
        }
        const created = valid.map((email) => {
          const inv = { id: uid(), clubId: club.id, email, token: uid() + uid(), used: false, createdBy: me.id, createdAt: nowISO() };
          db.invites.push(inv);
          return inv;
        });
        await writeDB(db);
        const apiKey = process.env.RESEND_API_KEY || '';
        const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'www.readingpeeps.com');
        const inviterLabel = me.name || me.email;
        const outcomes = apiKey
          ? await Promise.allSettled(created.map((inv) => sendInviteEmail(apiKey, {
              to: inv.email, inviterLabel, clubName: club.name, link: `${origin}/?invite=${inv.token}`,
            })))
          : created.map(() => ({ status: 'fulfilled', value: { sent: false } }));
        const results = [];
        created.forEach((inv, i) => {
          const o = outcomes[i];
          if (!apiKey) results.push({ email: inv.email, inviteToken: inv.token, sent: false });
          else if (o.status === 'fulfilled' && o.value.sent) results.push({ email: inv.email, inviteToken: inv.token, sent: true });
          else {
            const err = o.status === 'fulfilled' ? o.value.error : (o.reason && o.reason.message) || 'Email send failed';
            results.push({ email: inv.email, inviteToken: inv.token, sent: false, error: err });
          }
        });
        for (const x of invalid) results.push({ email: x.email, sent: false, error: x.error });
        for (const email of overLimit) results.push({ email, sent: false, error: 'over the 20-invite limit' });
        const payload = { emailed: !!apiKey, results };
        // Legacy single-email callers (older native builds) read the token at
        // the top level; keep that working when exactly one invite was made.
        if (created.length === 1) { payload.inviteToken = created[0].token; payload.email = created[0].email; }
        return send(200, payload);
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
        seedDiscussion(club);
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
        if (body.meeting && hasField(body.meeting, 'time')) {
          const t = body.meeting.time;
          if (typeof t !== 'string' || (t !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
            return send(400, { error: 'Meeting time must be HH:MM' });
          }
        }
        const prevMeeting = { ...(club.meeting || {}) };
        const meetingStamp = 'meeting:' + club.id + ':' + nowISO();
        if (body.meeting) club.meeting = { ...club.meeting, ...body.meeting };
        if (body.meeting && club.meeting.date) {
          const dateChanged = (prevMeeting.date || '') !== (club.meeting.date || '');
          const detailChanged = ['time', 'link', 'address'].some((f) => (prevMeeting[f] || '') !== (club.meeting[f] || ''));
          if (dateChanged) {
            await notifyMembers(db, club, {
              exceptUserId: me.id, type: 'meeting', dedupeKey: meetingStamp,
              title: 'Meeting set for ' + club.name,
              body: 'The next ' + club.name + ' meeting is on ' + prettyDay(club.meeting.date) + (club.meeting.time ? ' at ' + fmtTime(club.meeting.time) : '') + '. Open Reading Peeps to RSVP.',
            });
          } else if (detailChanged) {
            await notifyMembers(db, club, {
              exceptUserId: me.id, type: 'meeting', dedupeKey: meetingStamp,
              title: 'Meeting details updated for ' + club.name,
              body: 'The next ' + club.name + ' meeting is on ' + prettyDay(club.meeting.date) + (club.meeting.time ? ' at ' + fmtTime(club.meeting.time) : '') + '. The time or place was just updated.',
            });
          }
        }
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'react': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        if (!club.members.some((m) => m.userId === me.id)) return send(403, { error: 'Members only' });
        if (!REACTION_EMOJIS.includes(body.emoji)) return send(400, { error: 'Pick one of the reaction emojis' });
        const type = body.type;
        let bookKey = null, subjectUserId = null, at = null;
        if (type === 'finish' || type === 'rating') {
          bookKey = String(body.bookKey || '');
          subjectUserId = String(body.subjectUserId || '');
          if (!bookKey || !subjectUserId) return send(400, { error: 'Nothing there to react to' });
          if (subjectUserId === me.id) return send(400, { error: 'That one is yours' });
          const okTarget = type === 'finish'
            ? (((club.finished || {})[subjectUserId] || []).includes(bookKey))
            : (db.ratings[subjectUserId + '|' + bookKey] !== undefined);
          if (!okTarget) return send(400, { error: 'Nothing there to react to' });
        } else if (type === 'poll') {
          if (!club.lastResult || !club.lastResult.winner) return send(400, { error: 'No poll result to react to' });
          at = club.lastResult.at;
        } else {
          return send(400, { error: 'Unknown reaction target' });
        }
        club.reactions = club.reactions || [];
        const idx = club.reactions.findIndex((r) => r.userId === me.id && r.type === type && r.bookKey === bookKey && r.subjectUserId === subjectUserId && r.at === at && r.emoji === body.emoji);
        if (idx >= 0) club.reactions.splice(idx, 1);
        else club.reactions.push({ id: uid(), type, bookKey, subjectUserId, at, userId: me.id, emoji: body.emoji, createdAt: nowISO() });
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'setDiscussionTemplate': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        const list = (Array.isArray(body.questions) ? body.questions : [])
          .map((q) => String(q || '').trim()).filter(Boolean).slice(0, 30);
        club.discussionTemplate = list;
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'addDiscussionQuestion': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        if (!club.members.some((m) => m.userId === me.id)) return send(403, { error: 'Members only' });
        if (!club.current) return send(400, { error: 'No book picked yet' });
        const text = String(body.text || '').trim().slice(0, 500);
        if (!text) return send(400, { error: 'Write the question first' });
        if (body.scope === 'private') {
          club.privateQuestions = club.privateQuestions || {};
          const mineAll = club.privateQuestions[me.id] = club.privateQuestions[me.id] || {};
          (mineAll[club.current] = mineAll[club.current] || []).push({ id: uid(), text, createdAt: nowISO() });
        } else {
          seedDiscussion(club);
          club.questions[club.current].push({ id: uid(), text, byUserId: me.id, createdAt: nowISO() });
        }
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'removeDiscussionQuestion': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem) return send(403, { error: 'Members only' });
        if (!club.current) return send(400, { error: 'No book picked yet' });
        if (body.scope === 'private') {
          const mineAll = (club.privateQuestions || {})[me.id] || {};
          const list = mineAll[club.current] || [];
          const next = list.filter((q) => q.id !== body.questionId);
          if (next.length === list.length) return send(404, { error: 'Question not found' });
          club.privateQuestions[me.id][club.current] = next;
        } else {
          const list = ((club.questions || {})[club.current] || []);
          const target = list.find((q) => q.id === body.questionId);
          if (!target) return send(404, { error: 'Question not found' });
          if (target.byUserId !== me.id && mem.role !== 'admin') return send(403, { error: 'Only the person who added it, or an admin, can remove it' });
          club.questions[club.current] = list.filter((q) => q.id !== body.questionId);
        }
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
        const prevDate = club.meeting.date;
        if (club.meeting.date !== body.date) club.rsvps = {};
        club.meeting.date = body.date;
        club.members.forEach((m) => {
          if (!club.rsvps[m.userId] && ((club.availability || {})[m.userId] || []).includes(body.date)) club.rsvps[m.userId] = 'going';
        });
        if (prevDate !== body.date) {
          await notifyMembers(db, club, {
            exceptUserId: me.id, type: 'meeting', dedupeKey: 'meeting:' + club.id + ':' + nowISO(),
            title: 'Meeting set for ' + club.name,
            body: 'The next ' + club.name + ' meeting is on ' + prettyDay(body.date) + (club.meeting.time ? ' at ' + fmtTime(club.meeting.time) : '') + '. Open Reading Peeps to RSVP.',
          });
        }
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'shiftMeetingWeek': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        const weeks = Number(body.weeks);
        if (weeks !== 1 && weeks !== -1) return send(400, { error: 'Weeks must be 1 or -1' });
        const oldEnd = new Date(club.cycleEnd).getTime();
        if (isNaN(oldEnd)) return send(400, { error: 'Meeting week is not set' });
        const delta = weeks * 7 * 864e5;
        const newEnd = oldEnd + delta;
        if (newEnd - Date.now() < 7 * 864e5) return send(400, { error: 'The meeting week cannot be moved into the next 7 days' });
        club.cycleEnd = new Date(newEnd).toISOString();
        club.meeting = { ...(club.meeting || {}), date: '' };
        club.availability = {};
        if (club.poll && club.poll.closesAt) {
          const closes = new Date(club.poll.closesAt).getTime();
          if (!isNaN(closes)) club.poll.closesAt = new Date(closes + delta).toISOString();
        }
        await writeDB(db);
        return send(200, { club: publicClub(db, club, me.id) });
      }
      case 'startPoll': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        const candidates = pollCandidates(club);
        if (!candidates.length) return send(400, { error: club.library.length ? 'No books to vote on: every book is being read or finished' : 'Add at least two books first' });
        let closesAt = defaultClose(club);
        if (body.endDate && /^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) {
          const t = new Date(body.endDate + 'T23:59:59').getTime();
          if (!isNaN(t) && t > Date.now()) closesAt = new Date(Math.min(t, new Date(closesAt).getTime())).toISOString();
        }
        club.poll = { id: uid(), options: candidates, votes: {}, runoff: false, closesAt, createdAt: nowISO(), auto: false };
        await notifyMembers(db, club, {
          exceptUserId: me.id, type: 'poll', dedupeKey: 'poll-open:' + club.poll.id,
          title: 'Voting is open in ' + club.name,
          body: 'Vote for the next book to read together. Voting closes ' + prettyDateTime(closesAt) + '.',
        });
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
        if (club.lastResult) await notifyPollResult(db, club, club.lastResult, me.id);
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
        await notifyMembers(db, club, {
          exceptUserId: me.id, type: 'poll', dedupeKey: 'poll-open:' + club.poll.id,
          title: 'Runoff vote in ' + club.name,
          body: 'The vote tied, so a one day runoff is open. Vote now to break the tie.',
        });
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
        seedDiscussion(club);
        await notifyMembers(db, club, {
          exceptUserId: me.id, type: 'poll_result', dedupeKey: 'pick:' + club.id + ':' + nowISO(),
          title: 'Next book for ' + club.name,
          body: bookTitleOf(db, body.bookKey) + ' was picked as the club\u2019s next book.',
        });
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
      case 'removeMember': {
        const club = db.clubs.find((c) => c.id === body.clubId);
        if (!club) return send(404, { error: 'Club not found' });
        const mem = club.members.find((m) => m.userId === me.id);
        if (!mem || mem.role !== 'admin') return send(403, { error: 'Admins only' });
        const target = club.members.find((m) => m.userId === body.userId);
        if (!target) return send(404, { error: 'Member not found' });
        if (club.members.length <= 1) return send(400, { error: 'Cannot remove the only member of a club' });
        club.members = club.members.filter((m) => m.userId !== body.userId);
        // If the removed user was the last admin, the longest-standing
        // remaining member becomes admin (same rule as leave/deleteAccount).
        ensureAdmin(db, club);
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
        db.notifications = db.notifications.filter((n) => n.userId !== me.id);
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
