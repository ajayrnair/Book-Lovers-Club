# Book Lovers Club — native apps (iOS + Android)

One codebase → iOS and Android apps, built with **Ionic (iOS mode forced on both
platforms)** + **Capacitor 7** + plain TypeScript/Vite. Both apps use Apple's iOS
design language — large-title headers, grouped inset lists, iOS tab bar, sheets,
toggles, segmented controls — so they look the same everywhere. The only brand
color is the rose tint (`#c2255c`); everything else follows iOS system colors,
typography and spacing, with dark mode via the iOS system palette.

Same production backend and data as the web app: all calls go to
`https://booklovers-lemon.vercel.app/api/handler` (the web app's JSON API,
unchanged). See `src/api.ts` for the action contract.

## Layout

- `src/` — app code (api client, session store, router/UI helpers, pages)
- `src/pages/` — auth, clubs, club, library, poll, addbooks, settings, me
- `ios/` — generated Xcode project (CocoaPods; open `ios/App/App.xcworkspace`)
- `android/` — generated Android Studio project
- `tests/` — `api-flow.mjs` (production API lifecycle test) and `ui-flow.mjs`
  (Puppeteer drive of the built bundle at iPhone size, with screenshots)
- `scripts/restore-binaries.sh` — see "Binary files" below

## Build

```sh
npm install
npm run build          # tsc + vite build -> dist/
npx cap sync           # copy dist/ into ios/ and android/
```

Android debug APK (needs JDK 21 + Android SDK 35):
```sh
cd android && ./gradlew assembleDebug
```

iOS: compilation happens in CI (`.github/workflows/ios-native.yml` at the repo
root, macOS runner, simulator build with signing disabled) or on a Mac with Xcode.

## Auth transport note

The production API sends no CORS headers. Inside the native shells all API calls
therefore go through **CapacitorHttp** (the native networking layer), enabled in
`capacitor.config.ts`. In a plain web context the app calls the relative
`/api/handler` path (Vite proxies it to production for local dev).

## Google sign-in — status

- The "Sign in with Google" button opens
  `https://booklovers-lemon.vercel.app/api/auth/google` in the system browser
  (`@capacitor/browser`) — verified: the endpoint 302s to accounts.google.com
  with the correct redirect URI.
- The app listens for the return deep link **`booklovers://auth#t=<token>`**
  (registered in the iOS Info.plist and the Android manifest; handled via
  Capacitor App `appUrlOpen` in `src/main.ts`): on arrival it stores the token,
  loads the user and lands on the Clubs tab.
- **Remaining for the signing phase:** the production OAuth endpoint currently
  redirects to `/#t=<token>` on the web origin, not to the app scheme. Landing
  back inside the app needs one of:
  1. a small change to the web handler (out of scope for this pass — it would
     touch the live web app) to redirect to `booklovers://auth#t=...` when a
     `state`/flag marks the native flow, or
  2. an Associated Domain universal link (apple-app-site-association file +
     entitlement), which requires the Apple Developer team ID — available once
     Ajay hands over App Store Connect access.
  Email sign-in/sign-up is fully in-app and unaffected.

## Binary files (.b64)

This repo mirror was pushed through a text-only channel, so binary files
(launcher/splash PNGs, `gradle-wrapper.jar`) are stored base64-encoded next to
their real paths with a `.b64` suffix. Run `scripts/restore-binaries.sh` after
checkout to materialize them (CI does this automatically). The canonical local
project at `~/workspace/booklovers-native` holds the real binaries.
