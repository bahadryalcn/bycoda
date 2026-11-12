---
name: bycoda-skill-router
description: Use when the owner asks to choose or find a skill, or when no known skill or project rule covers a task that needs specialist knowledge. Not for ordinary coding with available tools.
---

# bycoda skill router

Help complete the owner's task using the smallest useful set of skills. Selecting
a skill is only preparation: read its instructions, apply them to the work, and
verify the requested result. A recommendation list alone does not finish the task.

## When to route

- Route only when the owner asks to choose or find skills, or the task clearly needs
  specialist knowledge absent from context and project rules.
- Ordinary coding with available tools skips routing.
- Before calling bycoda's own tools, read the `bycoda` skill. Other work does not need it.
- Reuse skills already read in this conversation while their scope and current
  restrictions still apply. After compaction, recover the selection from context
  and reread only what is missing. Recheck availability after a machine/provider
  change or a new owner restriction.
- Honor explicitly requested skills when allowed. If a requested skill is blocked,
  explain the limitation and continue with allowed capabilities. Do not replace it
  with a same-name copy or enable it.
- Do not select this router as a task specialist or pass the same selection
  decision back and forth between skill-selection routers. Domain entry skills
  may load their required specialist skills; follow those handoffs without
  restarting general discovery. Do not launch another conversation just to load
  a skill.

## Find installed candidates

1. Identify the actual outcome, affected stack, project rules, and tools already
   available.
2. Use the session's Conversation Tools: `conversation_tools_list` discovers exact
   actions; `skills.search` searches installed skills and `skills.read` reads one.
   If MCP is absent, use the exact CLI command from the session's bycoda tools hint,
   first `<group> --help`, then `<group> <action> --input -` with JSON on stdin.
   Do not invent `skills.install`, `skills.activate`, or `skills.use` actions.
3. Search with at least two short, task-specific queries, usually the outcome and
   the affected technology/problem. Use the owner's language and relevant English
   terms where useful. Start with `limit: 8`; inspect `nextOffset` or refine the
   query when promising results may be outside that page. If `truncated` is true,
   report incomplete discovery instead of declaring a skill absent.
4. Compare candidate descriptions, task coverage, scope, source, and the tools
   needed to follow them. Prefer the narrowest applicable project skill over
   broad advice. A specialist that matches the task beats a generic keyword hit;
   the highest-ranked search result is not automatically the best choice.

Current owner instructions, project contracts, and provider restrictions take
precedence throughout. Never search for, read, invoke, install, or delegate to a
disabled skill, including same-name copies at other paths. Respect manual-only
skills: do not load one automatically without the owner's explicit invocation.

Search is an installation inventory. `enabled: true` refers to the bycoda gate;
`providerEnabled: "unknown"` does not establish provider permission. Follow current
provider restrictions and use available native discovery when that distinction
matters. `active: false` means a shadowed same-name alternative, not a disabled
skill. Inspect an alternative only if allowed and meaningfully better suited;
retain its exact `name`, `source`, and `scope` when reading it.

## Read, select, and apply

1. Choose one primary skill. Add complementary skills only for distinct needs
   such as implementation plus browser verification; retain any explicitly
   requested or project-required skills. Do not load every plausible match.
2. Call `skills.read` with the chosen exact name and, when selecting a specific
   copy, its returned source/scope. Reads are bounded: use `maxChars: 6000` and
   follow `nextOffset` until the instructions needed for the task are complete.
   Resolve linked resources relative to the returned SKILL.md path and read only
   relevant resources. Recheck restrictions before reading supporting files.
3. Briefly state which skill(s) will be used and why, once per changed selection.
   Follow their relevant workflow while doing the original task. If instructions
   conflict, follow owner/project requirements and retain useful compatible parts.
4. If a skill depends on an unavailable tool, account, plugin, or provider, state
   the specific missing capability. Installation alone cannot connect an account,
   grant permissions, or supply an unavailable native tool. Use an allowed fallback
   if it can complete the work.

## Missing skills

Nothing is installed, enabled, or granted without an explicit owner answer.
Read `references/missing-skills.md` only when a needed skill is actually missing.
