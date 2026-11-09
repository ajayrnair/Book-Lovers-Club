// Book Lovers Club — native app entry.
// Ionic is forced into iOS mode on BOTH platforms: Apple's design language everywhere.
(window as any).Ionic = {
  config: {
    mode: 'ios',
    backButtonText: '',
    backButtonIcon: 'chevron-back',
  },
};

import '@ionic/core/css/core.css';
import '@ionic/core/css/normalize.css';
import '@ionic/core/css/structure.css';
import '@ionic/core/css/typography.css';
import '@ionic/core/css/padding.css';
import '@ionic/core/css/float-elements.css';
import '@ionic/core/css/text-alignment.css';
import '@ionic/core/css/flex-utils.css';
import '@ionic/core/css/display.css';
import '@ionic/core/css/palettes/dark.system.css';
import './theme.css';

import { defineCustomElements } from '@ionic/core/loader';
import { addIcons } from 'ionicons';
import {
  addCircleOutline, book, bookOutline, calendarOutline, checkmark, chevronBack, chevronForward,
  close, linkOutline, lockClosedOutline, peopleOutline, personCircleOutline, add, searchOutline,
  settingsOutline, star, trashOutline,
} from 'ionicons/icons';
import { App } from '@capacitor/app';

import { initRouter, resetTo, toast } from './ui';
import { loadSession, saveSession } from './store';
import { api, setTokenCache, type User } from './api';
import { AuthPage } from './pages/auth';
import { ClubsPage } from './pages/clubs';
import { AddBooksPage } from './pages/addbooks';
import { MePage } from './pages/me';

addIcons({
  'add-circle-outline': addCircleOutline, 'book-outline': bookOutline, book, 'calendar-outline': calendarOutline,
  checkmark, 'chevron-back': chevronBack, 'chevron-forward': chevronForward, close, 'link-outline': linkOutline,
  'lock-closed-outline': lockClosedOutline, 'people-outline': peopleOutline,
  'person-circle-outline': personCircleOutline, plus: add, 'search-outline': searchOutline,
  'settings-outline': settingsOutline, star, 'trash-outline': trashOutline,
});

export function goTab(tab: string) {
  if (tab === 'clubs') resetTo(ClubsPage, 'clubs');
  else if (tab === 'add') resetTo((r) => AddBooksPage(r, {}), 'add');
  else if (tab === 'me') resetTo(MePage, 'me');
}

// Google sign-in return path (app side).
// The OAuth flow runs in the system browser. When the web backend is pointed at the
// app (signing-phase step, see README), it redirects to booklovers://auth#t=<token>;
// this listener catches that deep link, stores the session, and signs the user in.
async function handleAuthDeepLink(url: string) {
  try {
    const frag = url.split('#')[1] || '';
    const qs = url.split('?')[1]?.split('#')[0] || '';
    const params = new URLSearchParams(frag || qs);
    const t = params.get('t');
    if (!t) return;
    setTokenCache(t);
    const { user } = await api<{ user: User }>('me');
    await saveSession(t, user);
    await toast('Signed in with Google');
    goTab('clubs');
  } catch {
    await toast('Google sign in did not finish', 'danger');
  }
}

async function boot() {
  await defineCustomElements();
  initRouter();
  window.addEventListener('blc:tab', (e: any) => goTab(e.detail));

  App.addListener('appUrlOpen', ({ url }) => {
    if (url.startsWith('booklovers://auth')) void handleAuthDeepLink(url);
  });
  const launch = await App.getLaunchUrl().catch(() => null);
  if (launch?.url?.startsWith('booklovers://auth')) {
    void handleAuthDeepLink(launch.url);
    return;
  }

  const { token } = await loadSession();
  if (token) {
    try {
      await api('me');
      goTab('clubs');
      return;
    } catch {
      // stale session; fall through to auth
    }
  }
  resetTo(AuthPage, null);
}

void boot();
