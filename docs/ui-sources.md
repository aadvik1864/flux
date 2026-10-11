# Interface direction and component sources

Flux is a working console for collaborative documents, not a decorative landing
page. Dense document navigation and useful empty states come before effects.

## Design tokens

- Day: canvas `#edf2fa`, surface `#ffffff`, ink `#19283d`, cobalt `#335cdb`,
  muted slate `#60728b`, saved-state green `#0c806a`.
- Night: canvas `#121824`, surface `#1b2535`, ink `#e1e9f5`, cobalt `#86a8ff`,
  muted slate `#a0aec5`, saved-state green `#6fd3b5`.
- Typography: Aptos/Segoe UI for compact interface labels; Georgia for documents.
  Local fonts avoid a network dependency on the initial account-loading screen.
- Layout: left-aligned compact navigation; document ledger and smaller team rail.
  Document pages retain a readable line length without a forced blank sheet.

```text
navigation | workspace / search / day-night
           | workspace title + quick actions
           | find documents / sort / list-grid
           | document ledger      | team
```

The rejected generic direction was floating stat cards and continuous animated
backgrounds. Flux instead makes the document ledger the dominant element, uses
real counts, and reserves spotlight/sparks for quick actions and onboarding.

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

No external runtime scripts, WebGL backgrounds, analytics, or decorative remote
assets are required. Effects do not run in the collaborative document itself.
