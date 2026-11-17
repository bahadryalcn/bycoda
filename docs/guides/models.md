# Models and provider settings

Open **Settings > Models** to manage model routing, chat defaults, subagents and providers
for this computer's Host. Its tabs, in order, are **Background work**, **Defaults** and
**Providers**. Decision models have their own Settings page.

Every explicit-save editor in Settings uses one save bar. Its count opens the list of
unsaved changes, grouped by provider, account or section, each with its own undo. Switching
provider or account keeps every edit; a provider with unsaved edits is marked.
Changing a Models tab or save destination, leaving Settings or changing category
with unsaved changes asks: **Save and leave**,
**Discard and leave** or **Keep editing**.
While a save is committing, wait for it to finish before leaving or discarding.

**Plan with AI** appears beside **Smart setup**. The first asks a model to plan;
the second applies the built-in rules. Both update the draft for review before Save.
With an empty model list, Background work opens on **Models & order**; **Jobs** can
still bind fixed models without building a model order.

- **Background work** has five tabs over one draft with one Save: **Jobs**, **Models &
  order**, **Groups**, **Agents** and **Limits**. A dot on a tab marks unsaved changes in
  it. When Save is refused for one model, the save bar's **Show** link opens **Models &
  order** and highlights that row.
  - **Jobs** binds task workers and reviewers, goal planners and final reviews, stewards,
    automations, crew members, assistant and voice roles and text helpers to any model in
    order, a group (also one not saved yet) or a fixed model; saved jobs show "Now uses".
  - **Models & order** is the model list, tried from the top: new work starts on the first
    model with quota left. A line above it counts the jobs that follow the order (plus chat
    fallback when Settings > Chat continues on the model order). Models on work accounts,
    personal accounts and shared accounts are separate lists; a work project uses only work
    and shared models, a personal project only personal and shared ones. **By account**
    (default) groups a list under each account with its colour, provider and live quota;
    an account's **...** menu removes or adds all of its models. **Priority** shows the flat
    list, the only view where a grip reorders rows. Numbers always show the real priority.
    Each model holds its options, how much quota to keep for your own use and what happens
    when a quota is unknown; the first model new work would start on carries a **Next**
    badge and skipped models show why. Tick rows to **Remove**, **Set effort...** or **Add
    to group...** in bulk; Escape clears the selection. **Smart setup**, **Sort** and **Add
    model** are actions here.
  - **Groups** are named, ordered subsets of the list; a group can include other groups
    (its own models first, then each included group, repeats dropped). A group's **Effort**
    (Default, Low, Medium, High) applies at run start to every model that supports it.
  - **Agents** holds the subagent, advisor, effort ceiling and image-model defaults for
    unattended work, with provider and account overrides.
  - **Limits** holds concurrent tasks, daily agent minutes, the default maximum run time and
    a token and cost table for all providers and each installed provider. When the Host can
    attribute it, **Plan share by job** estimates how much of each account's 5-hour or
    weekly window the biggest jobs used.
- **Defaults** manages what new conversations start with (provider, account, model,
  effort, permissions and provider extras) and, in its **Subagents** section, delegation
  defaults: subagents, advisor, subagent effort ceiling and image models. Global
  delegation defaults apply to chats and unattended work; provider, account and explicit
  item settings override them in that order. Project, group and workspace overrides apply
  to chats only.
- **Providers** holds the provider list and, for the selected provider, accounts,
  version and updates, runtime path and its model catalog.

Conversation defaults start with **Bycoda defaults**. New conversations use them
unless their project has its own settings. Choose **Project overrides** in the
scope menu only when specific projects or groups need different settings. Saving
Bycoda defaults does not overwrite project exceptions or change existing conversations.
The old Work and Models settings destinations and search links open Settings > Models.

Effort uses ascending bars, from Faster to Deeper. The selected level appears above
the scale; hover or focus a bar for its full label. Provider effort retains its
Automatic or inherited choice.

The conversation model picker keeps the reasoning heading, current level and bars
together while other options scroll. Narrow panels scroll their model and settings
sections instead of shrinking either list away. Open Help for complete setting
descriptions with the keyboard or touch; hovering is optional.

The Defaults tab shows Chat defaults first, then Advisor, Image models, Subagents and Subagent max effort.
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

Tasks, goals, stewards, automations and crew members expose **Default**, **Any model**
and **Fixed** choices. Default follows the role binding; Any model offers a select
with **Any model, in order** or a group (shown as **Group: X** elsewhere); Fixed
keeps the item's chosen model. **Manage models** opens shared
management. Items without a routing choice use their fixed model.

New runs use the first eligible model at admission. Running sessions retain their
model even if you edit the order or a quota is exhausted. If every candidate is
skipped, pending work waits for eligibility and the next known reset. An empty
order keeps the item's stored model. A failed read does not mean the order is empty.

Routing saves require the Host owner. If another window changes the document,
your stale draft cannot overwrite it: load the latest settings and reconcile your
changes. Hosts without routing support keep their previous selection behavior.

