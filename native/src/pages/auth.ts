// Sign in / Create account — two separate forms, matching the web app.
// Google sign-in opens the production OAuth flow in the system browser; the app
// catches the booklovers://auth deep link on return (see main.ts).
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { api, GOOGLE_AUTH_URL, type User } from '../api';
import { saveSession } from '../store';
import { errText } from '../ui';
import { goTab } from '../main';

const G_LOGO = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-.95.66-2.23 1.08-4.07 1.08-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.21c-.25-.66-.38-1.4-.38-2.21s.14-1.55.38-2.21V6.7H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.3l3.98-3.09z"/><path fill="#EA4335" d="M12 4.83c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.21 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.7l3.98 3.09C6.22 6.94 8.87 4.83 12 4.83z"/></svg>';

export function AuthPage(root: HTMLElement) {
  root.innerHTML = `
    <ion-header translucent="true"><ion-toolbar><ion-title>Reading Peeps</ion-title></ion-toolbar></ion-header>
    <ion-content fullscreen="true" class="ion-padding">
      <div style="text-align:center;font-size:52px;margin:26px 0 4px">❤️</div>
      <h1 style="text-align:center;margin:0 0 6px;font-size:26px;font-weight:700">Reading Peeps</h1>
      <p style="text-align:center;color:var(--ion-color-medium);margin:0 0 22px">Read together, one book at a time.</p>

      <div id="formIn">
        <ion-list inset="true">
          <ion-item><ion-input id="inEmail" type="email" label="Email" label-placement="stacked" placeholder="you@example.com" autocomplete="email"></ion-input></ion-item>
          <ion-item><ion-input id="inPw" type="password" label="Password" label-placement="stacked" placeholder="Password" autocomplete="current-password"></ion-input></ion-item>
        </ion-list>
        <p id="inErr" style="color:var(--ion-color-danger);min-height:18px;margin:6px 16px;font-size:14px"></p>
        <ion-button id="signin" expand="block" style="margin:4px 16px">Sign in</ion-button>
        <div style="margin:0 16px">
          <div class="or-div">or</div>
          <button class="gbtn" id="gIn">${G_LOGO}<span>Sign in with Google</span></button>
        </div>
        <ion-button id="toSignup" fill="clear" expand="block" style="margin-top:10px">Create account</ion-button>
      </div>

      <div id="formUp" style="display:none">
        <ion-list inset="true">
          <ion-item><ion-input id="upName" type="text" label="Name" label-placement="stacked" placeholder="Your name" autocomplete="name"></ion-input></ion-item>
          <ion-item><ion-input id="upEmail" type="email" label="Email" label-placement="stacked" placeholder="you@example.com" autocomplete="email"></ion-input></ion-item>
          <ion-item><ion-input id="upPw" type="password" label="Password" label-placement="stacked" placeholder="Password" autocomplete="new-password"></ion-input></ion-item>
        </ion-list>
        <p id="upErr" style="color:var(--ion-color-danger);min-height:18px;margin:6px 16px;font-size:14px"></p>
        <ion-button id="signup" expand="block" style="margin:4px 16px">Create account</ion-button>
        <ion-button id="toSignin" fill="clear" expand="block" style="margin-top:10px">Sign in</ion-button>
      </div>
    </ion-content>`;

  const $ = (id: string) => root.querySelector('#' + id) as any;
  const val = (id: string) => (($(id).value as string) || '').trim();

  $('toSignup').addEventListener('click', () => { $('formIn').style.display = 'none'; $('formUp').style.display = ''; });
  $('toSignin').addEventListener('click', () => { $('formUp').style.display = 'none'; $('formIn').style.display = ''; });

  async function finish(token: string, user: User) {
    await saveSession(token, user);
    goTab('clubs');
  }

  $('signin').addEventListener('click', async () => {
    $('inErr').textContent = '';
    try {
      const r = await api<{ token: string; user: User }>('signin', { email: val('inEmail'), password: val('inPw') });
      await finish(r.token, r.user);
    } catch (e) { $('inErr').textContent = errText(e); }
  });

  $('signup').addEventListener('click', async () => {
    $('upErr').textContent = '';
    try {
      const r = await api<{ token: string; user: User }>('signup', { name: val('upName'), email: val('upEmail'), password: val('upPw') });
      await finish(r.token, r.user);
    } catch (e) { $('upErr').textContent = errText(e); }
  });

  $('gIn').addEventListener('click', async () => {
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: GOOGLE_AUTH_URL, presentationStyle: 'popover' });
    } else {
      window.location.href = GOOGLE_AUTH_URL;
    }
  });
}
