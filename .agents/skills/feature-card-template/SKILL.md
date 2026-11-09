---
name: feature-card-template
description: Write or maintain a project feature development skill with a concise workflow, feature-specific contracts and conditional references. Use for feature documentation, not skill installation.
---

# Feature development skills

Use this format for `.agents/skills/feature-<name>/SKILL.md`. Preserve existing
names so discovery, explicit invocations and cross-links continue to work.
These are developer guides; the bundled `bycoda` skill describes operating the app.
Source paths are repository-relative, directory-level where possible, never `path:line`.

## When to write

- Create a skill only for a new T2 feature that has no owner yet.
- Edit a skill only when an entry point, owner, contract or focused check changed,
  or `node scripts/checks/check-feature-skills.mjs` reports a broken pointer.
- A fix, perf change or refactor covered by its regression test changes nothing here.
  If you are about to add a bullet that starts with the defect you just fixed, stop:
  that belongs in the test name and the commit message.

## Required shape

```markdown
---
name: feature-<name>
description: <task and scope in one sentence; name the neighboring owner of excluded work>
---

# <Feature>

One paragraph: what the feature owns across UI (`src/features/<name>/`), Host
(`host/<name>/`), native (`src-tauri/src/<name>/`) and mobile, and who owns the rest.

## Source starts

Folder-level pointers per layer, with the public entry (`index.ts`, domain service).

## Workflow

3–6 numbered steps for a typical change: locate, trace ownership, preserve, check.

## Preserve

At most 12 bullets. Each names a lasting contract (identity, drafts, persistence,
validation, permissions, cancellation, recovery) that a reader could not infer from
types or tests. No incident history, no thresholds that a test already pins.

## Focused checks

The test folders and commands that cover this feature; a listed command is not a
passing result.

## References

Links to `docs/reference/`, `docs/guides/` and optional `references/*.md` with one
clause on when each is needed.
```

Keep the entry under 6,000 characters (about 40–80 lines). The check reports a larger
entry as an error; shorten by linking a reference, not by dropping a contract.

## References, once

- Reuse `docs/reference/` architecture and `docs/guides/` user behavior by link. Do
  not restate them.
- `references/surfaces.md` is optional and lists owners at folder level: UI entry,
  model/store, Host service and storage, native module, tests. It is not a file list
  and not a grep transcript.
- `references/decisions.md` holds only owner decisions that change a lasting contract:
  exact quote, date, source. Historical permissions never grant new authority. Task
  handoffs, checklists, counts, screenshots, SHAs and session IDs stay in
  `temp/local/<id>/` and `temp/verification/<id>/`.

## Checks

`node scripts/checks/check-feature-skills.mjs` rejects: missing or mismatched
frontmatter, broken links, missing source pointers, entries over 6,000 characters
(beyond the reviewed allowance), dates, commit SHAs, session UUIDs and `path:line`
pointers outside `references/decisions.md`. A documentation check never proves runtime
or acceptance behavior.
