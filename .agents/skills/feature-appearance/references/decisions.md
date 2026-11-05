# Appearance decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Pure canvas default

Owner quote, 2026-10-31; source: owner chat with Appearance and main-window screenshots, preserved from the original feature-appearance entry, section "V3-039 Layout fill and Pure background":

> görünüm kısmı bu şekilde olmuş ama tam dolmamış. Preview kısmıda tam dolmamış bunları düzeltip daha güzel hale getirmek gerekiyor. Birde buranın yada buranın yada bu arkaplan rengine sahip olan heryeri t3code daki gibi full #000000 yapabilmek istiyorum light modda da beyaz. Fakat görünümde yapamıyorum seçenekler arasında da yok Bu seçenekleride genişletmeliz. Defaultu da tam siyah tam beyaz olması gerekiyor hatta

The retained model contract is Pure/Tinted as an explicit preference, Pure for a missing field, and preserved custom-surface behavior. This quote does not imply resetting existing unrelated preferences.

## Source of current shared presentation

The shared group/row decisions are maintained in `docs/reference/ui-design-system.md` and `docs/reference/DESIGN.md`; do not duplicate their changing CSS details here. The advanced-visibility disagreement is recorded in [surfaces](surfaces.md), without selecting one source as the superseding owner decision.

## Live scene artwork: ASCII mask and Code visage

Owner quotes, 2026-10-30 and 2026-11-01; source: owner chat in the live background refresh session, with screenshots of the installed scenes.

> yapay zeka gibi futuristik birşey olmalı yüz hatlarını yada omuzu istemiyorum film gibi düşün

This applies to `ascii-mask`, which became an AI core (glowing lens, orbit rings, HUD scale) in `live-background/asciiMask.ts`.

> yüzü tam gözükmeyen robot gibi birşey istiyorum arkadan çıksın ilk versiyonlarında yapmıştık bir tane ona benzer birşey istiyorum. böyle birşey gözüküyor ve bu baya kötü durumda hiç estetik değil sadece kaş burun ağız tasvirlesek bile yeterli aslında boyun filan gerek yok

This applies to `code-visage` (screenshot of the hooded figure): a machine face emerging from the dark inside the code rain, with lit brows, eye slits, nose, cheekbones and mouth only, no outline, neck or shoulders (`machineFace` in `live-background/latentFace.ts`). Proposal, not decided: the picker description for Code visage still says "A dark figure in front of falling code" and could be reworded through the locale catalogs.

## Live scene artwork: Serene face

Owner quote, 2026-11-01; source: owner chat in the live background refresh session, right after the Code visage robot face:

> daha sakin bir yüz yapabilirdik bu kalsın ama birde sakin ılımlı bir yüz yapalım tam bir robot olmasın ayrı bi tane daha yapalım yani

This added the separate `serene-face` scene (Code visage stays): a halftone face with closed eyes and a soft smile, lit mostly from the front, fading into the dark, with two faint accent seams as the only machine hint (`createSereneFaceScene` and `sereneTone` in `live-background/latentFace.ts`).

## Live scene timing

Owner quote, 2026-11-03; source: owner chat in the live background timing session:

> live background effektleri çok kısa sürede kayboluyor belli bir süre gözüküp kaybolması gerekiyor msela yüzler 10 15 saniye sonra kaybolup yine bir süre sonra belirmesi gerekiyor ama şuanda öyle değil

This set the appear/hold/rest rhythm in `live-background/calmSignal.ts` (`SHOW_SECONDS`, `REST_SECONDS`) for every live scene. Reappearance needs new output from the running turn, and an idle pane stays at rest; both are implementation choices, not owner decisions.

## Canvas first

Owner decision, 2026-11-05 (rules audit, confirming the 2026-10-31 Pure canvas default and the 2026-11-04 chat corrections). Recorded decision text:

The ground is pure black in dark mode and pure white in light mode by default, and every ordinary surface shares it. Project rail, sidebars, chat and transcript areas, assistant chat, settings pages and their groups, collection lists, detail panes and empty states are the canvas, with hairline borders or spacing as separation. Nothing ordinary gets a gray fill, a mid-gray panel layer or a card tone of its own.

Raised surfaces are reserved for floating surfaces, the composer writing area, code/terminal/log viewers, inputs and the hover/selected/drag states that already have roles. Appearance previews and danger zones keep their status tone.

This supersedes the earlier default that standard panel and card surfaces use the shared raised surface role everywhere in the desktop app. The raised role is kept only for the cases above. Tinted canvas and custom surface colors keep the same hierarchy one step above their own ground.

The Pure background tone (default) and Tinted tone are the origin of this rule; the 2026-10-31 Pure canvas quote above is their provenance.
