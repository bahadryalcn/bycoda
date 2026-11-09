# Settings decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Settings groups without gray fill

Owner decision, 2026-10-31, V3-013 (Crews page, with a reference screenshot of the reference app "Sharing & access"), source: owner chat:

> Honestly I want to get rid of all these gray backgrounds in the middle. Look at how the reference app designed it; we separated everything with gray, and I think we should fix these too. (translated)

Recorded decision: settings groups and collections have no gray fill. The group interior is the page canvas, framed by a thin rounded border with hairline row dividers. This takes precedence over the general raised-surface rule for Settings groups and collections only. Appearance previews, danger zones and code/path views keep their status or code tone.

## Permission, readiness and activity are three states

Owner correction, 2026-11-04 (assistant settings, computer use). Recorded decision text: opening a settings page must never activate a capability, and the page must not say "active" because a permission is stored. Show three separate facts where a capability has them: whether the owner enabled it, whether the helper or provider is verified ready, and whether an operation is running now. A failed refresh clears a stale "ready" or "active" reading. The same triad applies to voice, devices, providers, skills and MCP servers. Confirmed as a shared rule on 2026-11-05.

## IDE-style settings rail groups

Owner request, 2026-11-08, wave E (settings rail), source: owner chat. Recorded decision text: the Settings rail is grouped like an IDE settings page instead of one flat list: App (General, Appearance, Chat, Voice, Notifications, Keybindings, Terminal, Group lock), Agents (Providers, Crews, Skills, MCP, Usage, Limits, Secrets), Code (Workspace, Source control), Connections, About (Archive, Policies), with the account avatar row at the bottom of the rail. Section ids, labels and the search index do not change; the group of a section and the order live in `model/settingsGroups.ts`. Maintenance and Labs groups join when such sections exist.
