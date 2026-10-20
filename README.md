# Folio

Folio implements the supplied “Xilo Folio Apple redesign”: a sunset background, floating glass navigation, a six-cover hero shelf, genre filters, collections, and illustrated book pages. The site includes catalog search, a saved library, Firebase account forms, and a paginated reader.

The framed reader uses locally hosted Newsreader typography, Paper/Sepia/Night swatches, text-size controls, chapter navigation, book search, and a progress slider. It supports a continuous GPU page mesh with smooth shading, finger-tracked curls, momentum-based release, touch swipes, page-edge taps, keyboard navigation, chapter contents, font-size changes, paper/sepia/night themes, and responsive single-page/two-page reading. Reading positions use a word offset so changing the layout keeps the same passage in view. Reduced-motion preferences remove the 3D animation.

The six bundled titles contain original illustrative stories, each with three chapters. They are available for guest reading. Guest libraries and progress stay on the device; configured Firebase accounts use private Firestore library/progress records.

Folio's floating navigation, shelves, collection cards, and account controls use the translucent glass treatment in the supplied design. Shared styles in `css/materials.css` combine a frosted fill, directional highlight, fine edge, and soft shadow. Book covers and reading pages retain solid materials.

The material follows system appearance and the reader's paper, sepia, or night theme. Browsers without backdrop-filter get solid surfaces. Reduced transparency, increased contrast, forced colors, and reduced motion receive explicit fallbacks; support for the reduced-transparency media query depends on the browser.

Newsreader is distributed under the SIL Open Font License; its license is included in `fonts/Newsreader-LICENSE.txt`. The design is implemented with native HTML, CSS, and JavaScript modules. The attached prototype runtime is not required.

Live website: [xilo-folio.web.app](https://xilo-folio.web.app). It runs in Firebase project `xilo-web-systems` on the dedicated Hosting site `xilo-folio`.

## Run

Requires Node.js 20 or newer. The website has no installation or build dependencies.

```sh
npm run dev
# http://127.0.0.1:4173
npm run check
npm run build
```

The build copies browser assets into `dist/`. The project uses native JavaScript modules; Firebase downloads its official modular SDK only after a valid web configuration is present.

## Firebase

Follow [FIREBASE_SETUP.md](./FIREBASE_SETUP.md). `firebase-config.json` contains public Firebase web configuration only; service-account keys must never be placed in browser files.

Enable Email/Password authentication and authorize the deployed hostname. This shared project's accounts are administrator-managed: `emailSignUpEnabled: false` hides self-registration while retaining existing-account sign-in and password reset. It does not change project security settings. Google is optional: set `googleSignInEnabled` to `false` to hide its buttons; enable the Google provider before setting that flag to `true`. Both omitted flags default to `true` for existing configurations. The UI does not simulate successful authentication when project configuration is missing.

Folio uses dedicated `/folioCatalog` and `/folioUsers/{uid}` collections. An authorized admin can publish catalog entries; browser accounts cannot modify the catalog. User library/progress data is restricted to the authenticated UID. The `firestore.rules` file is a standalone Folio template: in this shared project, merge its Folio sections into the current policy without replacing other applications' rules. Local guest and account caches are separate. Failed cloud mutations remain local for retry, and imported reading positions retain their original timestamp so older data cannot replace newer cloud progress.

## Verification

`npm run check` checks source syntax, configuration, and Firebase adapter behavior. `TEST_PLAN.md` describes browser journeys. Adapter checks do not verify deployed Firestore rules or real authentication providers. Live Firebase verification requires the project configuration and authorized access.

## Hosting

Folio targets **Firebase Hosting** in **Xilo Web Systems** (`xilo-web-systems`). The checked-in `.firebaserc` maps target `folio` to site `xilo-folio`. Build before deployment:

```sh
npm run build
npx firebase-tools deploy --only hosting:folio --project xilo-web-systems
```

`firebase.json` publishes only `dist/`, containing the browser assets and public Firebase web configuration. Source files, QA output, setup scripts, and documentation stay outside the hosting directory. The build does not modify hosting-provider metadata. Configure Firebase Authentication's authorized domains for the actual Firebase Hosting hostname and any connected custom domain; see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).
