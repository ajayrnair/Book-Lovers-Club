// Tiny view-stack router + shared UI helpers, built on Ionic web components (iOS mode).
export type PageFn = (root: HTMLElement) => void | Promise<void>;

interface StackEntry { fn: PageFn; tab: string | null }

const stack: StackEntry[] = [];
let viewEl: HTMLElement | null = null;
let tabWrap: HTMLElement | null = null;
let tabBar: HTMLElement | null = null;

export function initRouter() {
  viewEl = document.getElementById('view');
  tabWrap = document.getElementById('tabbar-wrap');
  tabBar = document.getElementById('tabbar');
  tabBar?.querySelectorAll('ion-tab-button').forEach((b) => {
    b.addEventListener('click', () => {
      const tab = (b as HTMLElement).dataset.tab!;
      window.dispatchEvent(new CustomEvent('blc:tab', { detail: tab }));
    });
  });
}

async function render() {
  const top = stack[stack.length - 1];
  if (!viewEl || !top) return;
  viewEl.innerHTML = '';
  const host = document.createElement('div');
  host.className = 'page-host';
  viewEl.appendChild(host);
  if (tabWrap && tabBar) {
    if (top.tab) {
      tabWrap.style.display = '';
      tabBar.querySelectorAll('ion-tab-button').forEach((b) => {
        (b as any).selected = (b as HTMLElement).dataset.tab === top.tab;
      });
      viewEl.style.bottom = '0';
      host.style.paddingBottom = '64px';
    } else {
      tabWrap.style.display = 'none';
      host.style.paddingBottom = '0';
    }
  }
  await top.fn(host);
  const content = host.querySelector('ion-content') as any;
  if (content?.scrollToTop) content.scrollToTop(0);
}

export function go(fn: PageFn, opts: { tab?: string | null; replace?: boolean } = {}) {
  const entry: StackEntry = { fn, tab: opts.tab ?? null };
  if (opts.replace && stack.length) stack[stack.length - 1] = entry;  // reload current page in place
  else stack.push(entry);
  void render();
}

export function resetTo(fn: PageFn, tab: string | null) {
  stack.splice(0, stack.length, { fn, tab });
  void render();
}

export function back() {
  if (stack.length > 1) { stack.pop(); void render(); }
}

export function refreshPage() { void render(); }

export function canGoBack() { return stack.length > 1; }

// ---------- small helpers ----------
export const esc = (s: any) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export async function toast(message: string, color: string = 'dark') {
  const t = document.createElement('ion-toast') as any;
  t.message = message;
  t.duration = 2200;
  t.color = color;
  t.position = 'bottom';
  document.body.appendChild(t);
  await t.present();
}

export function errText(e: any): string {
  return e?.message || 'Something went wrong';
}

// Page scaffold: iOS large-title header + content. Returns the content container to fill.
export function scaffold(
  root: HTMLElement,
  opts: {
    title: string;
    backText?: string | null;   // null = no back button
    endButtons?: string;        // raw HTML for toolbar end slot
  },
): HTMLElement {
  const showBack = opts.backText !== null && canGoBack();
  root.innerHTML = `
    <ion-header translucent="true">
      <ion-toolbar>
        ${showBack ? `<ion-buttons slot="start"><ion-back-button id="pg-back" default-href="#" text="${esc(opts.backText ?? '')}"></ion-back-button></ion-buttons>` : ''}
        <ion-title>${esc(opts.title)}</ion-title>
        ${opts.endButtons ? `<ion-buttons slot="end">${opts.endButtons}</ion-buttons>` : ''}
      </ion-toolbar>
    </ion-header>
    <ion-content fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar><ion-title size="large">${esc(opts.title)}</ion-title></ion-toolbar>
      </ion-header>
      <div class="page-body"></div>
    </ion-content>`;
  const backBtn = root.querySelector('#pg-back');
  backBtn?.addEventListener('click', (e) => { e.preventDefault(); back(); });
  return root.querySelector('.page-body') as HTMLElement;
}

