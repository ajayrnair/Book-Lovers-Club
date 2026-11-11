# Reading Peeps — Native SwiftUI App (Phase 1)

A genuine SwiftUI replacement for the Ionic/Capacitor app: real Apple
controls, same backend, same data. Built November 10, 2026.

**Compilation is UNVERIFIED.** There is no Xcode on the build machine used to
author this project, so nothing here has been compiled yet. The first compile
happens in CI (see "CI workflow" below). The code was written conservatively
(Swift 5 mode, no exotic APIs, iOS 17 APIs and earlier) and the project file
was machine-generated and cross-checked (every file referenced, every object
ID defined, delimiters balanced), but treat the first CI run as a real first
compile: expect to fix a handful of small errors.

## Layout

```
ReadingPeeps.xcodeproj/            hand-authored project (objectVersion 54)
  xcshareddata/xcschemes/ReadingPeeps.xcscheme   shared scheme, Release archive
ReadingPeeps/
  ReadingPeepsApp.swift            @main App, owns AppState
  Info.plist                       manual plist (GENERATE_INFOPLIST_FILE = NO)
  Assets.xcassets/AppIcon.appiconset   the fixed icon (RGB, no alpha, plum corners)
  Models.swift                     Codable models mirroring the API shapes
  APIClient.swift                  POST {action, ...} client + typed endpoints
  Keychain.swift                   session token storage
  AppState.swift                   session, club list, most-used ordering
  GoogleAuth.swift                 ASWebAuthenticationSession wrapper
  Dates.swift                      "yyyy-MM-dd" / ISO helpers (UTC-pinned)
  Constants.swift                  genres, audiences, places, brand colors
  Views/
    RootView.swift                 auth gate + TabView (Clubs, Add Books, Explore, Me)
    AuthView.swift                 email sign in / sign up, Google button
    ClubsView.swift                my clubs (most used first) + in-stack routes
    ClubView.swift                 the club screen (see below)
    Components.swift               covers, book rows, star rating, ratings text
    PollView.swift                 vote rows, tie-break, admin start form
    LibraryView.swift              Current book / To read / Read groups
    AddBooksView.swift             club multi-select, search + select, add by link
    ExploreView.swift              faceted Find, guided Create, invite join
    SettingsView.swift             club settings + Members with email invites
    MeView.swift                   account, sign out, delete account
```

## Project settings

- Bundle ID `com.ajayrnair.readingpeeps`, team `E5FB8K783X`, deployment
  target iOS 17.0, `MARKETING_VERSION` 1.0, `CURRENT_PROJECT_VERSION` 1
  (CI overrides the build number with the run number, as before).
- Release (app target): `CODE_SIGN_STYLE = Manual`,
  `CODE_SIGN_IDENTITY = "Apple Distribution"`,
  `PROVISIONING_PROFILE_SPECIFIER = "Reading Peeps App Store"` — the same
  manual-signing arrangement the Capacitor project was fixed to use, so the
  existing GitHub secrets (CERT_P12_BASE64, CERT_P12_PASSWORD,
  PROFILE_BASE64, ASC_*) carry over unchanged.
- Debug uses default (automatic) signing; profile specifier is Release-only.
- Info.plist carries `ITSAppUsesNonExemptEncryption = false` (builds land
  ready for TestFlight without the manual compliance step) and a
  `CFBundleURLTypes` entry for the `booklovers` scheme used by the Google
  sign-in return (`booklovers://auth#t=<token>`).

## What is implemented

- **Auth**: email sign in and sign up (segmented switch, two forms);
  Google via `ASWebAuthenticationSession` to
  `https://www.readingpeeps.com/api/auth/google?native=1`, callback scheme
  `booklovers`, token parsed from the URL fragment, then `me` to load the
  account. Token in the Keychain; session restored on launch.
- **Clubs tab**: my clubs ordered most-used first (open counts persisted in
  UserDefaults, same `blc_usage` concept as the web app), pull to refresh.
