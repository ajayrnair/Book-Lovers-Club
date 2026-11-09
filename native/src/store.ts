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

setTokenLoader(async () => {
  const s = await loadSession();
  return s.token;
});
