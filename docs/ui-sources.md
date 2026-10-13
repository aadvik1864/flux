# UI sources and licenses

## Visual system

Flux pairs an illustrated entry screen with a quiet document interface. Slate
identifies navigation, coral marks creation actions, orchid marks selections, and
teal indicates saved state. Day/night colors are defined in `apps/web/app/globals.css`.
Sora is used for headings, Source Sans 3 for controls, and Georgia for authored text.

`apps/web/components/work-art.tsx` contains original inline SVG document, folder,
people, search, and history scenes. A document-ID hash keeps accent colors stable
through sorting. Illustrations sit in existing controls and guidance, never inside
authored documents. Hover and keyboard focus share the same treatment; touch and
reduced-motion sessions keep static artwork.

The entry's original ribbon sculpture is rendered locally with Three.js. Its WebP
poster is immediately available; optional WebGL loads on wide, fine-pointer screens
with motion allowed. Small screens, slow/data-saving connections, failed chunks,
and context loss retain the poster. Rendering stops while idle, hidden, or offscreen,
and resources are disposed on unmount. No hosted scene, analytics, or external
runtime asset service is required.

## Adapted components

Sources retrieved 2026-10-10. Adaptations are part of Flux, not a reusable component
library. Keep the bundled copyright and license notices when redistributing.

| Source | Use in Flux | License notice |
|---|---|---|
| [React Bits SpotlightCard](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Components/SpotlightCard/SpotlightCard.tsx) | Pointer-position card lighting | [MIT + Commons Clause](licenses/react-bits.md) |
| [React Bits ClickSpark](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Animations/ClickSpark/ClickSpark.tsx) | Bounded click effect that stops when idle | [MIT + Commons Clause](licenses/react-bits.md) |
| [Magic UI AnimatedThemeToggler](https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/animated-theme-toggler.tsx) | Circular theme transition with reduced-motion/browser fallbacks | [MIT](licenses/magic-ui.md) |
| [Uiverse / cssbuttons-io](https://uiverse.io/cssbuttons-io/calm-tiger-42) | Scoped liquid-fill button with focus/disabled states | [MIT](licenses/uiverse.md) |
| [GSAP](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/) | Scoped headline entrance with reduced-motion support | [Standard No Charge](licenses/gsap.md) |
| [Three.js](https://threejs.org/) | Local parametric ribbon renderer | [MIT](licenses/three.md) |

React Bits is **not plain MIT**: the Commons Clause restricts selling the components
themselves. GSAP is **not MIT**; review its Standard No Charge terms for any new use.
[next-themes](https://github.com/pacocoursey/next-themes) provides persisted/system
themes and cross-tab synchronization under MIT; its installed package retains the
notice. Spline and Animista informed the design, but no scene/runtime or generated
code from either is bundled. No third-party illustration pack is included.

Unmodified Latin variable subsets of [Sora](https://github.com/google/fonts/tree/main/ofl/sora)
and [Source Sans 3](https://github.com/google/fonts/tree/main/ofl/sourcesans3) are
self-hosted through `next/font/local`. Both use SIL OFL 1.1; full notices are in
`apps/web/app/fonts/OFL.txt`. Other scripts use system-font fallbacks.