- **Club screen** in the settled order:
  1. *Current book*: cover, title, external ratings, member average, my star
     rating (tappable stars, half steps via half-star tap targets, plain
     Clear button), "I finished reading" Toggle, finished count, average
     from member ratings, per-member ratings in a DisclosureGroup.
  2. *Reading progress*: my Slider plus Page field + Stepper and Percent
     field + Stepper, two-way synced; the total page count is display-only
     text from the book record, never an input (books without a page count
     get percent-only controls). Member list with progress bars and
     "p. X · Y%" / "Finished" / "Not started".
  3. *Next book*: poll summary row (leader, votes, my vote, closes date)
     into the poll screen; tie state; single-candidate direct pick
     (setCurrent with the one-retry pattern); admin Start a poll entry.
  4. *Group meeting*: cadence line first; Mon–Sun week header with admin
     shift buttons labeled by the destination week ranges; availability
     day cells with per-day counts; admin per-day drill-in (who is available
     each day) and the most-available day called out; meeting date chosen
     with a native DatePicker (goes through pickDate); time with a native
     time picker; Online/In person segmented control; link or address
     field — all autosaved through clubSettings with a quiet "Saved" note,
     no Save button. When a date is set: date + time line, Going / Not
     going buttons (tap again to clear, matching the API), going list.
  5. Library row, Settings row (admins), Leave club with confirmation.
