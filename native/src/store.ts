// Token + session storage. Same blc_token concept as the web app, persisted with
// Capacitor Preferences (falls back to localStorage on plain web).
import { Preferences } from '@capacitor/preferences';
import { setTokenCache, setTokenLoader, type User } from './api';

const TOKEN_KEY = 'blc_token';
const USER_KEY = 'blc_user';

let memToken: string | null = null;
let memUser: User | null = null;

export async function loadSession(): Promise<{ token: string | null; user: User | null }> {
  try {
    const t = await Preferences.get({ key: TOKEN_KEY });
    memToken = t.value || localStorage.getItem(TOKEN_KEY);
    const u = await Preferences.get({ key: USER_KEY });
    const raw = u.value || localStorage.getItem(USER_KEY);
    memUser = raw ? JSON.parse(raw) : null;
  } catch {
    memToken = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(USER_KEY);
    memUser = raw ? JSON.parse(raw) : null;
  }
  setTokenCache(memToken);
  return { token: memToken, user: memUser };
}

export async function saveSession(token: string, user: User): Promise<void> {
  memToken = token; memUser = user;
  setTokenCache(token);
  try {
    await Preferences.set({ key: TOKEN_KEY, value: token });
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(user) });
  } catch { /* ignore */ }
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function clearSession(): Promise<void> {
  memToken = null; memUser = null;
  setTokenCache(null);
  try {
    await Preferences.remove({ key: TOKEN_KEY });
    await Preferences.remove({ key: USER_KEY });
  } catch { /* ignore */ }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function sessionUser(): User | null { return memUser; }

// ---------- club usage (landing + flip order) ----------
// Same concept as the web app's localStorage 'blc_usage': per-club open counts,
// used to land on the most-used club and to order the club flip strip.
const USAGE_KEY = 'blc_usage';
export interface ClubUsage { count: number; last: number }

let memUsage: Record<string, ClubUsage> | null = null;

export async function loadUsage(): Promise<Record<string, ClubUsage>> {
  if (memUsage) return memUsage;
  let raw: string | null = null;
  try {
    const u = await Preferences.get({ key: USAGE_KEY });
    raw = u.value || localStorage.getItem(USAGE_KEY);
  } catch {
    raw = localStorage.getItem(USAGE_KEY);
  }
  try { memUsage = raw ? JSON.parse(raw) : {}; } catch { memUsage = {}; }
  return memUsage!;
}

export async function trackUsage(clubId: string): Promise<void> {
  const u = await loadUsage();
  const e = u[clubId] || { count: 0, last: 0 };
  e.count++; e.last = Date.now();
  u[clubId] = e;
  const raw = JSON.stringify(u);
  try { await Preferences.set({ key: USAGE_KEY, value: raw }); } catch { /* ignore */ }
  try { localStorage.setItem(USAGE_KEY, raw); } catch { /* ignore */ }
}

// Most-used first: open count desc, then most recent, then list order (web parity).
export function usageOrder<T extends { id: string }>(clubs: T[], usage: Record<string, ClubUsage>): T[] {
  return clubs
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ua = usage[a.c.id] || { count: 0, last: 0 };
      const ub = usage[b.c.id] || { count: 0, last: 0 };
      return (ub.count - ua.count) || (ub.last - ua.last) || (a.i - b.i);
    })
    .map((x) => x.c);
}

setTokenLoader(async () => {
  const s = await loadSession();
  return s.token;
});
