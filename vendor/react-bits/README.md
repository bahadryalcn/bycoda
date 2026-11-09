# React Bits attribution

The folding tip animation in `src/features/sessions/ui/ComposerTips.tsx`
adapts the top hinge, perspective and crease shading from
[Fold Text by David Haz / React Bits](https://reactbits.dev/text-animations/fold-text).

Earlier versions also adapted [Orb](https://reactbits.dev/backgrounds/orb)
and followed the visual design of
[Letter Glitch](https://reactbits.dev/backgrounds/letter-glitch).
Those background implementations have been removed; this notice preserves their attribution.

Upstream source: https://github.com/DavidHDev/react-bits
(reviewed October 18, 2026). The upstream license is preserved in `LICENSE.md`.
The retained animation is integrated into the application, not distributed as a component library.

`src/features/settings/ui/live-background/reactBitsSurface.ts` adapts the free
[Threads](https://github.com/DavidHDev/react-bits/blob/main/src/content/Backgrounds/Threads/Threads.jsx)
and [Silk](https://github.com/DavidHDev/react-bits/blob/main/src/content/Backgrounds/Silk/Silk.jsx)
backgrounds, reviewed October 25, 2026. Copyright (c) 2026 David Haz.
The Perlin line geometry and satin fold equations render directly into bycoda's
canvas through a bounded WebGL2 adapter. Palette tokens replace standalone color
options; chat activity drives smooth additional movement. Mouse listeners,
bloom, framebuffer passes and upstream React lifecycle code are omitted. The
shared application lifecycle owns visibility, reduced motion, scheduling and cleanup.

The same adapter also integrates the free
[Dark Veil](https://github.com/DavidHDev/react-bits/blob/main/src/content/Backgrounds/DarkVeil/DarkVeil.jsx),
[Soft Aurora](https://github.com/DavidHDev/react-bits/blob/main/src/content/Backgrounds/SoftAurora/SoftAurora.jsx), and
[Floating Lines](https://github.com/DavidHDev/react-bits/blob/main/src/content/Backgrounds/FloatingLines/FloatingLines.jsx)
backgrounds, reviewed October 25, 2026. Dark Veil retains the original trained
CPPN matrices, with a smaller backing store for its heavier fragment arithmetic.
Soft Aurora keeps its original three-octave 3D Perlin noise and cosine-gradient
bands, with two flowing layers and theme-token tints. Floating Lines
keeps the logarithmic warp, sine phase and derivative antialiasing, bounded to
three families of six lines. Each renders in one direct native WebGL2 pass;
pointer/click interactions, framebuffer compositing and standalone color ramps
are omitted. AI presence and eased streaming energy alter flow and amplitude
without flashing, while theme tokens provide the artwork colors.