export function fmtDate(ds?: string | null): string {
  if (!ds) return '';
  const d = new Date(ds.length <= 10 ? ds + 'T12:00:00' : ds);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Star display: ★★★★☆ with halves rendered as a half-filled star glyph via two-tone spans.
export function starsDisplay(v: number | null | undefined): string {
  if (v === null || v === undefined) return '<span class="stars-none">Not rated</span>';
  const full = Math.floor(v);
  const half = v - full >= 0.5;
  let out = '';
  for (let i = 0; i < 5; i++) {
    if (i < full) out += '<span class="star on">★</span>';
    else if (i === full && half) out += '<span class="star half">★</span>';
    else out += '<span class="star">★</span>';
  }
  return `<span class="stars">${out}</span> <span class="stars-num">${v}</span>`;
}

// External ratings line (Google / Hardcover / Open Library), same precedence as the web app.
export function ratingsLine(b: { google?: any; hardcover?: any; openlibrary?: any }): string {
  const parts: string[] = [];
  if (b.google) parts.push(`Google ★ ${b.google.rating} (${b.google.count})`);
  if (b.hardcover && !(b.google && b.google.count > (b.hardcover.count || 0) * 10))
    parts.push(`Hardcover ★ ${b.hardcover.rating} (${b.hardcover.count})`);
  if (!b.google && !b.hardcover && b.openlibrary)
    parts.push(`Open Library ★ ${b.openlibrary.rating} (${b.openlibrary.count})`);
  return parts.length ? `<div class="ext-ratings">${esc(parts.join(' · '))}</div>` : '';
}

// ---------- Explore constants (identical to the web app) ----------
export const GENRES = ['Fiction', 'Mystery', 'Thriller', 'Science Fiction', 'Fantasy', 'Romance', 'Horror', 'Classics', 'Poetry', 'History', 'Biography', 'Memoir', 'Science', 'Self Development', 'Young Adult', 'Comics and Graphic Novels'];
export const AUDIENCES = ['Kids', 'Teens', 'Young adults', 'Adults', 'Seniors'];
export interface Place { label: string; lat: number; lng: number }
export const PLACES: Place[] = [
  { label: 'Seattle, WA', lat: 47.6062, lng: -122.3321 },
  { label: 'Bellevue, WA', lat: 47.6101, lng: -122.2015 },
  { label: 'Portland, OR', lat: 45.5152, lng: -122.6784 },
  { label: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 },
  { label: 'San Jose, CA', lat: 37.3387, lng: -121.8853 },
  { label: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
  { label: 'San Diego, CA', lat: 32.7157, lng: -117.1611 },
  { label: 'Sacramento, CA', lat: 38.5816, lng: -121.4944 },
  { label: 'Phoenix, AZ', lat: 33.4484, lng: -112.074 },
  { label: 'Las Vegas, NV', lat: 36.1699, lng: -115.1398 },
  { label: 'Salt Lake City, UT', lat: 40.7608, lng: -111.891 },
  { label: 'Denver, CO', lat: 39.7392, lng: -104.9903 },
  { label: 'Austin, TX', lat: 30.2672, lng: -97.7431 },
  { label: 'Dallas, TX', lat: 32.7767, lng: -96.797 },
  { label: 'Houston, TX', lat: 29.7604, lng: -95.3698 },
  { label: 'Minneapolis, MN', lat: 44.9778, lng: -93.265 },
  { label: 'Chicago, IL', lat: 41.8781, lng: -87.6298 },
  { label: 'Nashville, TN', lat: 36.1627, lng: -86.7816 },
  { label: 'Atlanta, GA', lat: 33.749, lng: -84.388 },
  { label: 'Miami, FL', lat: 25.7617, lng: -80.1918 },
  { label: 'Washington, DC', lat: 38.9072, lng: -77.0369 },
  { label: 'Philadelphia, PA', lat: 39.9526, lng: -75.1652 },
  { label: 'New York, NY', lat: 40.7128, lng: -74.006 },
  { label: 'Brooklyn, NY', lat: 40.6782, lng: -73.9442 },
  { label: 'Boston, MA', lat: 42.3601, lng: -71.0589 },
];

// ---------- date/time formatting (web parity) ----------
export function fmtTime(t?: string | null): string {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return '';
  const d = new Date('2000-01-01T' + t + ':00');
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function fmtDayShort(ds?: string | null): string {
  if (!ds) return '';
  const d = new Date(ds + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function shiftDayStr(ds: string, n: number): string {
  const p = ds.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}
// Compact range: same month "Nov 23–29", cross-month "Nov 30–Dec 6" (web parity).
export function fmtRangeShort(a: string, b: string): string {
  const da = new Date(a + 'T12:00:00');
  const db = new Date(b + 'T12:00:00');
  return da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear()
    ? fmtDayShort(a) + '–' + db.getDate()
    : fmtDayShort(a) + '–' + fmtDayShort(b);
}
export function fmtDateLong(ds?: string | null): string {
  if (!ds) return '';
  const d = new Date(ds + 'T12:00:00');
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
export function todayStr(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ---------- star-strip rating editor (web parity) ----------
// Draggable/finger-roll star strip, half steps, with a plain "Clear" text button
// when a rating is set. Replaces the old rating chips everywhere.
const STAR_POLY = '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>';
export function starsHTML(v: number): string {
  let h = '';
  for (let i = 0; i < 5; i++) {
    const pct = Math.max(0, Math.min(100, (v - i) * 100));
    h += `<span class="st"><svg viewBox="0 0 24 24" class="stbg">${STAR_POLY}</svg><span class="stf" style="width:${pct}%"><svg viewBox="0 0 24 24" class="stfg">${STAR_POLY}</svg></span></span>`;
  }
  return h;
}
export function starStripHTML(bookKey: string, value: number | null | undefined, title = ''): string {
  const v = value === null || value === undefined ? 0 : value;
  return `<span class="ratewrap"><span class="ratestars" data-rate="${esc(bookKey)}" data-val="${v}" role="slider" aria-label="Your rating${title ? ' for ' + esc(title) : ''}" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${v}">${starsHTML(v)}</span>${v > 0 ? `<button class="rateclear" data-clear="${esc(bookKey)}" aria-label="Clear rating">Clear</button>` : ''}</span>`;
}
function paintStars(el: HTMLElement, v: number) {
  el.querySelectorAll('.stf').forEach((f, i) => {
    (f as HTMLElement).style.width = Math.max(0, Math.min(100, (v - i) * 100)) + '%';
  });
  el.setAttribute('aria-valuenow', String(v));
}
// onRate(bookKey, value) — value 0 means cleared. The caller owns the API call
// and any re-render (same shape as the web wireRates(rerender) flow).
export function wireStarStrips(scope: HTMLElement, onRate: (bookKey: string, value: number) => void | Promise<void>) {
  scope.querySelectorAll('[data-rate]').forEach((node) => {
    const el = node as HTMLElement;
    const key = el.dataset.rate!;
    let val = Number(el.dataset.val) || 0;
    let dragVal: number | null = null;
    const fromEvent = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      return Math.min(5, Math.max(0.5, Math.ceil(frac * 10) / 2));
    };
    el.addEventListener('pointerdown', (e) => {
      try { el.setPointerCapture(e.pointerId); } catch { /* noop */ }
      dragVal = fromEvent(e as PointerEvent); paintStars(el, dragVal);
    });
    el.addEventListener('pointermove', (e) => {
      if (dragVal === null) return;
      dragVal = fromEvent(e as PointerEvent); paintStars(el, dragVal);
    });
    el.addEventListener('pointerup', () => {
      if (dragVal === null) return;
      const v = dragVal; dragVal = null;
      if (v === val) { paintStars(el, val); return; }
      val = v; el.dataset.val = String(v);
      void onRate(key, v);
    });
    el.addEventListener('pointercancel', () => { dragVal = null; paintStars(el, val); });
  });
  scope.querySelectorAll('[data-clear]').forEach((node) => {
    (node as HTMLElement).addEventListener('click', () => void onRate((node as HTMLElement).dataset.clear!, 0));
  });
}

// ---------- in-app date/time pickers (web parity; NO native inputs, NO modals) ----------
// One picker open at a time across the page; inline expansion under the field.
let closeOpenPicker: (() => void) | null = null;

export function pickerFieldHTML(id: string, kind: 'date' | 'time', value: string): string {
  const label = kind === 'date'
    ? (value ? esc(fmtDateLong(value)) : '<span class="dtmuted">Pick a date</span>')
    : (value ? esc(fmtTime(value)) : '<span class="dtmuted">Pick a time</span>');
  return `<div class="dtfield">
    <button type="button" class="dtrow" id="${id}Btn" aria-expanded="false"><span class="dtic"><ion-icon name="${kind === 'date' ? 'calendar-outline' : 'time-outline'}"></ion-icon></span><span class="dtval" id="${id}Val">${label}</span><span class="dtchev"><ion-icon name="chevron-forward"></ion-icon></span></button>
    <div class="dtpanel hide" id="${id}Panel"></div>
    <input type="hidden" id="${id}" value="${esc(value || '')}">
  </div>`;
}

export function wireDatePicker(scope: HTMLElement, inputId: string, onCommit?: (value: string) => void) {
  const btn = scope.querySelector('#' + inputId + 'Btn') as HTMLElement | null;
  const panel = scope.querySelector('#' + inputId + 'Panel') as HTMLElement | null;
  const input = scope.querySelector('#' + inputId) as HTMLInputElement | null;
  const valEl = scope.querySelector('#' + inputId + 'Val') as HTMLElement | null;
  if (!btn || !panel || !input || !valEl) return;
  const today = todayStr();
  let view = (input.value || today).slice(0, 7);
  const close = () => {
    panel.classList.add('hide'); btn.setAttribute('aria-expanded', 'false');
    if (closeOpenPicker === close) closeOpenPicker = null;
  };
  const render = () => {
    const [vy, vm] = view.split('-').map(Number);
    const first = new Date(vy, vm - 1, 1);
    const startOffset = (first.getDay() + 6) % 7; // weeks start on Monday
    const dim = new Date(vy, vm, 0).getDate();
    let cells = '';
    for (let i = 0; i < startOffset; i++) cells += '<span class="calday blank"></span>';
    for (let d = 1; d <= dim; d++) {
      const ds = vy + '-' + String(vm).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const off = ds < today;
      cells += `<button type="button" class="calday${input.value === ds ? ' sel' : ''}${off ? ' off' : ''}" data-calday="${ds}" ${off ? 'disabled' : ''}>${d}</button>`;
    }
    panel.innerHTML = `<div class="calhead"><button type="button" class="calnav" data-calnav="-1" aria-label="Previous month"><ion-icon name="chevron-back"></ion-icon></button><b>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><button type="button" class="calnav" data-calnav="1" aria-label="Next month"><ion-icon name="chevron-forward"></ion-icon></button></div>
    <div class="calgrid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w) => `<span class="calwd">${w}</span>`).join('')}${cells}</div>`;
    panel.querySelectorAll('[data-calnav]').forEach((b) => (b as HTMLElement).addEventListener('click', () => {
      const nv = new Date(vy, vm - 1 + Number((b as HTMLElement).dataset.calnav), 1);
      view = nv.getFullYear() + '-' + String(nv.getMonth() + 1).padStart(2, '0');
      render();
    }));
    panel.querySelectorAll('[data-calday]').forEach((b) => (b as HTMLElement).addEventListener('click', () => {
      input.value = (b as HTMLElement).dataset.calday!;
      valEl.innerHTML = esc(fmtDateLong(input.value));
      close();
      if (onCommit) onCommit(input.value);
    }));
  };
  btn.addEventListener('click', () => {
    if (!panel.classList.contains('hide')) { close(); return; }
    if (closeOpenPicker) closeOpenPicker();
    render(); panel.classList.remove('hide'); btn.setAttribute('aria-expanded', 'true'); closeOpenPicker = close;
  });
}

export function wireTimePicker(scope: HTMLElement, inputId: string, onCommit?: (value: string) => void) {
  const btn = scope.querySelector('#' + inputId + 'Btn') as HTMLElement | null;
  const panel = scope.querySelector('#' + inputId + 'Panel') as HTMLElement | null;
  const input = scope.querySelector('#' + inputId) as HTMLInputElement | null;
  const valEl = scope.querySelector('#' + inputId + 'Val') as HTMLElement | null;
  if (!btn || !panel || !input || !valEl) return;
  const m = /^(\d{2}):(\d{2})$/.exec(input.value || '');
  const st = m ? { h24: Number(m[1]), min: Number(m[2]) } : { h24: 19, min: 0 };
  let snapped = [0, 15, 30, 45].includes(st.min);
  const close = () => {
    panel.classList.add('hide'); btn.setAttribute('aria-expanded', 'false');
    if (closeOpenPicker === close) closeOpenPicker = null;
  };
  const render = () => {
    const h12 = ((st.h24 + 11) % 12) + 1;
    const ap = st.h24 < 12 ? 'AM' : 'PM';
    panel.innerHTML = `
    <div class="timegrid">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => `<button type="button" class="tchip${h === h12 ? ' on' : ''}" data-th="${h}">${h}</button>`).join('')}</div>
    <div class="minsgrid">${[0, 15, 30, 45].map((mn) => `<button type="button" class="tchip${snapped && mn === st.min ? ' on' : ''}" data-tm="${mn}">:${String(mn).padStart(2, '0')}</button>`).join('')}</div>
    <div class="ampmrow"><ion-segment value="${ap}" id="${inputId}Ap">
      <ion-segment-button value="AM"><ion-label>AM</ion-label></ion-segment-button>
      <ion-segment-button value="PM"><ion-label>PM</ion-label></ion-segment-button>
    </ion-segment></div>`;
    const commit = () => {
      input.value = String(st.h24).padStart(2, '0') + ':' + String(st.min).padStart(2, '0');
      valEl.textContent = fmtTime(input.value);
      if (onCommit) onCommit(input.value);
    };
    const snap = () => {
      if (!snapped) {
        st.min = [0, 15, 30, 45].reduce((a, b) => (Math.abs(b - st.min) < Math.abs(a - st.min) ? b : a), 0);
        snapped = true;
      }
    };
    panel.querySelectorAll('[data-th]').forEach((b) => (b as HTMLElement).addEventListener('click', () => {
      snap();
      const apNow = st.h24 < 12 ? 'AM' : 'PM';
      st.h24 = (Number((b as HTMLElement).dataset.th) % 12) + (apNow === 'PM' ? 12 : 0);
      commit(); render();
    }));
    panel.querySelectorAll('[data-tm]').forEach((b) => (b as HTMLElement).addEventListener('click', () => {
      snapped = true; st.min = Number((b as HTMLElement).dataset.tm);
      commit(); render();
    }));
    panel.querySelector('#' + inputId + 'Ap')?.addEventListener('ionChange', (e: any) => {
      snap();
      if (e.detail.value === 'PM' && st.h24 < 12) st.h24 += 12;
      if (e.detail.value === 'AM' && st.h24 >= 12) st.h24 -= 12;
      commit(); render();
    });
  };
  btn.addEventListener('click', () => {
    if (!panel.classList.contains('hide')) { close(); return; }
    if (closeOpenPicker) closeOpenPicker();
    render(); panel.classList.remove('hide'); btn.setAttribute('aria-expanded', 'true'); closeOpenPicker = close;
  });
}
