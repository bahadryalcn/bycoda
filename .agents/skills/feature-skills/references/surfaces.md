# Skill-management surfaces

All source paths are repository-relative. Canonical policy semantics live in `docs/reference/skill-policy.md`; this map does not re-grant access to restricted files.

| Area                          | Owner                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library/detail/policy/forms   | `src/features/skills/ui/SkillsPage.tsx`, `SkillsPage.module.css`, `SkillRow.tsx`, `SkillMachinesPanel.tsx`, `CreateSkillDialog.tsx`, `SkillPicker.tsx`, `SkillPromptField.tsx`; `src/features/skills/model/skillLibrary.ts` |
| Document rendering/editing    | `src/features/skills/ui/SkillDocumentPreview.tsx`; `src/features/notes/ui/NoteMarkdownEditor.tsx`; `src/features/sessions/ui/MarkdownDocumentPreview.tsx`, `AgentMarkdown.tsx`; shared selection/mode owners                |
| Catalog/policy                | `src/features/skills/model/skills.ts`, `skillPreferences.ts`, `machineSkills.ts`, `cliCommands.ts`, `cliCommandCatalog.ts`; follow current imports instead of assuming a separate skillCatalog implementation module        |
| Transfer/create/delete        | `src/features/skills/model/transferSkill.ts`, `createSkill.ts`, `deleteSkill.ts`; remote-command client                                                                                                                     |
| Native/IPC policy             | `src/platform/tauri/fs.ts`; `src/integrations/harness/core/skillPolicy.ts`; `src-tauri/src/skills.rs`, `remote.rs`, `lib.rs`                                                                                                |
| Host/tool/provider boundaries | `host/skills/skills.ts`, `skill-policy.ts`, `app-skills.ts`, `harness-skills.ts`, `prompt-skills.ts`, `workspace-commands.ts`, `conversation-tools.ts`                                                                      |
| Composer integration          | `src/features/sessions/model/sessionSkills.ts`; provider discovery and structured skill input consumers                                                                                                                     |

## Operations and data

- Recommended catalog: `src/features/skills/ui/RecommendedSkills.tsx`, `RecommendedSkills.module.css`, `src/features/skills/model/recommendedSkills.ts`; source metadata only, ranked by general usefulness rather than benchmark scores.
- Opt-in source installation: `skillInstallation.ts`, `skillInstallTypes.ts`, `skillInstallRecipe.ts`, `host/skills/skill-install.ts`; visible public installer command/reference and owner-only `skill_catalog_install` / `skill_catalog_install_status` workspace commands, with durable receipts in `~/.bycoda-host/skill-installs/` and `.bycoda-install.json` provenance/provider markers. These are not model installation tools.

- Commands: `list_skills`, `skill_policy_get`, `skill_policy_set`, `skill_export`, `skill_import`, `skill_delete`, `read_text_file`, `write_text_file`; remote dispatch uses `workspace.run` with exact machine/cwd.
- Changes notify `bycoda:skills-change`. Current explicit refresh must refresh owning-machine policy and fence older in-flight results; a stale cache must not re-enable or re-disable a skill.
- Preserve full-directory transfer validation, limits, stage/rollback and protected namespaces in current Host/native source. File copy does not prove executable-mode or installed-provider acceptance.
- Preview support assets require source/document/cwd context. Split needs one draft owner, actual raw/rendered panes, correct read-only access and an explicit scroll contract.
- Mobile composer catalog consumption is in `mobile/src/features/workspace/use-composer-catalog.ts`; access through `workspace.run`/`list_skills` does not imply a complete phone management surface.
- Search actual Skills/Edit/Preview/Source/Split/policy/transfer messages and Settings reveal metadata; do not assume a `skills.*` localization namespace.

## Focused checks

Start with SkillsPage/SkillDocumentPreview/SkillPicker/SkillPromptField tests, transferSkill/skills/skillPreferences/skillCatalog/cliCommands/sessionSkills tests, Host skills/policy/harness/prompt tests and Rust skill tests according to the affected layer.

Browser: `tests/browser/settings-skills.e2e.ts` and current Settings config. Cover disabled/manual/provider policy, remote refresh and stale-reader races, dirty-transfer refusal, Save/read/conflict failure, leave/return retention, frontmatter/support assets, raw access, split sizing and per-machine recovery. Real replacement dialogs, filesystem rollback, installed-provider enforcement and mobile access require their actual boundary, not mocked commands.
