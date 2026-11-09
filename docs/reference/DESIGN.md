---
version: alpha
name: bycoda
description: A compact, quiet workspace for conversations, projects and agent work.
---

# bycoda design language

## Overview

bycoda puts the conversation, current work and next useful action first. Its
interface is compact, neutral and quiet, with familiar controls, readable type
and precise alignment. Apple-inspired clarity means removing repetition and
competing emphasis while keeping every capability discoverable.

This document states product rules only. The owner decisions behind them are kept
in each owning feature's `references/decisions.md`, and token names and values
live in the desktop design system.

Apply this product language through the [desktop design system](ui-design-system.md)
and the native mobile design system (`mobile/docs/reference/design-system.md` in the separate mobile repository).
Keep their platform-specific controls, geometry and behavior; consistent intent
does not require copying desktop controls into a touch interface.

## Product-wide redesign outcome

Provenance: feature-workbench-design decisions.

The outcome is a coherent product-wide visual and interaction redesign, with
the reference app as a quality reference. Evaluate complete screen and control groups:
navigation, task hierarchy, content layout, surfaces, typography, controls,
collections, overlays, scroll ownership and operation states together. Every
shared family and feature-local composition belongs to the coverage inventory.
Existing native and mobile surfaces retain their platform conventions and need
explicit mapping rather than implied acceptance from desktop changes.

A closed defect, token substitution, smaller padding or successful compiler run
does not by itself deliver this outcome. Existing implementations may be reused
when they meet the target; changes must still produce the intended hierarchy in
real application consumers. Preserve all capabilities, drafts, permissions,
accessibility, theme/font/scale/density preferences and recovery behavior.

The approved direction remains compact tools/lists, more comfortable reading
and forms, neutral semantic surfaces, restrained accent, fewer decorative boxes
and clear pane/input/selection/focus/drag boundaries. Use the existing Arc
adapters and shared theme to establish one control and composition language.
Do not introduce marketing typography, decorative textures, another UI library
or new product defaults as an interpretation of higher quality.

Each change states its target composition as well as its source gaps. Design
acceptance covers the whole surface and its states, checked in real light and
dark consumers at desktop and narrow widths, with independent review. Shipping
source and accepting the design are separate states: a surface is not visually
accepted because its source landed or because it was marked done.

## Colors

### Canvas first

Provenance: feature-appearance decisions.

The ground is pure black in dark mode and pure white in light mode by default,
and every ordinary surface shares it. Project rail, sidebars, chat and transcript
areas, assistant chat, settings pages and their groups, collection lists, detail
panes and empty states are the canvas, with hairline borders or spacing as
separation. Nothing ordinary gets a gray fill, a mid-gray panel layer or a card
tone of its own.

Raised surfaces are reserved for: floating surfaces (menus, popovers, dialogs,
toasts), the composer writing area, code/terminal/log viewers, inputs, and the
hover/selected/drag states that already have roles. Appearance previews and danger
zones keep their status tone. Tinted canvas and custom surface colors keep the same
hierarchy one step above their own ground.

Background tone offers Pure (the default) and Tinted. Under Pure, the window, rail,
sidebars, chat, side panels, editor and terminal share one pure ground. Derived
layers (surfaces, text, borders) keep their steps above that ground, and a custom
surface color that matches no palette keeps its tinted canvas. Native glass keeps
its own opacity settings and tints with the active canvas.

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

Provenance: feature-workbench-design decisions.

The project rail uses one neutral ground. Its tools fill the available rail width
without an inner raised tray, decorative frame or an unrelated surface color.
Collapsed section headings use a tight shared rhythm; spacing after expanded
content is a separate role. Section add and overflow actions occupy one aligned
trailing slot. These overflow actions remain visible and keyboard discoverable;
do not globally change unrelated inline-action reveal behavior. Development build
identity belongs in the lower-left footer as a compact semantic status label or
icon with a useful accessible name, including the collapsed/hidden-rail fallback.

Settings presentation follows the task. Ordinary preferences use a bounded shell
with the workspace context retained behind it; list/detail workspaces such as
Skills use a wide, maximize-capable shell. Analytics and collection managers may
also use the wider presentation. A universal narrow content column inside a
full-window replacement leaves unnecessary empty space and does not satisfy this
direction. Reuse the existing overlay/focus/navigation owners, retain the same
mounted page across maximize/restore and preserve drafts, selected items, search
targets and return navigation. Narrow windows may use the viewport and the
existing category picker. Specific dimensions remain implementation proposals.

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

