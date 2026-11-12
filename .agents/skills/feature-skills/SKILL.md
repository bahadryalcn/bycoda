---
name: feature-skills
description: "Use when changing skill-management source code, discovery, policy and transfer. Not for using skills; see feature-card-template."
---

# Skill management development

Use for Skills management UI, catalog/policy state, document edit/preview/split, copy/import/export/delete and provider invocation integration. Ordinary app operations use the bycoda tool guide; this skill is for source changes and grants no install or enable authority.

## Source starts

- `src/features/skills/ui/SkillsPage.tsx` composes the library and detail; `SkillRow.tsx`, `SkillMachinesPanel.tsx` and `CreateSkillDialog.tsx` own the row, per-machine copy/toggle tab and creation dialog. `SkillDocumentPreview.tsx`, `SkillPicker.tsx` and `SkillPromptField.tsx` own document and invocation surfaces.
- `src/features/skills/model/skills.ts`, `skillPreferences.ts`, `machineSkills.ts`, `transferSkill.ts` and `deleteSkill.ts` own data/actions; `skillLibrary.ts` merges machine lists into rows and answers presence and "already installed" by name.
- Read [skill policy](../../../docs/reference/skill-policy.md) for canonical availability/enforcement rules; use [surfaces](references/surfaces.md) for source/test routing.

## Recommended catalog and installation

- `RecommendedSkills.tsx` and `recommendedSkills.ts` own the public third-party, metadata-only catalog and original publisher links. Never import personal/project-owned skills into recommendations. Keep prerequisites visible; never bundle third-party skill bodies or silently install optional tools or hooks.
- `skillInstallRecipe.ts` owns the visible command, pinned public Skills CLI version and installer reference. This standardized installer is distinct from a publisher's own preferred installer. Execute argv without a shell, in an isolated temporary project/home/cache with a deadline; package lifecycle scripts stay disabled.
- Installation uses `skillInstallation.ts` and Host `skill-install.ts` through authenticated owner workspace commands. Validate the registered project, machine, scope, provider, allowlisted source, bounded CLI-produced subtree and matching skill name. Resolve one upstream commit and preserve supporting files and executable modes.
- Never overwrite existing destinations or change enablement policy. Publish discovery only after supporting files and provider marker exist; reconcile uncertain operations by original request identity before any retry.
- Catalog-managed provider markers filter before same-name precedence in native/Host/composer discovery. Preserve legacy skill visibility and independent machine/provider restrictions.

## Preserve

- Host/native policy writers share their existing lock and schema and sync before replacement. Retain corrupt/unreadable policy in place; a dangling link or failed read must not become an empty policy or re-enable disabled skills on the next read.

- Installation inventory, same-name active copy, owner machine enable policy, invocation metadata and provider restrictions are separate states; enabled in one layer is not permission in another.
- Disabled names apply across sources on the owning machine. Reads/search/invocation and late results must respect fresh authority; no shadowed-copy bypass or local overwrite of remote policy.
- Preserve local/remote/managed source identity and allowed edit/raw-view access; YAML frontmatter, supporting assets and document/cwd context survive preview/edit/split.
- Keep one retained draft and disk-comparison baseline across selection/navigation. Failed reads, save conflicts and failed writes retain edits; clear only the exact saved draft.
- Transfer requires clean source drafts, exact owning machine/source, existing path/size/duplicate protections, staging/rollback and explicit native replacement consent.
- Preserve catalog contents, scroll/focus/selection during scoped refresh; distinguish confirmed copy from subsequent discovery failure and reconcile unknown copy results before retrying.
- Delete retains native confirmation, protected namespaces, disabled-preference cleanup and catalog refresh. A documentation/source edit is not a live install/toggle/copy/delete authorization.
- Keep policy read/save/discovery errors scoped to the owning machine; failed durable saves must not display success. Distinguish loading/read failure/saving/dirty/known saved document state.

## Workflow

1. Trace management action through UI, model, native/Host and provider turn boundary only as affected; follow current policy before loading any supporting skill.
2. Use existing Markdown editor/preview/selection and overlay owners; read [Markdown preview](../feature-markdown-preview/SKILL.md) if scroll/split semantics change.
3. Select focused suites from the map. Exercise fresh-disable/offline/late-reader races, draft/conflict recovery, one/many unavailable machines and copy/replace unknown outcomes with fake stores; verify native/provider/device boundaries separately.

## References

- Read [surfaces](references/surfaces.md) for command identifiers, source maps and targeted verification.
- For contributor-owned feature-card authoring, use [feature-card template](../feature-card-template/SKILL.md); it is distinct from the product Skills manager.

## Focused checks

Use the focused test owners in [the surface map](references/surfaces.md).
