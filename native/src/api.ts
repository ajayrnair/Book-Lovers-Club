// API client for the Book Lovers Club production backend.
// Same JSON API the web app uses: POST https://booklovers-lemon.vercel.app/api/handler
// with { action, ...params } and an Authorization: Bearer <token> header.
//
// Transport: the production API sends no CORS headers, so in the native shells all
// calls go through CapacitorHttp (native networking layer, no CORS). In a web
// context the app calls the relative /api/handler path (same-origin when hosted,
// proxied to production by Vite in local dev/preview).

import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const API_ORIGIN = 'https://booklovers-lemon.vercel.app';
export const GOOGLE_AUTH_URL = API_ORIGIN + '/api/auth/google';

export interface BookRatings { rating: number; count: number }
export interface Book {
  key: string;
  isbn?: string;
  title: string;
  author?: string;
  cover?: string;
  year?: string;
  google?: BookRatings | null;
  hardcover?: BookRatings | null;
  openlibrary?: BookRatings | null;
  myRating?: number | null;
  memberAverage?: number | null;
  memberCount?: number;
}
export interface SearchBook {
  isbn?: string; title: string; author?: string; cover?: string; year?: string;
  google?: BookRatings | null; hardcover?: BookRatings | null; openlibrary?: BookRatings | null;
}
export interface Member { userId: string; name: string; role: 'admin' | 'member'; joinedAt: string }
export interface MemberRating { userId: string; name: string; rating: number | null }
export interface PollOption { book: Book; votes: number }
export interface Poll {
  id: string; runoff: boolean; closesAt: string; auto: boolean;
  options: PollOption[]; totalVotes: number;
}
export interface Meeting { type: 'online' | 'inperson'; link: string; address: string; date: string }
export interface Club {
  id: string; name: string; private: boolean;
  memberCount: number; isMember: boolean; role: 'admin' | 'member' | null;
  members: Member[];
  library: Book[];
  current: Book | null;
  currentRatings: MemberRating[];
  meetingFrequencyWeeks: number;
  cycleEnd: string | null;
  autoPoll: boolean;
  meeting: Meeting;
  week: string[];
  availability: Record<string, string[]>;
  finishedBy: string[];
  myFinished: boolean;
  rsvps: Record<string, 'going' | 'notgoing'>;
  poll: Poll | null;
  lastResult: { winner: string | null; tie: string[] | null; at: string } | null;
}
export interface User { id: string; name: string; email: string }

let tokenCache: string | null = null;
let tokenLoader: (() => Promise<string | null>) | null = null;
export function setTokenLoader(fn: () => Promise<string | null>) { tokenLoader = fn; }
export function setTokenCache(t: string | null) { tokenCache = t; }
export async function currentToken(): Promise<string | null> {
  if (tokenCache) return tokenCache;
  if (tokenLoader) tokenCache = await tokenLoader();
  return tokenCache;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T = any>(action: string, body: Record<string, any> = {}): Promise<T> {
  const token = await currentToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(token ? { authorization: 'Bearer ' + token } : {}),
  };
  const payload = { action, ...body };

  if (Capacitor.isNativePlatform()) {
    const resp = await CapacitorHttp.post({
      url: API_ORIGIN + '/api/handler',
      headers,
      data: payload,
    });
    const j: any = typeof resp.data === 'string' ? safeJson(resp.data) : (resp.data || {});
    if (resp.status < 200 || resp.status >= 300) throw new ApiError(resp.status, j.error || ('HTTP ' + resp.status));
    return j as T;
  }

  const r = await fetch('/api/handler', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error || ('HTTP ' + r.status));
  return j as T;
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}
