---
name: feature-card-template
description: Create or refresh a bycoda feature card with a code-backed surface inventory, quoted owner decisions, preservation rules and acceptance evidence.
---

# Feature-card authoring

Use this template for `.agents/skills/feature-<name>/SKILL.md`. Replace the
example fields with findings; do not copy unverified paths or treat an inventory
as evidence that behavior passed. Keep `name` and `description` frontmatter so
project `skills.search` can discover the card. The description should name the
feature and its common search terms. Paths below are repository-relative.

Before editing, read recent Git history and live feature claims for the canonical
project/feature. Coordinate dependencies or a separate sub-scope. A tracked card
is guidance, never the concurrency lock. If claims are unavailable, record the
gap and consult available session state. Do not install user-profile skills.

## Required card structure

1. **Purpose and keywords**: user outcome, scope boundaries, synonyms.
2. **Surface inventory**: enumerate desktop components and app wiring; models and
   persistence; Host RPCs/tools with exact identifiers and dispatcher/service
   paths; Rust modules/commands; mobile screens/routes; locale key prefixes or
   actual textual families; browser fixtures, specs and configs. Search the code
   for components, copy, classes, keys and operation names. Record search roots
   and baseline commit. Distinguish an absent surface from unavailable source.
   Directory inventories may group implementation modules, but list user-facing
   components, routes and tests explicitly. Follow imports/callers across layers.
3. **Owner decisions**: exact quote, date, session/source and supersession when
   applicable. Leave empty when no attributable quote exists. For this inventory,
   accepted quote sources are the working-model research.json/README identified
   in the stream brief. Researcher conclusions are not owner decisions.
4. **Behavior to preserve**: functions, drafts, state ownership, persistence,
   validation, async progress/cancellation/retry, permissions and recovery.
5. **Checks and visual scenarios**: focused commands and observable acceptance
   per surface. UI evidence covers 1280/800 widths and light/dark, with captures
   opened/reviewed. Add keyboard, reduced motion and relevant empty/error/pending
   states. Use fake repositories/temp data for destructive behavior. Distinguish
   fixture, isolated native/Host, installed and released evidence.
6. **Known blockers**: concrete missing capability, access or check; no generic
   disclaimer. Separate frozen contracts from implemented/routed capabilities.
7. **Committed handoff references**: branch, immutable commit and delivered scope;
   checks/artifacts and build identity/inclusion. Never invent a commit or use a
   dirty plan as delivery evidence. Use the existing baseline until committed
   delivery exists, then refresh in the next coherent change.
8. **Proposals**: agent ideas, clearly separate from decisions and delivered work.

For T2 work, maintain a complete per-surface checklist with done/partial/blocked
and evidence. Re-search the feature and compare the inventory before handoff;
resolve omitted surfaces or name their blocker. Update user guides with behavior
changes. Check build status/source identity before diagnosing screenshots; equal
versions or capture times cannot establish source inclusion. Keep temporary
evidence under `temp/verification/<id>/` and plans under `temp/local/<id>/`.
