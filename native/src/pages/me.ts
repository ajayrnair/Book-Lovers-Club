// Me tab: account details, sign out, delete account (full data removal on the server).
import { api } from '../api';
import { clearSession, sessionUser } from '../store';
import { errText, resetTo, scaffold, toast } from '../ui';
import { AuthPage } from './auth';

export async function MePage(root: HTMLElement) {
  const body = scaffold(root, { title: 'Me', backText: null });
  const me = sessionUser();
  let fresh = me;
  try { fresh = (await api<{ user: typeof me }>('me')).user || me; } catch { /* keep cached */ }

  body.innerHTML = `
    <div style="text-align:center;padding:20px 16px 6px">
      <ion-icon name="person-circle-outline" style="font-size:64px;color:var(--ion-color-medium)"></ion-icon>
      <h2 style="margin:6px 0 2px">${fresh?.name || ''}</h2>
      <p style="margin:0;color:var(--ion-color-medium)">${fresh?.email || ''}</p>
    </div>
    <ion-list inset="true" style="margin-top:18px">
      <ion-item button id="signOutBtn">
        <ion-label>Sign out</ion-label>
      </ion-item>
    </ion-list>
    <ion-list inset="true" style="margin-top:22px">
      <ion-item button id="delAccBtn">
        <ion-icon name="trash-outline" slot="start" color="danger"></ion-icon>
        <ion-label color="danger">Delete account</ion-label>
      </ion-item>
    </ion-list>
    <p style="margin:10px 32px;color:var(--ion-color-medium);font-size:13px">Deleting your account removes you, your ratings and your data from every club. Clubs you leave empty are deleted; where you were the only admin, the longest-standing member becomes admin.</p>`;

  body.querySelector('#signOutBtn')?.addEventListener('click', async () => {
    try { await api('signout'); } catch { /* session may already be gone */ }
    await clearSession();
    resetTo(AuthPage, null);
  });

  body.querySelector('#delAccBtn')?.addEventListener('click', async () => {
    const alert = document.createElement('ion-alert') as any;
    alert.header = 'Delete account';
    alert.message = 'Delete your account and all your data? This cannot be undone.';
    alert.buttons = [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete', role: 'destructive', handler: async () => {
          try {
            await api('deleteAccount');
            await clearSession();
            await toast('Account deleted');
            resetTo(AuthPage, null);
          } catch (e) { await toast(errText(e), 'danger'); }
        },
      },
    ];
    document.body.appendChild(alert);
    await alert.present();
  });
}
