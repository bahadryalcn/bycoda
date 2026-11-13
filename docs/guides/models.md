# Models and provider settings

Open **Settings > Models** to manage model selection for this computer's Host.
Its four tabs separate shared routing from chat preferences:

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

Effort uses ascending bars, from Faster to Deeper. The selected level appears above
the scale; hover or focus a bar for its full label. Provider effort retains its
Automatic or inherited choice.

Subagent max effort uses the same bars and has a separate **Automatic** switch. Automatic removes the
ceiling and leaves the child's own reasoning setting unchanged. Manual ceilings run from Low
through Ultra; None and Minimal are not ceiling choices. Old None/Minimal ceilings
are treated as Low. Switching Automatic off restores the last manual choice while
the control remains open (Low initially). Reset restores the inherited setting;
choosing Automatic explicitly overrides an inherited ceiling.

Tasks, goals, stewards, automations and crew members expose **Default**, **Pool**
and **Fixed** choices. Default follows the role binding, Pool follows the selected
pool, and Fixed keeps the item's chosen model. **Manage in Models** opens shared
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
order, limits and delegation are managed in Models.

Provider account rows separate identity from usage status. The check beside an account marks its provider default. Terminal account profiles show their full paths on focus or hover when clipped. CLI updates show model-refresh errors only when discovery fails; an unchanged model list needs no warning.

Decision models keep connection status on each model row. Open Details for full connection paths, and expand Scan settings to change discovery locations. Collapsing these settings keeps unsaved values.
