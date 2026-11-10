# Getting started

Fresh desktop workspaces open a compact setup dialog: Account, Statistics, Workspace,
Appearance, Agents, Connections, Projects. Every step is directly accessible and
optional. Navigation and completion actions stay visible while the content scrolls.
The language selector applies immediately. Reopen the flow from Settings → General
→ Setup → Open setup.

- After about a week of use (at least five different days), a quiet notice asks whether
  you want to contribute to bycoda. **Clone and open** asks for a parent folder, clones the
  public repository (Git must be installed), opens it as a project and points to
  CONTRIBUTING.md; an existing checkout in that folder is opened as it is. **Later** asks
  again after 30 days, at most twice more; **No thanks** never asks again. The same action
  stays available in Settings → General → About → Contribute to bycoda. The use counters
  stay on this computer.
- Account (first run only, and only in builds with accounts) offers "Sign in with
  browser" to sync your stats across devices, or "Continue as guest". Guest stays
  fully local and works exactly as before; the step is shown once and you can sign in
  later in Settings → Account. A cancelled or failed sign-in returns to the step with
  the reason and keeps the guest choice. Existing users are not asked.
- Statistics (builds with accounts, until you have answered) asks whether to share anonymous
  statistics: "Share anonymous statistics" or "Don't share", equal choices. It explains what is
  sent (a random install id, app version, operating system, release channel and date, at most
  once a day) and what never is (sessions, prompts, code, file names, projects, account
  details). Statistics are off unless you say yes; change it any time in Settings → Account →
  Privacy & data, or Settings → Privacy without an account. Installations that skip setup get
  the same question once in a small notice that never blocks work.
- Workspace selects Tasks, Automations, Inbox, Notes and Social Media navigation.
  Coding, files, terminal and Git remain available. Choices save immediately and
  can be changed in Settings → Workspace. Hiding navigation does not stop running
  work or change account permissions. Active Tasks, Automations, Inbox and Social
  Media shortcuts stay reachable until the user leaves the tool. Notes retains
  its existing enabled/disabled behavior.
- Appearance applies Light, Dark or System mode immediately. Still previews show
  the original uncles and the Star Wars, Lord of the Rings and Matrix crews. Users
  can hide the crew or disable
  decorative animations independently; on displays refreshing at 120 Hz or more,
  decorative animations start off until the user turns them on. Decorative
  pulses, the crew and the pacing walker hold their last frame while the bycoda
  window is behind another application. Existing appearance settings are reused.
  Settings → Appearance is split into Theme, Background, Interface, Typography
  and Motion tabs; search opens the tab that holds a setting. Theme holds the
  palette, mode, accent, tone (hue, saturation, dark lightness) and Interaction
  color, which tints hover, selection and pressed fills from the theme, the accent
  or a custom color with an adjustable strength. Preview in app turns Settings
  into a side panel without dimming, so live backgrounds, the crew and glass can
  be judged on the real workspace; Escape returns to the full dialog.
  The image button in the theme generator opens a menu for None, Codex or Gemini;
  its icon reflects the selected image provider. Selecting a suggested or saved
  theme pre-fills its editable name when saving the current look. Palette and
  saved-theme cards share one grid rhythm. Tone, interaction and scrollbar
  settings place previews beside their controls when space allows.
  AI suggestions keep code and terminal text sizes close, preserve readable
  borders and keep generated artwork visible. Manual controls retain their ranges.
- Appearance → Background stacks the layers back to front: Glass, Color, Image and
  Live. Each row shows a thumbnail and summary and opens its editor in place.
  Sidebar and main pane opacity are independent; light mode remains opaque.
  Windows and macOS also require Window glass, which takes effect after a restart:
  Restart now runs the normal quit (saving drafts and asking about running work)
  and relaunches. Linux uses Main pane glass. If the native window update fails,
  retry from the setting.
- The Color layer offers six presets, linear, radial and soft-blend styles, three
  colors, an angle dial and strength. Edits apply while you drag and save
  automatically; only a genuine edit from another window asks for resolution.
  Turning it off retains the design. The background is drawn inside the app in
  either theme, behind chat images and live scenes, and temporarily covers desktop
  translucency without changing the saved glass preferences. Accessibility may
  hide the artwork while keeping the design saved.
- Agents checks local Codex, Claude Code and Antigravity installations. Other
  supported providers can be added from a compact selector; ACP configuration
  opens the existing custom-agent editor. Checkboxes control model-picker visibility.
  Added providers remain listed when setup is reopened, even before installation.
  Missing
  agents link to the provider's installation guide. The CLI path control and
  provider login flow are reused. An installed CLI is not labeled authenticated;
  a successful login in setup displays Signed in. Existing CLI credentials remain
  available through the normal provider integration.
- Connections starts with this computer. Manage connections opens the existing
  editor for computers and sharing. The local sync host is excluded
  from the remote computer list. Remote presence is not presented as proof of a
  successful connection.
- Projects discovers local Claude/Codex interactive conversations and groups them
  by usable folder. Already imported conversations and missing folders are excluded.
  Selected folders import through the existing bounded, cancellable import runner.
  Failures and shortened/history-only imports stay visible in the result screen.
  New folders can be added with the native folder picker. Remote folders use the
  existing remote project picker; remote CLI history is not scanned by this dialog.
  Selections and results remain intact when navigating back to another setup step.

The `bycoda.onboarding.v1` local preference records completion or skipping.
Remembered projects, stored history, restored workspaces and window transfers
suppress automatic setup. Existing workspaces are recorded so clearing their
projects later does not turn an upgrade into a first run. A skipped setup can be
reopened in Settings. Setup does not install providers or import history
automatically. Connection changes use the existing explicit connection controls.
Finishing setup opens the workspace directly. The usage guide is an explicit,
optional action and remains available in Settings.

