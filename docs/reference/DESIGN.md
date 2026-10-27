---
version: alpha
name: bycoda
description: A compact, quiet workspace for conversations, projects and agent work.
omitted:
  - section: colors
    reason: Theme values remain in the existing desktop and native semantic token owners.
  - section: typography
    reason: Platform type scales and user font preferences remain in their existing owners.
  - section: spacing
    reason: Platform geometry and density preferences remain in their existing owners.
  - section: rounded
    reason: Control and floating-surface geometry remain in the existing shared adapters.
  - section: components
    reason: Platform component contracts remain in the existing implementation guides.
---

# bycoda design language

## Overview

bycoda puts the conversation, current work and next useful action first. Its
interface is compact, neutral and quiet, with familiar controls, readable type
and precise alignment. Apple-inspired clarity means removing repetition and
competing emphasis while keeping every capability discoverable.

Apply this product language through the [desktop design system](ui-design-system.md)
and the [native mobile design system](../../mobile/docs/reference/design-system.md).
Keep their platform-specific controls, geometry and behavior; consistent intent
does not require copying desktop controls into a touch interface.

## Colors

Build hierarchy with neutral surfaces, text contrast and restrained emphasis.
Use the user's accent for intentional emphasis and semantic status colors for
actual information, success, warning and failure. Keep action hierarchy separate
from its meaning: a destructive action does not automatically become primary.

Consume the shared semantic surface, text, border, focus and interaction roles.
Define a genuinely new role in the owning theme for every supported appearance;
do not invent a palette, color mixture or opacity recipe in a feature.

Preserve light, dark, system mode, custom accents and existing appearance
preferences. Keep focus, essential boundaries and text readable on their actual
backgrounds. Pair status color with a label or meaningful icon.

## Typography

Use the shared interface and code font roles and retain the user's font and
scale preferences. Distinguish headings, primary content and metadata through
the existing shared scale and restrained weight. Keep changing numbers tabular.
Do not shrink required labels or content to make a toolbar fit, or import
marketing typography into the workbench.

## Layout

Give each surface a clear purpose and keep its heading, content and actions
aligned. Keep toolbars and lists compact; give reading and form areas more
breathing room through line height, field grouping and spacing. This contrast
is the default composition, while the user's shared density, type and scale
preferences remain authoritative. Do not fake it with screen-specific control
sizes. Adapt interactive targets to the platform without widening every desktop
toolbar to match a touch example.

Keep frequent actions direct and secondary commands in the existing menu system.
Put collection filters in a named compact trigger with an active indication and
reset. Optional explanations belong in help or disclosure; labels, validation,
approval state, connection failures and recovery remain visible. Appearance
preferences retain their existing always-visible sections, including advanced
fields.

Use disclosure for meaningful optional detail, not for a single short fact that
is cheaper to read directly. Keep ordinary dates and current values inline.
Render diagnostic disclosure only when its extra content exists; keep actionable
failures, uncertainty, prerequisites and consequences visible beside the task.

Use the shared spacing rhythm and a consistent content gutter. Let rows and
panels shrink without hiding useful controls. Bound long text, tables, logs and
editors within their surface; preserve the intended content scroll region and
the user's drafts when panels resize or navigation changes.

### Make ownership and boundaries readable

Keep navigation, the current content, its actions and application-wide status
visually distinguishable. A user should be able to identify the current task,
its execution location and the next action without interpreting several unrelated
rows. Give each control group one clear purpose and keep its status with it.

Independent panes, resize edges, overlays and editable areas need a persistent,
readable boundary in their resting state. Strengthen a shared separator or surface
role when spacing alone leaves ownership ambiguous. Check both themes and custom
appearance settings; hover must not be required to discover where a region ends.

## Elevation & Depth

Make separation clear before reducing containment. Separate ordinary sections
primarily with spacing and subtle surface-tone differences.
Use alignment and type to reinforce hierarchy; reserve boxes and borders for
real task grouping, structural separation or an interaction that needs a visible
boundary. Keep input, selection, focus and drag boundaries distinguishable.
Do not add nested cards, repeated headers or decorative boxes around ordinary
content.

