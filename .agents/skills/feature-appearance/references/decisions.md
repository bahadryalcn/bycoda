# Appearance decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Pure canvas default

Owner quote, 2026-10-31; source: owner chat with Appearance and main-window screenshots, preserved from the original feature-appearance entry, section "V3-039 Layout fill and Pure background":

> the appearance section turned out like this but is not fully filled. The preview is not fully filled either; these need fixing and polishing. Also I want to make this area, that area, or everywhere with this background color full #000000 like in the reference app, and white in light mode. But I cannot do it in Appearance and it is not among the options. We should expand these options too. The default should even be full black and full white (translated)

The retained model contract is Pure/Tinted as an explicit preference, Pure for a missing field, and preserved custom-surface behavior. This quote does not imply resetting existing unrelated preferences.

## Source of current shared presentation

The shared group/row decisions are maintained in `docs/reference/ui-design-system.md` and `docs/reference/DESIGN.md`; do not duplicate their changing CSS details here. The advanced-visibility disagreement is recorded in [surfaces](surfaces.md), without selecting one source as the superseding owner decision.

## Live scene artwork: ASCII mask and Code visage

Owner quotes, 2026-10-30 and 2026-11-01; source: owner chat in the live background refresh session, with screenshots of the installed scenes.

> it should be something futuristic like an AI; I do not want facial features or shoulders, think of a film (translated)

This applies to `ascii-mask`, which became an AI core (glowing lens, orbit rings, HUD scale) in `live-background/asciiMask.ts`.

> I want a robot whose face isn't fully visible, emerging from behind; we made one in the early versions and I want something similar. What shows now looks quite bad and not aesthetic at all; even depicting just eyebrows, nose and mouth would be enough, no neck or the like is needed (translated)

This applies to `code-visage` (screenshot of the hooded figure): a machine face emerging from the dark inside the code rain, with lit brows, eye slits, nose, cheekbones and mouth only, no outline, neck or shoulders (`machineFace` in `live-background/latentFace.ts`). Proposal, not decided: the picker description for Code visage still says "A dark figure in front of falling code" and could be reworded through the locale catalogs.

## Live scene artwork: Serene face

Owner quote, 2026-11-01; source: owner chat in the live background refresh session, right after the Code visage robot face:

> we could have made a calmer face; keep this one, but let's also make a calm, mild face that is not fully a robot, as a separate additional one (translated)

This added the separate `serene-face` scene (Code visage stays): a halftone face with closed eyes and a soft smile, lit mostly from the front, fading into the dark, with two faint accent seams as the only machine hint (`createSereneFaceScene` and `sereneTone` in `live-background/latentFace.ts`).

## Live scene timing

Owner quote, 2026-11-03; source: owner chat in the live background timing session:

> live background effects disappear very quickly; they should stay visible for a while and then vanish, e.g. faces should vanish after 10-15 seconds and reappear after a while, but that is not how it works now (translated)

This set the appear/hold/rest rhythm in `live-background/calmSignal.ts` (`SHOW_SECONDS`, `REST_SECONDS`) for every live scene. Reappearance needs new output from the running turn, and an idle pane stays at rest; both are implementation choices, not owner decisions.

## Canvas first

Owner decision, 2026-11-05 (rules audit, confirming the 2026-10-31 Pure canvas default and the 2026-11-04 chat corrections). Recorded decision text:

The ground is pure black in dark mode and pure white in light mode by default, and every ordinary surface shares it. Project rail, sidebars, chat and transcript areas, assistant chat, settings pages and their groups, collection lists, detail panes and empty states are the canvas, with hairline borders or spacing as separation. Nothing ordinary gets a gray fill, a mid-gray panel layer or a card tone of its own.

Raised surfaces are reserved for floating surfaces, the composer writing area, code/terminal/log viewers, inputs and the hover/selected/drag states that already have roles. Appearance previews and danger zones keep their status tone.

This supersedes the earlier default that standard panel and card surfaces use the shared raised surface role everywhere in the desktop app. The raised role is kept only for the cases above. Tinted canvas and custom surface colors keep the same hierarchy one step above their own ground.

The Pure background tone (default) and Tinted tone are the origin of this rule; the 2026-10-31 Pure canvas quote above is their provenance.
