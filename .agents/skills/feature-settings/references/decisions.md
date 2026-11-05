# Settings decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Settings groups without gray fill

Owner decision, 2026-10-31, V3-013 (Crews page, with a reference screenshot of T3 Code "Sharing & access"), source: owner chat:

> Bu ortadaki gri arka planların hepsinden kurtulmak istiyorum aslına bakarsan. Bak t3code nasıl design etmiş bizde gri renkle ayırmışız heryeri bunlarıda düzeltelim bence.

Recorded decision: settings groups and collections have no gray fill. The group interior is the page canvas, framed by a thin rounded border with hairline row dividers. This takes precedence over the general raised-surface rule for Settings groups and collections only. Appearance previews, danger zones and code/path views keep their status or code tone.

## Permission, readiness and activity are three states

Owner correction, 2026-11-04 (assistant settings, computer use). Recorded decision text: opening a settings page must never activate a capability, and the page must not say "active" because a permission is stored. Show three separate facts where a capability has them: whether the owner enabled it, whether the helper or provider is verified ready, and whether an operation is running now. A failed refresh clears a stale "ready" or "active" reading. The same triad applies to voice, devices, providers, skills and MCP servers. Confirmed as a shared rule on 2026-11-05.