Use shared floating surfaces to distinguish menus, popovers and dialogs from
the work beneath them. Preserve existing glass and background preferences while
keeping content and focus readable; effects do not replace task hierarchy.

## Shapes

Keep controls, panels and floating surfaces in their existing shared shape
families. Choose an intentional shared variant rather than restyling the same
control independently on each screen. Icon-only actions retain a full usable
target, an accessible name and a tooltip.

## Components

### Choose the interaction for the task

Decide whether the user is executing a command, setting a value, switching a view
or navigating before choosing a control. Use visible choices when comparison
matters, searchable selection for growing named collections, and explicit free
entry where custom values are supported. Preserve capabilities rather than old
button counts or element tags.

Reuse the shared platform adapters, extend an existing owner for a reusable gap,
and add a shared component only for a concrete unmet need. Keep domain data,
validation, permissions and operation state in their feature owners. Desktop
Arc source is an implementation resource, not a second application theme.

### Give content and state distinct identities

Lead lists and detail views with the user's task or a useful human title. Keep
model, account, branch, elapsed time and debugging identifiers subordinate.
Retain account identity when it affects the action and preserve user-authored
names; attachment transport markers must not displace a readable generated title.

Keep expanded, selected, focused, hovered and drop-target states distinguishable.
Name what a count measures. Distinguish an action from an informational meter,
an agent from a command, and historical failure from a current approval request.
Avoid repeating the same status or explanation in several competing locations.

Use concise task language for normal operation and keep exact commands, paths,
hashes and execution history available in details and copy actions. Keep safety
consequences, excluded local changes, blocking reasons and recovery visible in
language the user can understand; simplifying copy must not hide those facts.

### Keep activity and detail easy to read

Use a compact summary for an operation and a clear detail region when it opens.
Show completed ordinary tool and command steps as a single-line summary by
default, with their command, output and history available on demand. Keep active
work, failures and pending approvals visible without requiring disclosure.
Distinguish the request, current execution, final result and execution history.
Avoid adding a new bordered card at every nested activity level. Preserve full
content, failure details, honest truncation and inspection/copy capabilities.

Agent panels and command details should have a readable identity and actual
state, a dominant content region and local actions. Keep static instructions
subordinate to the work being read; keep real delivery limitations, pending
approvals and failures visible. A message relay must distinguish acceptance by
the main conversation from confirmed delivery to an agent.

### Make actions and outcomes clear

Use at most one primary action per active task context. Keep related commands
coherent while preserving each action's own target, focus and disabled state.
Give the same intent the same terminology, hierarchy and state presentation
across features.

Show pending state on the initiating control or affected row/card. Guard against
duplicate execution, preserve the label and layout, and keep unrelated actions
available. Report real progress only when the operation supplies it; keep
cancellation reachable where supported.

Show success through updated content or a concise local result. Keep failures
beside the operation with recovery and the user's input intact. Distinguish
loading, empty, unavailable, disconnected and failed states. Do not replace a
populated surface with a spinner during refresh or repeat the same progress in
several places.

### Preserve focus and platform behavior

Use the existing overlay lifecycle for layering, dismissal and focus return.
Keep one visible focus owner and preserve keyboard, selection, drag and native
window behavior. Make essential help and actions reachable without hover.

### Use motion to explain a change

Use the shared platform motion tokens for state changes and preserve reduced
motion. Keep content and controls stable while work runs. Avoid decorative
entrances, bounce, blur or repeated layout animation that competes with reading
or makes large collections expensive to render.

Use one simple live-state signal per activity region. Keep the existing animated
activity figure optional; it must not be required to understand whether work is
running, stopped or failed. Avoid stacking shimmer, pulses and decorative motion
around the same status.

## Do's and Don'ts

- Preserve functions, drafts, persistence, validation, permission gates,
  cancellation and recovery through every visual change.
- Preserve appearance and layout preferences instead of resetting them during
  a migration.
- Keep primary actions and necessary information discoverable; a quieter screen
  must still make the next action understandable.
- Do not create screen-specific control skins, a parallel theme or another
  overlay/focus system.
- Ask the owner before adopting an agent-proposed improvement beyond the agreed
  design direction. Treat a proposal as a proposal until the owner chooses it.
