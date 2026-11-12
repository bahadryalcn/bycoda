# Provider decisions

## Product conversation defaults

Date: 2026-11-06

Owner: "I mean for everyone, not for me; let it work that way once connected in bycoda, and you choose for the other providers too" (translated)

New conversations use product model, subagent and advisor defaults for every connected account. Claude uses Opus 5.5 / Sonnet 5.5 / Opus 5.5; Codex uses GPT-6.1 Sol / GPT-6.1 Terra / GPT-6.1 Sol; Grok uses Grok 4.7 for all three roles. Other providers use the catalog-aware policy documented in the agent tools guide.

Product choices are inherited, not saved user overrides. Explicit provider, account and project choices, including Off, take precedence. Generated delegation references use the conversation's account; independent advisors may use the main model. Existing conversations and explicit API/run configurations retain their settings.

## No routing between selected delegates

Date: 2026-11-07

Owner: "let us not do the routing ourselves; whatever is most effective and cost-efficient, whatever is useful, let it choose ... use what is needed when needed, even ahead of cost" (translated)

Runtime guidance and agents tool descriptions list the selected subagent and advisor models, how to call them and their safety limits, but never steer the main model toward a model, a tool (native subagents or agents.*) or delegation itself. The main model decides whether delegating helps and picks the selected model that fits the task, usefulness first and cost second. The selection still bounds which models and accounts may run.

Update 2026-11-12, owner: "I wanted it to do this without my saying so, that is the whole point ... it has to work the same way for everyone" (translated). Runtime guidance now tells the main model to delegate independent parts without being asked and to keep small, sequential or single-file work. It still never steers toward one selected model or tool. The preference lives in the product guidance, not in an owner's global rule files.

## Native subagents stay inside the selection

Date: 2026-11-08

Owner: "right now when it calls agents it seems it can call agents other than the ones I selected" (translated)

A saved subagent selection bounds every subagent path. Claude's native Agent tool is forced onto the one same-account Claude selection or removed; Codex's native multi-agent features are off while a selection is set. Host agents tools already reject unselected models.

Mechanism correction 2026-11-12: Codex 0.167.2 requires `agents.enabled=false`
in thread start/resume config; the two `features.multi_agent` / `features.multi_agent_v2`
flags alone leave native tools exposed. Keep both legacy flags for 0.166.x and
set all three to true for native fallback. Restart and resume the CLI when the
native-agent policy changes; warm turns do not apply thread config again.
On resume, Codex can retain historical tool declarations and send a namespace
removal update instead of deleting the old declarations from history.

Update 2026-11-08, owner: "please fix these too" (translated). Grok starts with `--no-subagents`; OpenCode sessions deny the `task` (v1) and `subagent` (v2, verified on 2.2.5) permissions. Antigravity, Cursor, Fx, Hermes, Pi, OMP and generic ACP have no verified switch yet and remain unenforced.

## Defaults save explicitly to a chosen target

Date: 2026-11-09

Owner: "we can't tell whether it saved ... Apply defaults to should be on a save bar that appears after a change, where I pick X, even a group or a workspace" (translated)

Providers splits into Providers, Defaults, Models and Decision models tabs. Defaults edits are a pending change set; nothing is written until Save, and the save bar names the target (Global, a project, a group or a workspace) and reports saved or not saved. A group or workspace target copies the changed fields into each member project, including projects of nested workspaces; projects added later follow Global. Account overrides stay machine-wide. Provider list switches, model switches, CLI and account actions still save at once.

## New models need no app release

Date: 2026-11-10

Owner: "we should support every model that comes after this too; we can't cut a release for that, I think our structure has a problem" (translated)

The live CLI catalog is the source of truth for what a picker offers, and catalog probes run under the provider account new sessions use (a signed-out ambient profile lists only generic aliases). A version-gated fallback list is provisional: it never counts as a live catalog and never replaces one. Model-specific behaviour must generalize past its table: the Claude advisor table holds anchors only, and a release newer than every anchor of its family ranks just above that family's newest older anchor. Hand-maintained model tables are limited to legacy quirks and offline fallbacks.

## Delegation continuations, effort and waits

Date: 2026-11-12

Owner: "OK, let's add these, and let us allow up to 16" (translated).

`agents.reply` continues the same finished child session with its context and recorded
model/account. Subagents use their model's default effort unless explicitly requested;
advisors continue matching the parent's effort. This replaces effort inheritance for
subagents. `agents.wait` accepts several runs and uses the existing provider-dependent
long-wait deadline. Up to 16 subagents may run at once; the advisor limit stays one.

Update 2026-11-12, owner: "effort can be high too, let the model decide, let us not
say it; maybe the work is high, we do not know" (translated from Turkish). Runtime
guidance asks the main model to set each subagent's effort by the difficulty of its
part, with no level named or capped by the product. A run with no effort named still
uses the model's default.

## Defaults save to several targets and portable provider scope

Date: 2026-11-12

Owner: "I have more than 100 projects; doing something different for each would take hours ... these choices are made per provider, so it becomes 100 times the provider count. Let us find a better way here." (translated from Turkish)

Defaults remain pending until explicit save. The apply bar separates provider scope
from a multi-select of Global, workspaces, groups and projects. Each destination is
attempted independently; partial failures retain the draft and retry only failed
destinations. Workspace and group saves still copy into current member projects;
later projects follow Global. Account overrides remain machine-wide. This extends
the earlier single-target save decision.

All providers copies only explicit portable edits supported by each destination
provider, including compatible effort, permission and speed choices. Unsupported
fields are skipped and reported. Model and account selections, including selected
delegate and image-model identities, never cross providers; automatic resets and
explicit delegation Off can remain portable.

## Account kind is an owner override

Date: 2026-11-12

Owner: "We cannot edit the accounts. Let us be able to mark them as a personal or work account." (translated from Turkish)

The account editor saves name, color and an optional Personal or Work kind together.
An explicit kind takes precedence over the kind derived from account information.
Automatic removes that override and restores derivation. It does not change account
credentials, entitlements or execution authority.

## Automatic subagents, tiers and max effort

Date: 2026-11-12

Update 2026-11-12, owner: "under Automatic, falling back to the provider's native subagents is allowed; under an explicit list or with a subagent effort ceiling set, do NOT enable unrestricted native subagents". A fresh, bounded session-scoped initialize check precedes provider input finalization. Failed or unavailable checks permit native fallback only for Automatic without a ceiling, with runtime guidance and a non-blocking conversation status. Explicit Off remains unchanged. Metadata is not readiness; a successful preflight does not acknowledge the provider's later MCP handshake.

Owner: "When nothing is selected and it is automatic, write Automatic instead of 0.
Subagents need not be the same model or just one: give all active models, ranked.
Best: Fable, good: Opus, medium: Sonnet, low: Haiku; it chooses itself. For its own
provider use its own account; it may choose all providers." (translated)

Automatic resolves the connected, enabled catalog when used. It retains unknown
families as Unranked and deterministically caps references while retaining providers
and tiers. The main agent chooses the lowest adequate tier, usefulness first, then
cost. Automatic and explicit Off are distinct from manual lists. This replaces the
single-model subagent product default of 2026-11-06; saved conversations and explicit
choices remain unchanged. Advisor defaults do not change.

Owner: "Also add a Subagent max effort setting, because I may want the main agent
on low and subagents on max. People must be able to set this easily and effectively."
(translated)

Subagent max effort is a portable, independently inherited ceiling. Automatic means
no ceiling; a saved level caps explicit effort and model-default effort, including
continuations. Provider Defaults use the existing draft/save and scope rules.