- **Poll screen**: tap a candidate row to vote (checkmark + vote share),
  standings footer, admin Close poll; tie state with admin pick and one-day
  runoff; admin start form with a DatePicker whose default is one day
  before the meeting, capped at a week (the web app's rule).
- **Library**: Current book / To read / Read groups, "Your rating" stars on
  every book, finished-by counts, + button opening Add Books as a sheet
  preset to this club.
- **Add Books tab**: target-club multi-select (defaults to all clubs, or the
  preset club from the library), search with tap-to-select rows and
  checkmarks, bottom add bar, paste-a-link via addByLink.
- **Explore tab**: Find with name, format, genres (multi-select sheet,
  intersected client-side like the web), audience, specialty, Near a place
  from the standardized 25-place list with 10/25/50 km radius; results with
  Join / Joined; join-by-invite field (accepts a pasted link or code).
  Create with name, Private default, format, place picker for in-person
  (required), genres (cap 8), audience, specialty.
- **Settings (admin)**: Members (make/remove admin, remove member with
  confirmation) with the **email invite form** — comma-separated emails,
  createInvite with `emailList`, per-person results (sent, share-this-link
  fallback with selectable text, or the error); meeting frequency +
  auto-poll, autosaved on change; Delete club with confirmation.
- **Me tab**: name/email, sign out, delete account with confirmation.

## Deliberate phase-1 simplifications

- Club switching is list-based (back to Clubs, tap another). The web app's
  swipe/flip strip is not ported; most-used ordering is.
- No club identity editing (format/location/genres of an existing club) —
  clubSettings identity fields are unused by the UI for now.
- Meeting link/address fields autosave on Return and on focus loss (the
  pickers autosave immediately). There is no debounce; each change is one
  serialized user action at a time.
- Covers load with AsyncImage; a stored cover URL that is not https will
  fall back to the placeholder under default ATS rules.
- After creating a club in Explore, the club appears in the Clubs tab list
  (the create form confirms by name); there is no cross-tab auto-navigation.

## API contract — sources and assumptions

Every action name, parameter name, and response shape was taken from the
shipping clients and the server, not invented:

- `booklovers-native/src/api.ts` — the TypeScript model interfaces
  (Club, Book, Poll, Meeting, ProgressEntry, ...) and the transport shape
  (POST JSON `{action, ...params}`, `Authorization: Bearer <token>`).
- `booklovers-native/src/pages/*.ts` — the exact call sites: signin/signup
  `{email,password}` / `{name,email,password}` returning `{token, user}`;
  `me` -> `{user}`; `myClubs` / `club` / `searchClubs` -> `{clubs}` /
  `{club}`; `rate {bookKey, rating}` (0 clears); `toggleFinished {clubId}`;
  `setProgress {clubId, bookKey, page|percent}`; `setCurrent {clubId,
  bookKey}`; `availability {clubId, days}`; `rsvp {clubId, status}`
  ("" clears); `pickDate {clubId, date}`; `shiftMeetingWeek {clubId,
  weeks}` (±1); `startPoll {clubId, endDate}`; `vote/closePoll/runoff/
  adminPick {clubId, bookKey?}`; `searchBooks {q}` -> `{results}`;
  `addBooks {clubIds, books}` (books are the search-result objects);
  `addByLink {url, clubIds}` -> `{book}`; `createClub` payload
  `{name, private, format, genres, audience, specialty, location?}`;
  `acceptInvite {inviteToken}` -> `{club}`; `joinClub/leaveClub {clubId}`;
  `clubSettings {clubId, meetingFrequencyWeeks, autoPoll, meeting{type,
  link, address, time}}`; `createInvite {clubId, emailList}` ->
  `{emailed, results[{email, inviteToken?, sent, error?}]}`;
  `makeAdmin/removeAdmin/removeMember {clubId, userId}`;
  `deleteClub {clubId}`; `deleteAccount`; `signout`.
- `booklovers-vercel/api/handler.js` — verified server-side: `publicClub`
  (field-for-field, incl. `week` as Mon–Sun "yyyy-MM-dd" strings, `progress`
  rows `{userId, percent, page, totalPages, updatedAt}`, `rsvps` map,
  `lastResult {winner, tie, at}`), `bookView` (pageCount may be null,
  ratings objects `{rating, count}` or null), `pollView`
  (`{id, runoff, closesAt, auto, options[{book, votes}], totalVotes,
  myVote}`), `meetingWeek`, clubSettings merge semantics (meeting object is
  spread-merged; `time` must be "" or HH:MM), pickDate's 7-day rule and its
  availability-based RSVP prefill, and `myClubs` returning full publicClub
  objects.

Assumptions worth knowing:

- API base is `https://www.readingpeeps.com/api/handler` (the production
  domain). The Ionic client pointed at the vercel.app origin; they are the
  same deployment.
- `Meeting` decodes defensively (missing keys default to "" / "online")
  because a brand-new club's meeting object has no `time` key.
- `setProgress` and `setCurrent` get one retry after 900 ms (the known
  read-after-write race), matching the other clients.
- Dates from the API that are day strings are handled as UTC calendar days;
  DatePicker conversions go through the device-local calendar, matching how
  the other clients treat picked dates.

## CI workflow — what Ajay needs to change later (do not edit for him)

The workflow file `.github/workflows/ios-testflight.yml` can only be edited
by Ajay on the GitHub website. To build this project instead of the
Capacitor one, the file needs, in order:

1. `runs-on: macos-26` — already set (Xcode 26 / iOS 26 SDK, required by
   App Store Connect since the build 31 rejection).
2. Remove the Node/Capacitor steps entirely: no `setup-node`, no `npm ci`,
   no `npm run build`, no `cap sync`, and no "Restore binary assets" step
   (there are no .b64 sidecars in this project; the icon is a real PNG).
3. Keep, unchanged, the steps that: write the App Store Connect API key to
   `~/private_keys`, and "Install signing assets (manual signing)" — the
   keychain creation, the legacy-format .p12 import, the provisioning
   profile install, and `security find-identity` — driven by the same three
   secrets (CERT_P12_BASE64, CERT_P12_PASSWORD, PROFILE_BASE64).
4. Archive step becomes (build number = workflow run number, as today):
   ```
   xcodebuild archive \
     -project ReadingPeeps.xcodeproj \
     -scheme ReadingPeeps \
     -configuration Release \
     -destination 'generic/platform=iOS' \
     -archivePath $RUNNER_TEMP/ReadingPeeps.xcarchive \
     CURRENT_PROJECT_VERSION=${{ github.run_number }}
   ```
   No signing overrides on the command line: the project's Release config
   already carries Manual signing, the Apple Distribution identity, and the
   "Reading Peeps App Store" profile specifier on the app target.
   The checked-out path prefix changes: this project lives wherever Ajay
   places it in the repo (if it goes to `native-swift/`, prefix the
   `-project` path with that folder).
5. Export step: `xcodebuild -exportArchive` with the same manual-signing
   ExportOptions.plist approach as the current native/ci/ExportOptions.plist
   (signingStyle manual, profile mapping for com.ajayrnair.readingpeeps),
   then the same altool upload step with the ASC API key.
6. Upload path: the exported .ipa name follows the scheme/product
   (ReadingPeeps.ipa); adjust the upload step's file path if it hardcodes
   the old name.
7. Trigger paths: swap `native/**` for the new project folder so pushes to
   the Ionic project stop triggering iOS builds once this app takes over.

After the workflow change, the first run is the first real compile of this
codebase: watch the Archive step log for Swift errors, fix, re-push.
Once a build uploads, it needs no export-compliance step (declared in
Info.plist); assign it to the Internal Testers group in App Store Connect
(the API route used for build 31 works: create/assign via the betaGroups
endpoints with the "Hazel" API key).

## Correction (Nov 10, after first push attempt)
The repo push tool accepts UTF-8 text only, so the app icon could NOT be
pushed as a real PNG. The repo therefore stores it as a line-wrapped base64
sidecar (AppIcon-512@2x.png.b64, verified: openssl decode is byte-identical),
and the SwiftUI workflow gains one step right after checkout that decodes
every .b64 under native-swift/ back into place. The local project keeps the
real PNG.
