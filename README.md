# Folio

Folio implements the supplied “Xilo Folio Apple redesign”: a sunset background, floating glass navigation, a six-cover hero shelf, genre filters, collections, and illustrated book pages. The site includes catalog search, a saved library, Firebase account forms, and a paginated reader.

The framed reader uses locally hosted Newsreader typography, Paper/Sepia/Night swatches, text-size controls, chapter navigation, book search, and a progress slider. It supports a continuous GPU page mesh with smooth shading, finger-tracked curls, momentum-based release, touch swipes, page-edge taps, keyboard navigation, chapter contents, font-size changes, paper/sepia/night themes, and responsive single-page/two-page reading. Reading positions use a word offset so changing the layout keeps the same passage in view. Reduced-motion preferences remove the 3D animation.

One reading-tools button opens Contents, Search this book, Themes & text, previous/next page, and Close reader. The controls use `Liquid` and `Liquid.Item` from Libraries.dev's `liquid-gooey` in a small React root. The shared SVG surface merges as the pieces move while their labels remain sharp. Escape and outside taps dismiss the controls; collapsed actions are inert. The effect unmounts when the reader closes or the document is hidden, and reduced motion removes the expansion animation.

The six bundled titles contain original illustrative stories, each with three chapters. Chapter One is free; the remaining chapters require an active Folio Plus subscription or ownership of that book. Guest libraries and progress stay on the device; configured Firebase accounts use private Firestore library/progress records.

## Accounts, purchases, and publishing

`#account` shows the current Firebase identity or guest state, saved/in-progress/finished counts, recent books, owned books, published books, sync status, password reset, and membership management. The header and footer both link to it. `#publish` lets a signed-in author supply a title, author, description, collection, book price, cover, and manuscript. Plain text can be pasted or imported; `#` or `##` headings start chapters. Books support up to 1,000 chapters and 5 MB of text, measured as the UTF-8 bytes of the chapters' JSON, with a price from $0.99 through $999.99. A size line under the manuscript shows how much of the 5 MB is used and blocks publishing above it; the field has no character limit, so typing never stops after a large import. Drafts stay on the author's device in IndexedDB.

`#edit/<bookId>` lets the author change every part of a published book: title, author, description, collection, price, cover, and manuscript. It opens from Edit in the account's published-books list, Edit book on the book's page, and Edit this book after publishing. Signed out, the page asks the author to sign in; any other account, and any unknown book, gets the not-found page. The form is the publishing form with the published edition filled in, the same checks, and the book's unchanged link. Saving keeps the book ID and link, and readers get the new edition the next time they open the book. Each save names the revision it started from; if the book was saved somewhere else in the meantime, nothing is overwritten unseen: the author loads the latest edition with their own changes put back on top, or discards their changes after confirming. Unsaved changes are kept on the device separately from the new-book draft, restored on the next visit (on top of a newer edition, field by field, when there is one), and can be discarded. Close leaves the form and keeps them. A tab that still shows a form writes it back when it is left, hidden or closed, so a save or publish in another tab never loses its text. Saving changes the form in place, so a multi-megabyte manuscript keeps its caret and scroll position, and a failed save says the changes weren’t saved.

Folio Plus costs **$7.99 USD/month** or **$59.99 USD/year**. Individual catalog books cost **$4.99 USD** unless a price is supplied. Checkout has a single confirmation flow with no outcome selector and collects no payment credentials. No payment processor is connected yet: after a few seconds of processing, checkout reports “Payment processor cannot be reached.”, charges nothing, and grants no access. The service's `processor` option accepts a real processor; it supports approval, decline, errors, and cancellation without exposing development controls in the customer interface. Successful purchases persist independently from subscriptions and do not expire.

`js/membership.js` stores membership and purchase entitlements per account and device. It reads the prior membership key for compatibility; new records use a clean versioned shape. Memberships and purchases are never imported from guests or shared across identities. Account switching aborts an unfinished checkout. Expiry and cross-tab storage changes update reader access.

Publishing atomically writes a private author head at `/folioUsers/{uid}/publications/{bookId}`, a link head at `/folioCatalog/{bookId}/shares/{token}`, and the manuscript once, as up to six parts of at most 1,000,000 bytes under that link head. The heads hold only the book's details, sizes, and a revision number; the parts carry the same revision, and the reader accepts a book only when every part matches its head. An edit rewrites both heads and the parts in one transaction with the next revision. Books published before parts existed keep their inline text, stay readable, and move to parts on their first edit. A generated UUID identifies the book; a 256-bit random token protects its unlisted link. Share documents allow exact gets and deny listing. Published books do not appear in the public Discover catalog. Lists and links read only the heads; a book's text is downloaded when it is opened and cached in IndexedDB by revision.

A valid `#shared/<bookId>/<token>` link retrieves and verifies the link head before granting ownership, then loads the text. Guests retain the book, ownership, and reading place on that device. Signed-in readers also claim a private `/folioUsers/{uid}/owned/{bookId}` record so the book opens on other devices. Guest shared ownership can be claimed when that guest signs in; signing from one account into another never transfers it. The author can recover links from their published-books list. Anyone who has a link can forward it and grant the same full access.

The reader paginates only Chapter One for free readers. Contents marks remaining chapters as locked, search excludes them, the progress slider stops at the preview boundary, and swipes/keyboard/Next/Continue open the paywall. Buying a book, subscribing, or opening its valid share link unlocks all chapters while retaining the word-based reading place.

