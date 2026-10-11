# Interface direction and component sources

Flux uses an expressive entry composition and a compact working interface.
The supplied Daily Bloom reference informs scale, overlapping sculpture, and
color, not its flowers, content, or navigation.

## Design tokens

- Core: white `#ffffff`, plum `#40254e`, slate `#3f567f`, orchid `#d174d2`,
  coral `#e0563f`, saved-state teal `#0c806a`. Colors have separate jobs rather
  than washing every region with plum: slate navigation, neutral document
  surfaces, coral creation actions, orchid selections, and teal saved status.
- Day: neutral canvas `#f4f6f9`, white surfaces, ink `#263449`.
- Night: midnight canvas `#171e29`, surface `#242e3d`, ink `#edf2f8`.
- Functional color variants use darker coral `#b53b2b` for white button labels,
  darker orchid `#784587` for text, and light coral/orchid/slate surfaces. Night
  uses lighter accents on dark surfaces; selected text stays legible.
- Typography: Sora for expansive geometric headlines, Source Sans 3 for compact
  labels, Georgia for authored documents. Latin variable WOFF2 fonts are bundled
  locally with `next/font/local`; other scripts fall back to system fonts.
- Entry: one left-aligned scene on a neutral surface, a locally authored ribbon
  sculpture over a peach/orchid ground, and an independently usable sign-in form.
  Live draft / Checkpoint switches change both the copy and the graphic arrangement.
- Workspace: remove the redundant documents tab/header, retain a real document
  ledger, and use a quiet team rail. Original document glyphs unfold on hover or
  keyboard focus; the illustrated grid is now the default, with compact List view
  still available. Redundant per-file sharing subtitles have been removed.
  Existing checkpoint guidance contains an illustration, not an extra dashboard
  card. Mobile navigation is a disclosure instead of a full sidebar stacked above
  every page. Compact drawings live in editor identity/history controls, never
  inside authored document content.

```text
Entry
flux                                     day/night
Shared work.       flowing sculpture     sign-in form
Room to explore.                         password / action
live draft / checkpoint

Workspace
navigation | folder illustration / workspace title + actions
folder art | document search / sort                  | team
           | illustrated document grid (or list)     | checkpoint tip
```

Review before implementation: another two-column marketing layout, a stock
flower, or a mix of unrelated illustration packs would repeat the rejected
direction. The revised composition overlaps the type and a single original
sculpture, removes the floating demo card, and concentrates visual boldness on
the entry. The first revision overused plum across the working interface. The
follow-up separates color by function and adds responsive drawings inside existing
links/guidance, rather than introducing stat cards, banners, or animation on every
element. No fake statistics, unavailable destinations, or ambient loops are used.

## Original hover artwork

`apps/web/components/work-art.tsx` contains original inline SVGs, not borrowed
illustrations. Document links separate their paper layers and reveal a decorative
cursor; checkpoint guidance gathers loose pages into a saved stack. Keyboard
focus gives the same response as hover. A stable document-ID hash chooses the
color accent and stays consistent through searching, sorting, and layout changes;
these accents do not imply file categories or document content.

The same visual grammar now reaches the main interface rather than just its
right rail: `WorkspaceArtwork` opens a folder's pages in the workspace heading,
navigation, onboarding, and creation dialog; `PeopleArtwork` connects teammates
around an envelope on sign-in/invitation surfaces; `SearchArtwork` moves its lens
over a sheet in search states; `HistoryArtwork` moves a saved sheet along a short
timeline. Dialogs, editor history actions, loading/recovery screens, and history
previews use compact variants. Existing controls remain the only interaction
targets; decorations add no tab stops or competing calls to action.

Review of the previous iteration: keeping List view as the default hid almost
all the new document drawings. The illustrated grid makes the change visible
without adding a decorative banner or a second set of cards. Illustrations are
integrated into existing headings, dialog headers, and controls; the writing area
stays clear. All scenes are original inline SVGs and add no network dependency.