## Guide

The Guide (View → Usage guide, or Settings → General) is a topic-by-topic walkthrough
that works with the app instead of only describing it.

- **Steps.** Every topic lists a few short steps (Chat with agents has four, including
  choosing the access mode). A step shows ✓ when it is finished:
  automatically when the app already shows it (a project is open, several projects
  exist, a project is pinned, a session already has a message, you opened a diff, a
  commit or all changes for review, you opened a terminal), when you use the topic's
  primary button, when you finish a quick tour or a "Show me", or when you tick the step
  yourself. Opening a diff or a terminal is remembered in a small local record
  (`bycoda.guide.activity.v1`), so those two steps finish by themselves; the manual tick
  still works for every step.
  The Guide's progress counts finished steps, and a short "First steps" row
  (open a project, start a session, review a change, use the terminal) names what to
  do next.
- **Show me.** A step with a control to point at has a "Show me" button (for example the
  message box, model and access-mode controls, the pin on a project row, Changes,
  Explorer, the terminal and the sidebar tools). The Guide
  steps aside, the control is spotlighted, and Done returns to the same topic. If the
  control is not on screen (no project, the sidebar or a tool is hidden) the spotlight
  says why and offers the action that opens it, plus "Check again". For the pin, the
  help also explains how to make a group (a project's … menu → Move to group → New group…).
- **Quick tours.** Projects, Chat with agents, Changes & Git, Files & search, Terminal
  and Tasks & goals have a Quick tour of three to five steps. Continue / Back, the
  arrow keys, Skip tour and Esc all work. Esc or Skip leaves without ticking steps off.
- **Try it.** Each topic has one primary button that opens the surface (open a
  project, start a session, open Changes, Explorer, the terminal, Tasks…).
- **Tips and shortcuts.** Extra detail is behind a quiet "Tips" disclosure. Shortcuts
  use plain names and show your current keys, including custom or disabled bindings.
  Previous and Next sit side by side at the bottom of each topic.

Progress is stored locally (`bycoda.guide.seen.v1` for viewed topics,
`bycoda.guide.done.v1` for finished steps).

## Guided tour

A one-minute spotlight tour walks a new user through the main controls: the project rail,
starting a session, the message box (`@` files, `/` commands), model and reasoning, access
mode, the Sessions / Explorer / Changes tabs, Changes, the terminal, the background-work tools
(Tasks, Automations, Inbox, Notes) and Settings with the Guide. Every card has a short title,
one sentence and, where it helps, a **Try it** button that does the real thing (open a folder,
start a session, open Explorer, Changes or the terminal, open the Guide) and then moves on.

- **Who sees the offer.** Everyone who has never finished, skipped or declined the tour,
  existing users included. A small notice offers "Take a 1-minute tour" or "Later" once. It
  never appears over Quick setup, the Guide or any open dialog; it waits until they are
  closed (for Quick setup that means after "Finish setup" or "Set up later"). "Later" ends the
  offer for good, and so does finishing or skipping the tour.
- **Start it again.** Guide → "Take the tour", View → Take the tour, and Settings → General →
  Getting started → Take the tour. A tour left part-way shows "Resume tour" and continues from
  the card where it stopped.
- **Using it.** The spotlight dims the rest of the window and the keyboard focus moves into the
  card (Tab stays inside it). Next / Back, the left and right arrow keys and the Try it button
  move through the cards, Skip tour or the close button ends it, and Esc closes it and
  remembers the card. The card shows the progress ("3 / 9") and announces it to screen
  readers. It follows the control when the window is resized or scrolled, and the entry
  animation is off with reduced motion.
- **Missing controls.** If a card's control is not on screen, the tour first tries a safe
  navigation (for example showing Explorer or Changes); if that is not possible (no project,
  hidden sidebar, a tool turned off) the card is skipped and the progress count shrinks
  ("3 / 8"). Nothing is created or changed to make a card appear.
- **Stored state.** `bycoda.tour.v1` keeps `completed`, `skipped`, `later` or `paused` plus the
  card to resume from.

### What's new highlights

After an update, features added since the user last looked can be pointed out in the app.

- **Markers.** A small "New" dot sits on the control of each highlight. It disappears when the
  control is clicked or focused, or when the "What's new" tour has shown it.
- **Tour.** The What's new dialog shows "Show me" when highlights are pending, and the Guide
  shows a "What's new" button; both start a short tour of only the new cards (same card,
  spotlight and keyboard behavior as above).
- **Who sees what.** Only highlights whose `sinceVersion` is newer than the version the user
  last handled. A fresh install starts from its own version, so it never gets older highlights
  (the first tour already covers them), and so does an existing user the first time this
  feature runs. Stored state: `bycoda.highlights.v1` (last handled version and the ids seen).

**For developers: adding a highlight.** In `src/features/onboarding/model/featureHighlights.ts`
add an entry to `featureHighlights()` in the release that ships the feature:
`{ id, sinceVersion, target, title, body, reveal? }`. `sinceVersion` is that release (for
example `0.8.0`, not the current one: the current version is treated as already seen),
`target` is the control's `data-usage-guide` name (add the attribute to the control and the
name to `model/usageGuideTargets.ts` if it has none), `title` and `body` use literal `t()`
calls (add the strings to the eight locale catalogs), and `reveal` is an optional safe
navigation action from `model/guide.ts` that brings a hidden control on screen. Remove old
entries once a few releases have passed.
