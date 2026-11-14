# Models and provider settings

Open **Settings > Background work** to manage shared model routing and limits for this computer's Host.
Its tabs contain Model order, Assignments and Subagents. **Settings > Providers > Defaults** keeps chat defaults:

- **Model order** defines the main priority order, provider accounts, model
  options and how much quota to keep for your own use. Choose what happens when
  a quota is unknown. Pools are named, ordered subsets of this order; they share
  its model definitions and limits. Daily agent minutes and the default maximum
  run time also live here.
- **Assignments** binds task workers and reviewers, goal planners and
  final reviews, stewards, automations, crew members, assistant and voice roles,
  and text helpers to the model order, a pool or a fixed model. Unbound text helpers
  keep their own inexpensive automatic selection.
- **Chat defaults** manages conversation model preferences. Project, group and
  workspace overrides apply to chats only.
- **Subagents** manages delegation defaults: subagents, advisor, subagent effort
  ceiling and image models. Global defaults apply to chats and unattended work;
  provider, account and explicit item settings override them in that order.

Conversation defaults start with **Bycoda defaults**. New conversations use them
unless their project has its own settings. Choose **Project overrides** in the
scope menu only when specific projects or groups need different settings. Saving
Bycoda defaults does not overwrite project exceptions or change existing conversations.
The old Models settings destination and search links open Providers > Defaults.

Effort uses ascending bars, from Faster to Deeper. The selected level appears above
the scale; hover or focus a bar for its full label. Provider effort retains its
Automatic or inherited choice.

The conversation model picker keeps the reasoning heading, current level and bars
together while other options scroll. Narrow panels scroll their model and settings
sections instead of shrinking either list away. Open Help for complete setting
descriptions with the keyboard or touch; hovering is optional.

The Agents tab reads Advisor, Image models, Subagents, then Subagent max effort.
These controls scroll together. Selected image and subagent models remain readable
alongside their removal actions. Auto-compact window uses a slider in 50K-token steps;
its first position restores Default. Codex starts at 50K, Claude Code at its native
100K minimum; the provider's supported window remains the limit.

Subagent max effort uses the same bars and has a separate **Automatic** switch. Automatic removes the
ceiling and leaves the child's own reasoning setting unchanged. The picker shows
**No limit** while Automatic is on. Choosing a bar sets a manual ceiling. Manual
ceilings run from Low through Ultra; None and Minimal are not ceiling choices. Old None/Minimal ceilings
are treated as Low. Switching Automatic off restores the last manual choice while
the control remains open (Low initially). Reset restores the inherited setting;
choosing Automatic explicitly overrides an inherited ceiling.

The Subagents count describes selected model choices, not running agents or a
concurrency limit. Selected models appear as aligned rows with removal actions.
Account percentages state how much quota is used. A Default model marker identifies
the account containing the project's default model; it does not change the provider's
default account.

Tasks, goals, stewards, automations and crew members expose **Default**, **Pool**
and **Fixed** choices. Default follows the role binding, Pool follows the selected
pool, and Fixed keeps the item's chosen model. **Manage models** opens shared
management. Items without a routing choice use their fixed model.

New runs use the first eligible model at admission. Running sessions retain their
model even if you edit the order or a quota is exhausted. If every candidate is
skipped, pending work waits for eligibility and the next known reset. An empty
order keeps the item's stored model. A failed read does not mean the order is empty.

Routing saves require the Host owner. If another window changes the document,
your stale draft cannot overwrite it: load the latest settings and reconcile your
changes. Hosts without routing support keep their previous selection behavior.

**Settings > Providers** contains **Accounts**, **CLI**, **Catalog** and
**Decision models**. Accounts manages sign-in; the Grok row reports the Grok Build
CLI sign-in on this computer. CLI manages installed agent tools. Catalog manages
model availability. Decision models configure decision routing. Shared model
order, limits and delegation are managed in Settings > Background work.

**Settings > Usage & limits** is a separate page for provider usage, quotas and
local budgets. Existing usage links and Settings search open that page.
Switching between Providers and Usage & limits keeps account drafts and pending
sign-in operations intact. Finish or cancel account changes before switching the
selected provider or its inner tabs. Account names show validation beside the field;
choose a distinct name before starting browser sign-in. Searching for Antigravity
account setup opens its shared-account instructions.

Provider account rows separate identity from usage status. The check beside an account marks its provider default. Account management shows complete names and plan details, and terminal profiles wrap their full paths. Email masking stays in effect until you choose Reveal email. CLI updates show model-refresh errors only when discovery fails; an unchanged model list needs no warning.

If automatic terminal profile discovery fails, open Account profiles to see the error and select Find terminal profiles to retry.

Decision models keep connection status on each model row. Open Details for full connection paths, and expand Scan settings to change discovery locations. Collapsing these settings keeps unsaved values.

In **Settings > Background work**, token and cost limits can be set for all providers and for each provider, per local calendar day or month. Empty values and zero mean unlimited. Limits prevent new unattended turns after a threshold is reached; a turn already running can exceed it.

## Automatic compaction

The model picker offers the compaction controls supported by the current provider.
Save them in **Settings > Providers > Defaults**, as Bycoda defaults or as
account or project overrides. Unsaved edits remain drafts. Existing conversations retain
their own values. Reset a row to inherit the scope above; choose **Default** to use
the provider's own configuration even when a higher scope specifies an override.

Claude Code offers on/off and a token threshold. Codex offers a token threshold,
bounded by the model's reported context window. Codex still compacts when the native
context limit is reached, so it has no Off control. OpenCode 1.x offers on/off through
its isolated conversation process. omp 18.2.1 and newer offer session-only on/off.
Changing these options takes effect on the next turn; resetting restores provider
configuration while resuming the same conversation. Manual compaction stays available.

Pi's native toggle writes global settings. OpenCode 2.x uses a shared service, and
Grok's inline configuration does not accept its compaction threshold. Bycoda does not
expose session overrides for those transports. ACP-based providers use only controls
advertised by their own catalog. Unsupported settings are not copied across providers.

## Routing and decision model settings

Model order and Assignments are edited on the selected Host. Changes remain drafts until Save; a version conflict requires loading the latest settings before saving again. Quota read failures show a retry action; an unknown quota is a separate valid state.

Decision models show the Host used for scanning, local installation and saved keys. The app prefers this computer’s Host, then the first connected Host. Adding a model and testing it are separate steps: a failed connection test leaves the added source available to edit or retry.

In **Settings > Background work > Model order**, **Create from provider catalog** adds enabled models from available, visible providers and creates one pool per provider account (or provider without account profiles). Existing entries, priorities, custom pools, assignments and limits stay unchanged. Repeating the action does not duplicate the same choices or pools. Review the draft and press **Save** to apply through the existing Host-owner and version checks. Catalog setup uses the current catalog; manage accounts and catalog visibility under Providers. If the model-order or pool limit would be exceeded, nothing is added; reduce unused catalog choices or pools and retry.