Only pointer/focus-triggered CSS transitions are used. Reduced-motion and coarse
pointer/touch sessions retain static illustrations, with no hover-only information
or extra tap required to open a file. The editor stays quiet; history distinguishes
named checkpoints, restored revisions, and preserved-before-restore versions by
both text/icon and restrained marker color. Decorative images are aria-hidden.

## Adapted components

Retrieved 2026-10-10. Adaptations are integrated in Flux, not offered as a reusable
component library. Preserve the accompanying license notices if redistributing.

- **React Bits SpotlightCard** — pointer-position lighting, simplified to CSS
  variables and a single overlay without ambient loops:
  https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Components/SpotlightCard/SpotlightCard.tsx
- **React Bits ClickSpark** — click-ray canvas effect, restricted to quick
  actions; adds high-DPI rendering, reduced-motion support, bounded spark counts,
  and a loop that stops when idle:
  https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Animations/ClickSpark/ClickSpark.tsx
- React Bits uses **MIT + Commons Clause**, not plain MIT. Use in an application
  is allowed; reselling/redistributing the components themselves is restricted.
  Full notice: [React Bits license](licenses/react-bits.md).
- **Magic UI AnimatedThemeToggler** — circular View Transition reveal, adapted
  to next-themes, day/night labels, motion preferences, and browser fallbacks:
  https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/animated-theme-toggler.tsx
  Full notice: [Magic UI MIT license](licenses/magic-ui.md).
- **next-themes** provides persisted/system-aware themes and cross-tab sync:
  https://github.com/pacocoursey/next-themes (MIT; installed package retains license).

## Sources added for the reference-led redesign

- **Uiverse / cssbuttons-io, calm-tiger-42**: liquid-fill button adapted to Flux
  colors, disabled states, and keyboard focus. Only this selected component is
  used; its generic selector is scoped as `.liquid-button`.
  https://uiverse.io/cssbuttons-io/calm-tiger-42
  https://github.com/uiverse-io/galaxy/blob/main/Buttons/cssbuttons-io_calm-tiger-42.html
  Full notice: [Uiverse MIT license](licenses/uiverse.md).
- **GSAP**: one coordinated headline/intro entrance using `gsap.matchMedia`,
  scoped cleanup and reduced-motion support. GSAP is under its Standard No Charge
  license, not MIT. Flux is not an animation-builder product.
  https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/
  https://gsap.com/community/standard-license/
  Package copyright and license reference: [GSAP notice](licenses/gsap.md).
- **Spline** informed the single sculptural interaction, but no hosted Spline
  scene, runtime, or stock model is embedded. Original parametric geometry is
  rendered locally with Three.js; it needs no Spline account or external scene.
  Full renderer notice: [Three.js MIT license](licenses/three.md).
- **Animista** was consulted for restrained entrance timing. The final entrance
  and small preview-switch keyframes are original; no generated Animista code is
  included. CodePen/showcase references are not treated as reusable licensed code.
- **Sora / Source Sans 3**: official Latin variable font subsets, unmodified,
  retrieved from Google Fonts and self-hosted. Both are SIL OFL 1.1; the full
  notices are in `apps/web/app/fonts/OFL.txt`.
  https://github.com/google/fonts/tree/main/ofl/sora
  https://github.com/google/fonts/tree/main/ofl/sourcesans3

The sculpture has an immediate local WebP poster rendered from the same geometry.
Its optional WebGL module loads
after the usable entry is rendered, only on wide screens with a fine pointer,
hover support, and motion allowed.
Data-saving/slow connections, smaller screens, disabled WebGL, failed chunks,
and context loss retain the poster. Rendering stops when idle, offscreen, or
hidden, and resources are disposed on unmount. Pointer movement and a keyboard-
accessible rotate control and deliberate preview-mode changes trigger movement;
the rendering loop stops when each response finishes.

No external runtime scripts, hosted assets, analytics, or graphics services are
required. No third-party artwork from Iconscout/Freepik/Humaaans is copied.
