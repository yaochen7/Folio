# Folio deployment

- Use Firebase Hosting in project `xilo-web-systems`, target `folio`, site `xilo-folio`.
- Do not publish to ChatGPT Sites unless the user explicitly changes this hosting choice. `.openai/hosting.json` is historical metadata only.
- Build with `npm run build`; deploy browser assets from `dist/` using `firebase deploy --only hosting:folio --project xilo-web-systems`.
- The Firebase project hosts other applications. Preserve their Hosting sites, Auth settings, data, and Firestore policies.
- Folio owns only the `folioUsers` and `folioCatalog` Firestore collections. Merge its rule sections additively into the active shared policy; never deploy the standalone `firestore.rules` over that policy.
- Browser Firebase configuration is public. Keep administrator credentials and tokens out of source, logs, and build assets.