Provenance: feature-workbench-design decisions (navigation and focus); feature-appearance
decisions (background tone); feature-chat-composer decisions (composer surface);
feature-settings decisions (groups).

The project rail and sidebars share the chat canvas in light, dark and custom
themes; pane borders provide the separation. Navigation is not a separate gray
layer. Order the layers as canvas and navigation together, then reading and form
surfaces, then floating surfaces. Muted fields, hover, selection, group colors and
pane borders keep their own roles. Native glass keeps its shared base tint,
independent sidebar and main opacity settings, and its light-mode opaque policy.

On the Pure background the chat composer writing area is one quiet step above the
ground, slightly lifted in dark mode and faintly tinted in light mode, with its
border keeping the writing area distinct.

Settings groups and collections have no gray fill. The group interior is the page
canvas, framed by a thin rounded border, with hairline dividers between rows.
Inputs, selected rows, focus rings and drag targets keep their own boundary roles.
Appearance previews, danger zones and code or path views stay colored or filled.

Floating surfaces (menus, popovers, dialogs) are distinguished from the work
beneath them by shared floating treatments. Preserve existing glass and background
preferences while keeping content and focus readable; effects do not replace task
hierarchy.

Make separation clear before reducing containment. Separate ordinary sections
primarily with spacing and subtle surface-tone differences.
Use alignment and type to reinforce hierarchy; reserve boxes and borders for
real task grouping, structural separation or an interaction that needs a visible
boundary. Keep input, selection, focus and drag boundaries distinguishable.
Do not add nested cards, repeated headers or decorative boxes around ordinary
content.

Do not introduce a surrounding focus frame or decorative edge stripe on a large
composer, panel, card or row. Use the owning surface, text/icon emphasis and
caret to convey the relevant state; keyboard-operated controls keep a visible
local focus cue. Treat required input/drag/resize and system high-contrast
boundaries separately. Do not wrap a composer's subordinate workspace toolbar
in another attached outline. Apply this rule to screen compositions and shared
controls together rather than inventing an edge treatment on each screen.

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

### Two conversation layouts

Provenance: feature-assistant decisions (messaging layout) and feature-sessions-sidebar
decisions (transcript layout).

The product has exactly two conversation layouts; do not invent a third per screen.

- Messaging layout: the personal assistant chat, social direct messages and any
  person-to-person or person-to-assistant thread. The owner's messages sit on the
  right, the other party on the left, in bounded-width bubbles one quiet step above
  the canvas. Day separators, a small time under each bubble, a compact composer at
  the bottom; Enter sends, Shift+Enter breaks a line. Voice and send are separate
  controls that never overlap.
- Transcript layout: agent and coding sessions. Full-width reading column, user
  prompts as distinct blocks, tool and command steps as single-line summaries with
  details on demand, active work and approvals always visible. No bubbles, no
  alternating alignment.

Both keep drafts, attachments, selection and scroll position; both use the shared
composer owner for text entry.

### Badges and status tones

Provenance: feature-shared-ui decisions.

- Counter badges are small, borderless labels derived from the user's accent, with
  the same height as the surrounding caption text. They never carry their own hue
  or a filled pill with a border. `99+` and exact counts stay.
- A pending question or approval uses the warning tone, not the information tone;
  it is a request for the owner's attention, not a notice.
- Running work shows an accent dot or activity icon beside its title. No colored
  edge stripe on rows, cards or panes to indicate running, draft or selected state.
- Information, success, warning and failure tones are reserved for real status and
  always come with a label or meaningful icon.

### Permission, readiness and activity are three states

Provenance: feature-settings decisions.

Opening a settings page must never activate a capability, and the page must not say
"active" because a permission is stored. Show three separate facts wherever a
capability has them: whether the owner has enabled it, whether the helper or
provider is verified ready, and whether an operation is running right now. A failed
refresh clears a stale "ready" or "active" reading instead of keeping it. The same
triad applies to voice, devices, providers, skills and MCP servers.

### Collections scroll, they do not page

Provenance: feature-shared-ui decisions.

Lists are continuous, bounded windows that extend as the user scrolls, with an
explicit "load more" only where a backend requires a controlled step. Numbered
pagination controls are removed, not restyled. Keep the query, filters, selection
and scroll position across loads; show loading, empty, error and partial states
inline at the end of the list.

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
