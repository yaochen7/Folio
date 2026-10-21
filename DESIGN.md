# Folio design implementation

The interface follows the supplied **Xilo Folio Apple redesign** archive. Its home page establishes the sunset palette, white system typography, orange primary buttons, floating pill header, and six illustrated covers. Discover filters the catalog by Fiction, Ideas, or Escape. Collection cards lead to those filtered shelves.

Each book has a large cover, its own ambient color, edition details, a Want to Read action, and a paper excerpt with a Newsreader drop cap. The full reader uses framed pages over a blurred backdrop, theme swatches, text-size controls, and bottom page navigation. The existing continuous WebGL page mesh handles the page turns. The cover opening and pointer tilt honor reduced-motion preferences.

The supplied prototype is a visual reference. The application retains its Firebase Authentication and Firestore adapters, separate guest/account caches, saved-book mutations, canonical word offsets, complete three-chapter stories, keyboard navigation, and WebGL fallbacks. Prototype sign-in placeholders connect to the real account dialog; Want to Read connects to the real saved library. Catalog search and the saved library remain accessible from the footer, and the library invitation opens the guest library.

Newsreader is hosted locally with its SIL Open Font License. There is no prototype runtime or third-party UI framework in the production build. Small screens adapt the header, filters, shelves, and reader controls to preserve accessible navigation and prevent horizontal overflow.

Changes are developed on `design/claude-redesign`. Firebase Hosting remains the deployment destination in project `xilo-web-systems`, target `folio`, site `xilo-folio`. The shared project's authentication settings, Firestore data, and policies remain outside this UI change.
