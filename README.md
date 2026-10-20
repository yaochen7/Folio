# Folio

Folio implements the supplied “Xilo Folio Apple redesign”: a sunset background, floating glass navigation, a six-cover hero shelf, genre filters, collections, and illustrated book pages. The site includes catalog search, a saved library, Firebase account forms, and a paginated reader.

The framed reader uses locally hosted Newsreader typography, Paper/Sepia/Night swatches, text-size controls, chapter navigation, book search, and a progress slider. It supports a continuous GPU page mesh with smooth shading, finger-tracked curls, momentum-based release, touch swipes, page-edge taps, keyboard navigation, chapter contents, font-size changes, paper/sepia/night themes, and responsive single-page/two-page reading. Reading positions use a word offset so changing the layout keeps the same passage in view. Reduced-motion preferences remove the 3D animation.

One reading-tools button opens Contents, Search Book, Themes & Text, previous/next page, and Close reader. The controls use `Liquid` and `Liquid.Item` from Libraries.dev's `liquid-gooey` in a small React root. The shared SVG surface merges as the pieces move while their labels remain sharp. Escape and outside taps dismiss the controls; collapsed actions are inert. The effect unmounts when the reader closes or the document is hidden, and reduced motion removes the expansion animation.

The six bundled titles contain original illustrative stories, each with three chapters. Chapter One is free; the remaining chapters require Folio Plus demo access. Guest libraries and progress stay on the device; configured Firebase accounts use private Firestore library/progress records.

## Accounts and mock subscriptions

`#account` shows the current Firebase identity (or an honest guest state), saved/in-progress/finished counts, recent books, sync status, password reset, and membership management. The header and footer both link to it.

Folio Plus offers demo plans at **$7.99 USD/month** and **$59.99 USD/year**. Checkout uses a fixed mock payment method, collects no card details, and supports approval, decline/retry, and abandonment during processing. Approval saves a demo receipt and resumes the next chapter. Cancelling renewal preserves access until the end of the current demo period; renewal can be resumed. Changing the plan requires another mock checkout. Nothing charges or automatically bills a real payment method.

`js/membership.js` stores demo memberships under `folio.demo-membership.v1.user.<encoded UID>` (or `guest`). Memberships remain local to that account and device; they are never imported from guests or shared across identities. Account switching aborts an unfinished checkout. Expiry and cross-tab storage changes update reader access. No Firebase Auth settings or Firestore policies are changed for the demo.

The reader paginates only Chapter One for free readers. Contents marks the remaining chapters as locked, search excludes them, the progress slider stops at the preview boundary, and swipes/keyboard/Next/Continue open the paywall. Unlocking retains the word-based reading position. Browser tests for the complete reader use a demo subscription fixture; membership tests exercise the actual free-to-unlocked journey.

This is a **mock payment and UI access gate**, not secure paid-content delivery: the bundled book text and demo entitlement are browser-accessible. Before taking real payments, replace the simulator with a server-created checkout, verified processor webhooks and server-owned entitlements, and serve protected chapters only after checking access. Do not trust this device-local record as proof of a real payment.

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

Folio uses dedicated `/folioCatalog` and `/folioUsers/{uid}` collections. An authorized admin can publish catalog entries; browser accounts cannot modify the catalog. User library/progress data is restricted to the authenticated UID. The `firestore.rules` file is a standalone Folio template: in this shared project, merge its Folio sections into the current policy without replacing other applications' rules. Local guest and account caches are separate. Failed cloud mutations remain local for retry, and imported reading positions retain their original timestamp so older data cannot replace newer cloud progress.

## Verification

`npm run check` checks source syntax, configuration, and Firebase adapter behavior. `TEST_PLAN.md` describes browser journeys. Adapter checks do not verify deployed Firestore rules or real authentication providers. Live Firebase verification requires the project configuration and authorized access.

With the dev server running and Playwright installed, `npm run check:navigation` exercises animated book returns, restored shelf position and focus, browser Back/Forward, search, interrupted navigation, and reduced motion at phone and desktop widths. It uses isolated guest contexts with Firebase configuration disabled. Set `FOLIO_TEST_URL` to test another server, or `PLAYWRIGHT_MODULE` and `BROWSER_EXECUTABLE` to use an existing Playwright/Chromium installation.

`npm run check:reader` covers the single-button reader, liquid expansion, keyboard access, contents/search/appearance, preserved reading position, reduced motion, and closing/reopening. It uses the same browser configuration variables and isolated guest contexts.

`npm run check:membership` covers account layouts at 320/390/1440px, locked contents and preview-only search, next-chapter continuation, decline/retry, renewal controls, reload, abandoning processing, a real touch swipe at the boundary, and account isolation using a test-only Firebase module. It never creates real accounts or charges a payment method. `npm run check` also includes membership lifecycle tests for isolation, decline, abort, expiry, calendar dates, and unavailable storage.

## Hosting

Folio targets **Firebase Hosting** in **Xilo Web Systems** (`xilo-web-systems`). The checked-in `.firebaserc` maps target `folio` to site `xilo-folio`. Build before deployment:

```sh
npm run build
npx firebase-tools deploy --only hosting:folio --project xilo-web-systems
```

`firebase.json` publishes only `dist/`, containing the browser assets and public Firebase web configuration. Source files, QA output, setup scripts, and documentation stay outside the hosting directory. The build does not modify hosting-provider metadata. Configure Firebase Authentication's authorized domains for the actual Firebase Hosting hostname and any connected custom domain; see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).
