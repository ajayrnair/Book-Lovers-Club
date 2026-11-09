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

// Half-step rating input as an iOS-style chip row. Returns HTML; wire with wireRatingChips().
export function ratingChips(current: number | null, attr: string): string {
  const vals = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const label = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return `<div class="rating-chips" ${attr}>
    <ion-chip class="rchip ${current === null ? 'sel' : ''}" data-r="">None</ion-chip>
    ${vals.map((v) => `<ion-chip class="rchip ${current === v ? 'sel' : ''}" data-r="${v}">${label(v)}★</ion-chip>`).join('')}
  </div>`;
}

export function wireRatingChips(scope: HTMLElement, onPick: (v: number | null) => void) {
  scope.querySelectorAll('.rating-chips').forEach((row) => {
    row.querySelectorAll('.rchip').forEach((chip) => {
      chip.addEventListener('click', () => {
        row.querySelectorAll('.rchip').forEach((c) => c.classList.remove('sel'));
        chip.classList.add('sel');
        const raw = (chip as HTMLElement).dataset.r;
        onPick(raw === '' || raw === undefined ? null : Number(raw));
      });
    });
  });
}