**Settings > Models > Providers** shows the provider list and, for the selected
provider, its detail: sign-in and accounts, runtime or CLI path, hooks, ACP and
that provider's model catalog. Its version, update status and check, update and open-folder
actions sit in that provider's header; **Check all** and **Update all** sit above the list. Sign-in: Claude Code, Codex and Grok Build
accept several named accounts, each signed in to its own profile; a Grok Build
account keeps its own sessions, so switching a conversation to another Grok
account continues from a summary. OpenCode and Antigravity keep one sign-in per
computer: their account row can be renamed, coloured and tagged Personal or Work,
and Antigravity's setup steps open below it. The
catalog manages model availability. Decision models have their own page, **Settings > Decision models**. Shared model
order, limits and groups are managed in Settings > Models > Background work.

**Settings > Usage & limits** is a separate page for provider usage, quotas and
local budgets. Existing usage links and Settings search open that page.
Switching between Providers and Usage & limits keeps account drafts and pending
sign-in operations intact. Finish or cancel account changes before switching the
selected provider or its inner tabs. Account names show validation beside the field;
choose a distinct name before starting browser sign-in. Searching for Antigravity
account setup opens its setup steps.

Provider account rows separate identity from usage status. The check beside an account marks its provider default. Account management shows complete names and plan details, and terminal profiles wrap their full paths. Email masking stays in effect until you choose Reveal email. CLI updates show model-refresh errors only when discovery fails; an unchanged model list needs no warning.

Account profiles lists only signed-in Claude, Codex and Grok profiles: the default CLI home, home folders such as `.claude2`, and accounts saved by the release or dev app. Each signed-in identity appears once, and an account you already added shows as Connected. If automatic terminal profile discovery fails, open Account profiles to see the error and select Find terminal profiles to retry.

**Settings > Models > Chats** sets what new conversations start with; subagents, the advisor and the subagent effort ceiling are set only in **Subagents**. With Global selected and a provider that has several accounts, **Account** picks whose own defaults the rows edit. With a project, group or workspace selected, **Account** picks which account that provider's new chats start on there; the rows then show that account's defaults as Bycoda defaults, and anything you change is saved for the project. A row that follows a default shows the value it resolves to, such as the effort level it fills in.

Decision models keep connection status on each model row. Open Details for full connection paths, and expand Scan settings to change discovery locations. Collapsing these settings keeps unsaved values.

In **Settings > Models > Background work > Limits**, token and cost limits can be set for all providers and for each provider, per local calendar day, week (Monday to Sunday) or month. The table shows token limits; **Cost limits** reveals the USD columns, which stay open while any cost is set (subscription plans have no real dollar cost, so USD is the API list-price equivalent). Token cells accept shorthand such as 500K or 5M. Empty values and zero mean unlimited. Limits prevent new unattended turns after a threshold is reached; a turn already running can exceed it. For Claude, Codex and OpenCode, **Keep free (%)** is a provider default for models without their own reserve: those models are skipped while less than that share of the account's plan quota is left.

## Automatic compaction

The model picker offers the compaction controls supported by the current provider.
Save them in **Settings > Models > Chats**, as Bycoda defaults or as
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

Background work is edited on the selected Host with one Save bar. Changes remain drafts until Save; a version conflict requires loading the latest settings before saving again. Quota read failures show a retry action; an unknown quota is a separate valid state.

Decision models show the Host used for scanning, local installation and saved keys. The app prefers this computer’s Host, then the first connected Host. Adding a model and testing it are separate steps: a failed connection test leaves the added source available to edit or retry.

In **Settings > Models > Background work**, **Smart setup** fills the whole draft at once. It adds every active provider account and enabled model that is missing, orders them, fills the groups, binds every job in Jobs and sets subagents and the advisor. Strong models at a moderate price (such as Opus and Sol) come first, cheaper capable models (Sonnet, Terra) next, top-priced models (Fable, Astra) after them and light models last; reviews and planning use a group led by the strongest models, quick replies and helper text such as titles, commit messages and translation go to cheap fast models, and Work and Personal groups are created when an account has a kind. The advisor is the strongest model; each provider's best standard and light model become subagents, capped at Medium effort, replacing provider and account overrides of those settings in the draft. Prices come from OpenRouter and capability scores from Artificial Analysis (through OpenRouter), fetched by the Host and cached for six hours; the built-in table keeps the owner-reviewed ordering of known families and is used when the feed is unavailable. **Plan with AI**, beside Smart setup, asks the model bound to **Routing setup** (otherwise the cheapest strong model you can use) to plan from the same data. Effort follows the job: the main order runs at Medium, groups used only by simple jobs at Low, and groups used by reviews or planning at High; a model without a level gets its closest one, so the same model can appear once per effort. Smart setup never picks an effort above High: set higher levels on an entry yourself, and an entry you set above High is kept for the High groups. Groups with the same name are refilled; other groups, entries, ids, limits and settings stay unchanged. A notice names the model that planned it; when no model can plan, or the planner times out, fails or returns an unreadable answer, the researched ranking and built-in rules are used and the notice names the planner and the reason. Invalid parts of an answer are dropped instead of discarding the whole plan. Review the draft and press **Save** to apply through the existing Host-owner and version checks. If the model-order or group limit would be exceeded, nothing is added; reduce unused choices or groups and retry.

Accounts, projects and project groups can be tagged **Personal** or **Work**. An account without a tag, or whose name does not say work or personal, is shared. A run in a tagged project skips accounts tagged for the other kind and moves on to the next entry; if every entry is skipped, the work waits. Fixed models are never filtered, and runs without a project (such as the assistant) are unaffected. Tagging a project overrides its group's tag.
