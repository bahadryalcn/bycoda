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

## Native subagents stay inside the selection

Date: 2026-11-08

Owner: "right now when it calls agents it seems it can call agents other than the ones I selected" (translated)

A saved subagent selection bounds every subagent path. Claude's native Agent tool is forced onto the one same-account Claude selection or removed; Codex's native multi-agent features are off while a selection is set. Host agents tools already reject unselected models.

Update 2026-11-08, owner: "please fix these too" (translated). Grok starts with `--no-subagents`; OpenCode sessions deny the `task` (v1) and `subagent` (v2, verified on 2.2.5) permissions. Antigravity, Cursor, Fx, Hermes, Pi, OMP and generic ACP have no verified switch yet and remain unenforced.