The paid access gate is client-side until a payment processor is connected. Before taking real payments, replace the processor with a server-created checkout, verify payment webhooks, store server-owned paid entitlements, and serve protected paid chapters after checking those entitlements. Device-local records are not proof of payment. Shared books intentionally expose the complete book to holders of the link.

Folio's floating navigation, shelves, collection cards, and account controls use the translucent glass treatment in the supplied design. Shared styles in `css/materials.css` combine a frosted fill, directional highlight, fine edge, and soft shadow. Book covers and reading pages retain solid materials.

The material follows system appearance and the reader's paper, sepia, or night theme. Browsers without backdrop-filter get solid surfaces. Reduced transparency, increased contrast, forced colors, and reduced motion receive explicit fallbacks; support for the reduced-transparency media query depends on the browser.

Newsreader is distributed under the SIL Open Font License; its license is included in `fonts/Newsreader-LICENSE.txt`. The design is implemented with native HTML, CSS, and JavaScript modules. The attached prototype runtime is not required.

Live website: [xilo-folio.web.app](https://xilo-folio.web.app). It runs in Firebase project `xilo-web-systems` on the dedicated Hosting site `xilo-folio`.

## Run

Requires Node.js 20 or newer. Install the locked dependencies before running or building.

```sh
npm ci
npm run dev
# http://127.0.0.1:4173
npm run check
npm run build
```

The build bundles `src/reader-controls.jsx` locally with React and `liquid-gooey`, then copies browser assets into `dist/`. Generated control assets are ignored by Git and rebuilt by `dev`, `check`, and `build`; `npm run build:controls` rebuilds them after component edits. Runtime licenses ship beside the bundle. Firebase downloads its official modular SDK only after a valid web configuration is present.

## Firebase

Follow [FIREBASE_SETUP.md](./FIREBASE_SETUP.md). `firebase-config.json` contains public Firebase web configuration only; service-account keys must never be placed in browser files.

Enable Email/Password authentication and authorize the deployed hostname. This shared project's accounts are administrator-managed: `emailSignUpEnabled: false` hides self-registration while retaining existing-account sign-in and password reset. It does not change project security settings. Google is optional: set `googleSignInEnabled` to `false` to hide its buttons; enable the Google provider before setting that flag to `true`. Both omitted flags default to `true` for existing configurations. The UI does not simulate successful authentication when project configuration is missing.

Folio uses dedicated `/folioCatalog` and `/folioUsers/{uid}` collections. An authorized admin can publish public catalog entries; signed-in authors can create and edit only their own unlisted publications, and every edit must advance the revision. User library/progress data is restricted to the authenticated UID. The `firestore.rules` file is a standalone Folio template: in this shared project, merge its Folio sections into the current policy without replacing other applications' rules. Local guest and account caches are separate. Failed cloud mutations remain local for retry, and imported reading positions retain their original timestamp so older data cannot replace newer cloud progress.

## Verification

`npm run check` checks source syntax, configuration, and Firebase adapter behavior. `TEST_PLAN.md` describes browser journeys. Adapter checks do not verify deployed Firestore rules or real authentication providers. Live Firebase verification requires the project configuration and authorized access.

With the dev server running and Playwright installed, `npm run check:navigation` exercises animated book returns, restored shelf position and focus, browser Back/Forward, search, interrupted navigation, and reduced motion at phone and desktop widths. It uses isolated guest contexts with Firebase configuration disabled. Set `FOLIO_TEST_URL` to test another server, or `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE` to use an existing Playwright/Chromium installation.

`npm run check:reader` covers the single-button reader, liquid expansion, keyboard access, contents/search/appearance, preserved reading position, reduced motion, and closing/reopening. It uses the same browser configuration variables and isolated guest contexts.

`npm run check:membership` covers account layouts at 320/390/1440px, locked contents and preview-only search, checkout progress and the unreachable-processor error, retained access and ownership, renewal controls, reload, abandoning processing, a real touch swipe at the boundary, and account isolation using a test-only Firebase module. It never creates real accounts or charges a payment method. `npm run check` also includes membership lifecycle tests for isolation, decline, abort, expiry, calendar dates, unavailable storage, and publication parsing.

`npm run check:publishing` covers author publication and link recovery, guest full-book access and reload, signed ownership on a fresh device, account isolation, claiming guest shares on sign-in, invalid-link rejection, multi-megabyte manuscripts, and editing: opening the prefilled form from each entry point, saving a new edition under the same link, refusing a stale edit and keeping the author's changes, restoring and discarding unsaved changes, drafts across two tabs, failed and abandoned saves, the sign-in page for signed-out visitors and the not-found page for other accounts, and a link that reuses a known book ID. Firebase module fixtures keep these browser journeys out of live data. The adapter checks separately cover atomic publication and edits, immutable claims, exact-get capability access, author privacy, list denial, and cross-account rejection. `npm run check:rules` runs the publication rules in a local Firestore emulator; see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).

## Hosting

Folio targets **Firebase Hosting** in **Xilo Web Systems** (`xilo-web-systems`). The checked-in `.firebaserc` maps target `folio` to site `xilo-folio`. Build before deployment:

```sh
npm run build
npx firebase-tools deploy --only hosting:folio --project xilo-web-systems
```

`firebase.json` publishes only `dist/`, containing the browser assets and public Firebase web configuration. Source files, QA output, setup scripts, and documentation stay outside the hosting directory. The build does not modify hosting-provider metadata. Configure Firebase Authentication's authorized domains for the actual Firebase Hosting hostname and any connected custom domain; see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).
