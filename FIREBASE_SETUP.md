# Folio Firebase setup

Folio is a static browser app. Guest reading, the bundled catalog, and the local library work without Firebase. The service loads `firebase-config.json` first; if it is missing, it returns `configured: false` and does not download the SDK or simulate authentication. Firebase modules are pinned to the official gstatic modular SDK **13.0.0**. See [Firebase setup](https://firebase.google.com/docs/web/setup) and [release notes](https://firebase.google.com/support/release-notes/js).

## Connect the project

1. Select Firebase project **`xilo-web-systems`** and its **Folio** Web app. Use its public configuration in root-level `firebase-config.json`, following `firebase-config.example.json`. This browser configuration is public project identification; never put service-account JSON, private keys, or Admin SDK credentials here.
2. **Email/Password** sign-in is enabled, but the shared project restricts new accounts to administrators. Keep `"emailSignUpEnabled": false` in public config: this removes self-registration from Folio and rejects direct signup calls before a credential request. Existing-account sign-in and reset remain available, with an “Accounts are managed by Xilo Web Systems.” note. Do not relax the shared project's account-creation policy. Google is optional and currently absent: keep `"googleSignInEnabled": false` to hide its buttons. Before enabling that flag, configure Google's provider and support email. Both omitted flags default to `true` for backwards compatibility. Under **Authentication → Settings → Authorized domains**, add/verify **`xilo-folio.web.app`**, the actual Firebase auth domain, and any connected custom hostname. For local development, explicitly add `localhost` if needed. See [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin) and [authorized domain guidance](https://firebase.google.com/docs/auth/faq-and-troubleshooting).
3. The project's default **Cloud Firestore** database is shared with another application. **Never deploy the standalone `firestore.rules` template over `xilo-web-systems`' existing policy.** An authorized administrator must add its `/folioUsers/{uid}` and `/folioCatalog/{bookId}` match sections and `folio`-prefixed helper functions to the current rules while retaining every existing application rule. The template's catch-all denial is for standalone policy use, not a replacement shared-project policy. Main hosting configuration intentionally does not deploy Firestore policies. All Folio reads/writes and the seed tool use only these dedicated collections.

4. Build and publish the static site with **Firebase Hosting**. The build copies the actual public `firebase-config.json` into `dist/`; changing the source config requires rebuilding before deployment. `firebase.json` sets `hosting.public` to `dist`, so source files, QA output, setup tools, and documentation are not uploaded:

   ```sh
   npm run build
   npx firebase-tools deploy --only hosting:folio --project xilo-web-systems
   ```

   The Firebase CLI needs your authorized access to the intended project. These commands are setup instructions, not a record of deployment. The build prepares browser files only and does not read or update another hosting provider's metadata.

5. Serve the app over HTTP(S), then verify real email sign-up/sign-in, reset email, library sync across two browser sessions, sign-out, and reading-position sync. If Google is enabled later, verify its popup flow too. The configured `authDomain` normally remains your Firebase-provided domain. If changing it to a custom auth domain, follow [Firebase’s auth-domain instructions](https://firebase.google.com/docs/auth/web/google-signin#customizing-the-redirect-domain-for-google-sign-in), including its OAuth `__/auth/handler` URI.

## Data and service contract

- `/folioCatalog/{bookId}`: public reads only for documents with `published: true`. Browser writes are denied. Create/edit catalog entries with the authorized Firebase console or a trusted Admin SDK process. Catalog entries use the app’s book fields (`title`, `author`, `genre`, `kind`, `description`, `pages`, and reading content as supported by the UI). `id` is always taken from the document ID. An empty cloud catalog lets the UI retain its bundled books.
- `/folioUsers/{uid}/library/{bookId}`: only that authenticated UID may read/write/delete. Allowed metadata: `title` (200 chars), `author` (120), `genre`/`kind` (80 each). `bookId` matches the document ID; `addedAt` is immutable; timestamps use the server clock.
- `/folioUsers/{uid}/progress/{bookId}`: only that UID may access it. Stores `wordOffset` (integer 0–10,000,000), `fraction` (0–1), `clientUpdatedAt` (original local epoch milliseconds), and server `updatedAt`. Rules reject unknown fields and invalid ranges/types. See [field validation](https://firebase.google.com/docs/firestore/security/rules-fields).
- `/folioUsers/{uid}/publications/{bookId}`: the author's head for each published book. It holds the book's metadata (`title`, `author`, `genre`, `kind`, `kicker`, `description`, `category`, `priceCents`), `shareToken`, `publishedAt`, `updatedAt`, `revision`, `partCount`, `contentBytes`, `chapterCount` and `wordCount`. The service generates `b-UUIDv4` IDs and 256-bit random share tokens. Only that author can read or list these records. The author can edit a book: each edit rewrites both heads and every part in one request, raises `revision` by exactly one, sets `updatedAt` to the server time, and keeps `bookId`, `ownerUid`, `shareToken` and `publishedAt`. Books cannot be deleted.
- `/folioCatalog/{bookId}/shares/{token}`: the link head, with the same fields as the author head except `shareToken`. Only exact document gets are public; collection listing is denied. Creating or editing it requires the signed-in owner, a matching author head in the same request, every part named by `partCount` at the head's `revision` holding exactly `contentBytes` UTF-8 bytes together, and no part at or above `partCount`. Creating one also requires creating the book's binding in the same request, so a book ID has exactly one link. No published parent catalog document is created, so these books remain outside Discover. Anyone with the complete capability link may retrieve the book and forward the link.
- `/folioCatalog/{bookId}/shares/{token}/parts/{0-5}`: the manuscript, stored once. `JSON.stringify(chapters)` is cut on code-point boundaries into at most 6 parts of at most 1,000,000 UTF-8 bytes, each `{bookId, ownerUid, revision, index, text}`; joining parts `0` to `partCount - 1` gives the JSON back. Anyone with the exact link may get a part, and listing is denied. Only the owner can write or delete parts, and only in the same request as a head edit; deletes must be at or above the new `partCount`, and every part at or above it must be gone after the request, so trimmed text is never left readable. The limits shared by the editor, the service and the rules live in `js/publication-limits.js`: 5 MB (5,000,000 bytes of chapter JSON), 1,000 chapters, 20,000 paragraphs per chapter and 100,000 characters per paragraph.
- `/folioCatalog/{bookId}/binding/owner`: `{ownerUid, shareToken}`, binding a book ID to its first link. It is created with the first publish, or by the owner of an existing link that has none, and can never be read, changed or deleted from a browser. Without it, anyone who saw a link could add their own edition under the same book ID. Books published before bindings existed need the backfill described under “Releasing the publication rules”; the service also binds a book on its first, migrating edit.
- Books published before editing existed keep their chapters inline as `contentJson` in both heads and have no `revision`. They stay readable and count as revision 0. Their first edit removes `contentJson` from both heads, writes the parts and sets revision 1. New books cannot use the inline format.
- `/folioUsers/{uid}/owned/{bookId}`: immutable shared-book ownership, created only by that UID after validating the existing link head (`/folioCatalog/{bookId}/shares/{token}`). Stores the capability token so a fresh device can resolve the full book. Invalid links cannot create claims. Purchase and subscription entitlements remain local until a payment processor is connected.

Publication exports are `publishBook(uid, input)`, `updateBook(uid, bookId, input, {expectedRevision})`, `getSharedBook(bookId, token)`, `getBookContent(bookId, token)`, `watchPublications(uid, callback)`, `getPublicationShare(uid, bookId)`, `claimSharedBook(uid, bookId, token)`, and `watchOwnedBooks(uid, callback)`. Only `publishBook`, `updateBook` and `getBookContent` return chapters. Link lookups, claims and both watchers return metadata with `revision`, `chapterCount`, `wordCount`, `pages`, `contentBytes` and millisecond `publishedAt`/`updatedAt`; private publication and owned-book results also include the share token. `getBookContent` reads the link head and its parts and accepts them only when every part carries the head's revision, retrying if an edit lands in between. `updateBook` rejects with `folio/edit-conflict` when the book has changed since `expectedRevision`, including when the rules refuse a commit that lost that race. All watches use the same error and unsubscribe conventions as library watches.

`js/firebase-service.js` exports `initFirebase`, `subscribeAuth`, `signUp`, `signIn`, `signInWithGoogle`, `sendPasswordReset`, `signOut`, `watchLibrary`, `watchReadingProgress`, `saveLibraryBook`, `removeLibraryBook`, `saveReadingProgress`, `getCatalog`, `watchCatalog`, `authErrorMessage`, `mergeReadingProgress`, and the injectable `createFirebaseService` factory.

- `initFirebase()` resolves `{configured, user, googleSignInEnabled, emailSignUpEnabled, error?}`, including on repeat calls. Both flags default to `true` unless config contains the boolean `false`. Disabled Google rejects direct popup attempts. Disabled signup rejects with `auth/admin-restricted-operation` and “New accounts are created by your administrator. Sign in with an existing account.” before a signup request. Sign-in/reset stay available. Auth methods return a real Firebase User (reset/sign-out resolve void), and failures retain Firebase’s `code`.
- `subscribeAuth(callback)` calls `callback(userOrNull)`. All watch methods synchronously return an unsubscribe function, including when initialization is pending.
- `watchLibrary(uid, callback)` calls `callback(items, null)` with an array of `{id, bookId, title?, author?, genre?, kind?, addedAt, savedAt, updatedAt}`. Dates are milliseconds.
- `watchReadingProgress(uid, callback)` calls `callback({[bookId]: {wordOffset, fraction, updatedAt}}, null)`. On a watch failure the first argument is **null**, and the second is the mapped error; do not replace existing local data with an empty array/map. User watches stop automatically when accounts change.
- Catalog watchers use the same `(items, error)` convention. `getCatalog()` resolves an array. Catalog queries filter `published == true` and return at most 200 entries; user queries return at most 500 records. These use automatic single-field indexes, so no composite indexes are required.
- Merge guest and account library IDs as a union on first sync. Use `mergeReadingProgress(guest, cloud)` per book and pass the chosen **original `updatedAt`** to `saveReadingProgress`. The service transaction refuses older positions and breaks timestamp ties by furthest position. New reading actions may omit `updatedAt`; they receive the current local time, allowing deliberate backward reading. Never clear the guest cache before successful sync. Keep guest and per-account local caches separate.
- Library adds and progress writes use [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions). They fail offline; retain local changes and retry on reconnect. No background queue is invented by the service. Firestore uses its default memory cache; the UI owns device-local guest/account caching. Default Auth persistence is local, with memory-only fallback when browser storage is blocked.

### Releasing the publication rules

The publication rules stay within Firestore's rule read limits at the maximum book size: creating a link head reads the author head, the binding before and after the request, and the 6 part slots (9 calls, limit 10); editing one reads the author head and the 6 part slots (7). A whole publish reads 9 distinct documents and an edit 8, and even without caching repeated reads a publish makes at most 18 calls (limit 20).

For a shared policy that has no Folio publication block yet, prepare the additive block with `node scripts/prepare-publication-rules.mjs --active ACTIVE.rules --output MERGED.rules`. It refuses a policy that already has one.

To replace a released block, such as the one released at commit `13fed3b`:

1. Fresh-read the active policy for `xilo-web-systems` (Firebase console → Firestore → Rules, or an authorized CLI session) and save it unchanged as `ACTIVE.rules`.
2. Prepare the replacement. The hash is the reviewed Folio block from `13fed3b`, measured from the BEGIN marker line through the END marker with line endings read as LF:

   ```sh
   node scripts/prepare-publication-rules.mjs --replace \
     --expect-old-sha256 86281897fa5e09d21eb02e981355fd0d80ab9a1d46ea292bc0f59849aa71af86 \
     --active ACTIVE.rules --output MERGED.rules
   ```

   The script replaces only the text between the exact `FOLIO PUBLICATIONS BEGIN`/`END` markers. It refuses when the active block's hash differs (for example after a hand edit), when the markers are missing, repeated or not on their own lines, when the block mixes line endings, when Folio names or any function the new block defines appear outside the block, or when the file is not UTF-8. It keeps the policy's line endings, proves that every byte outside the block is unchanged, never overwrites `--output`, and prints the old and new block sizes and hashes. It never authenticates or deploys.
3. Review the diff between `ACTIVE.rules` and `MERGED.rules`; only the Folio block may change. Then run the rules suite against the merged policy: `FIREBASE_CLI=PATH_TO_FIREBASE_CLI FOLIO_RULES_FILE=MERGED.rules npm run check:rules`.
4. Release `MERGED.rules` as the complete policy, then fresh-read the released source and compare it byte for byte with `MERGED.rules`. Never release the standalone template over the shared project.
5. Release the rules immediately before the app build that edits books. The new rules refuse the previous build's inline publishing, and the previous rules refuse every revision and part write. Existing books stay readable under both.
6. Bind every existing book to its link, once just before releasing the rules and again right after (the second run binds anything the previous build published in between; after the release, only bound books can be published). The backfill is an Admin SDK tool that reads each `/folioUsers/{uid}/publications/{bookId}`, checks that its link head exists with the same owner, and creates the missing `/folioCatalog/{bookId}/binding/owner` documents; it never changes a book and skips anything inconsistent, including a book ID listed by two accounts:

   ```sh
   npm install --no-save --package-lock=false firebase-admin
   node scripts/bind-publications.mjs --project xilo-web-systems --check
   node scripts/bind-publications.mjs --project xilo-web-systems --apply
   ```

   Like the catalog seed, it uses Application Default Credentials for the explicitly named project. Until a book is bound, someone who has its link could still add their own link under its ID; the app never lets such a link replace a book a reader already has.

`npm run check:rules` is opt-in. It runs only when `FIREBASE_CLI` points at a firebase-tools binary (Java is required). It starts a throwaway Firestore emulator on free local ports with `demo-*` project IDs, an empty CLI configuration directory and no Google credentials, loads `firestore.rules` (or `FOLIO_RULES_FILE`), and talks to it over REST with unsigned emulator tokens. It covers a 5 MB publish at the six-part maximum, growing and shrinking edits with part deletion, legacy migration, stale and cross-account edits, link-only reads, oversize parts, the library, progress, owned and catalog rules, and a compile-and-behaviour check of `--replace` output built from the `13fed3b` block.

## Local checks

### Optional catalog seed

`scripts/seed-firestore.mjs` reads the exported books and **all their chapters** from `js/books.js`. Its default mode only validates data and prints a plan; it does not load an SDK, inspect credentials, or contact a project:

```sh
node scripts/seed-firestore.mjs --project YOUR_PROJECT_ID --dry-run
```

To publish those catalog entries, optionally install the Admin SDK without changing dependency inputs:

```sh
npm install --no-save --package-lock=false firebase-admin
node scripts/seed-firestore.mjs --project YOUR_PROJECT_ID --apply
```

The apply command uses `applicationDefault()` with the explicitly selected project. Run it only from an authorized local/admin environment with existing **Application Default Credentials** and Firestore IAM write access. Firebase CLI login and browser web config are not substitutes for ADC. The script never accepts a credential-file argument or uploads a service-account key; keep any administrator credentials outside this website and its deployment package. See [Firebase Admin initialization](https://firebase.google.com/docs/admin/setup).

Apply upserts the bundled book IDs in **`folioCatalog`** with `published: true`, full chapter arrays, and server `updatedAt`. Reruns refresh those fields and preserve unrelated document fields, other catalog documents, and all user data. Before importing the Admin SDK, it validates IDs/content and calculates document storage size with 4 KiB headroom below Firestore’s [1 MiB document limit](https://firebase.google.com/docs/firestore/quotas), following its [storage-size calculation](https://firebase.google.com/docs/firestore/storage-size). Writes use bounded batches. Local validation of this tool is not live-project verification.

### Service tests

Run dependency-free adapter tests with:

```sh
node --experimental-default-type=module --test tests/firebase-service.test.mjs
```

For manual integration against emulators, create an emulator-only local config that explicitly references the standalone `firestore.rules` and defines the Auth/Firestore ports (9099/8080). Pass it to `npx firebase-tools emulators:start --only auth,firestore --project demo-folio --config PATH_TO_LOCAL_EMULATOR_CONFIG`. Do not add a Firestore deployment section to the shared-project hosting config. Serve the website on localhost and use an explicitly local web config with project ID `demo-folio`, its string fields populated with local demo values, and `"useEmulators": true`. That option connects only on localhost/loopback and is rejected on a production hostname. Emulator accounts and data are not real project accounts. No emulator or live-project verification is implied by the adapter tests.

Before production, verify cross-account denial and invalid-field/range denial against the deployed rules or emulators. The service’s adapter tests cover client behavior; they do not execute the Firestore rules engine. `npm run check:rules` does (see “Releasing the publication rules”). Firebase Hosting publishes only `dist/`, and its config response is `no-store`. See [Hosting configuration](https://firebase.google.com/docs/hosting/full-config).
