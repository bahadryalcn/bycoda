---
name: feature-card-template
description: Write or maintain a project feature development skill with a concise workflow, feature-specific contracts and conditional references. Use for feature documentation, not skill installation.
---

# Feature development skills

Use this format for `.agents/skills/feature-<name>/SKILL.md`. Preserve existing
names so discovery, explicit invocations and cross-links continue to work.
These are developer guides; the bundled `bycoda` skill describes operating the app.
All source paths are repository-relative unless stated otherwise.

## Write the entry

1. Describe the development task and scope in frontmatter. Prefer meaningful
   distinctions over every keyword, component or historical project.
2. State when to use the skill and which neighboring feature owns excluded work.
3. Give verified source starting points and a reusable change workflow. Search
   components, copy, locales, callers and operations across affected UI, Host,
   native and mobile layers before narrowing scope.
4. Keep non-obvious contracts visible: identity, drafts, persistence, validation,
   permissions, uncertain outcomes, cancellation and recovery.
5. Point to focused checks and observable failure states. Apply the current task's
   T0/T1/T2 verification; a listed command is not a passing result.
6. Link conditional references and explain when each is needed. Do not require
   reading the Settings parent or every architecture reference for a page-local fix.

Aim for an entry readable within the default 6,000-character skill page, usually
40–90 lines. This is a warning threshold, not permission to drop contracts.
Resource links resolve relative to the skill directory; source paths use repo root.

## Place details once

- Reuse existing `docs/reference/` architecture and `docs/guides/` user behavior.
  Do not duplicate them in every feature skill.
- Add a focused `references/surfaces.md` only when a source map is useful: group
  source owners, UI entry points, operations/storage, platform boundaries and tests.
  Verify paths and distinguish unavailable source from an absent capability.
- Preserve durable owner decisions with exact quote, date, source and supersession
  in an optional reference. Historical permissions never grant new authority.
- Keep proposals separate from current contracts. Reconcile old/new assertions
  against source and decisions; document unresolved differences without inventing
  product policy to simplify the text.

## Maintain without accumulating logs

Read Git state, relevant history and feature claims/session state before editing.
A card is not a claim. Preserve concurrent work; reread if source changes mid-edit.
Update the current contract or map in place when behavior changes. Do not prepend
another dated implementation packet. Task checklists, test counts, screenshots,
build inclusion, blockers and branch/SHA handoffs belong in local task records
under `temp/local/` and `temp/verification/`. Preserve useful retired records under
`temp/archive/` according to `.artifact`. Required ongoing contracts must stay in
maintained documents, not only local archives.

Verify frontmatter/name, readability, relative links and source pointers. Review
that every old critical contract still has a maintained home. Never infer runtime,
installed or release acceptance from a documentation check.
Run `node scripts/checks/check-feature-skills.mjs` for structural documentation
checks. Length/date warnings require review, not automatic truncation or rewriting.
