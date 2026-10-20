# Folio — Tahoe / Golden Gate direction

This branch is a working design preview, prepared for visual review before a new Hosting release.

The floating Liquid Glass pill returns around the Folio header, with a translucent fill, fine rim, soft highlight, and rounded selected destination. It carries the lowercase wordmark, centered text navigation, search, and sign-in controls. On phones the pill stays a single compact row, while the three destinations remain in the labeled bottom tab bar. The glass sits in a decorative sibling so it cannot trap viewport-fixed phone navigation. System contrast and reduced-transparency settings use solid materials.

The editorial feature and original Folio covers retain the identity of the original Gallery. A restrained Books-inspired orange marks the primary reading action and current navigation destination. The whole interface supports light and dark appearances. Footer content is reduced to a quiet single line on phones.

Search, guest saves, account dialogs, Firebase integration, reading positions, and page-turn gestures remain part of the working app. This is a web interpretation of Apple's design language, without imitation operating-system window buttons or invented product features.

References:
- https://www.apple.com/os/macos/ — Golden Gate design refinements: toolbars, sidebars, contrast, readability.
- https://developer.apple.com/design/human-interface-guidelines/sidebars — adaptive navigation.
- https://developer.apple.com/videos/play/wwdc2025/219/ — material hierarchy.

The reader uses a continuous 24,576-triangle paper mesh, smooth interpolated lighting, and cached high-resolution page textures. Drag direction follows the gesture, including swipes that start near the opposite edge. Release carries measured input velocity into a critically damped settle; unfinished or cancelled pulls never advance the saved reading position. Reduced motion avoids the 3D turn, and a flat slide keeps reading usable without WebGL.
