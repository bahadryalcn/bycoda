# Skill availability and owner preferences

Skill files, provider discovery, provider permissions, and bycoda preferences are
separate states. Installation and same-name precedence never grant enablement.

The Skills switch controls a **logical skill name on one machine**, across project,
personal, provider and plugin copies. Disabling a winner must not load a shadowed
copy. The preference applies to every bycoda provider on that machine, not to other
machines or external CLI sessions. Provider restrictions remain independently
authoritative when the bycoda switch is enabled.

## Storage and migration

`~/.bycoda-host/skill-policy.json` contains `disabledNames` and `disabledPaths`.
The desktop and host share this file. UI changes persist before the switch changes;
failed saves remain visible. Changes are per-name mutations so unrelated preferences
are retained. Remote switches run against the owning host, including personal skills
without an open remote project. No conversation tool can change these preferences.

The desktop's legacy `bycoda.disabledSkillPaths` localStorage value is migrated once
on the owning machine. Remote path identities are translated only for that machine.
After migration the file is authoritative; a stale browser cache cannot restore old
disabled entries. Missing state means no bycoda restrictions; invalid or unreadable
state causes an error instead of silently re-enabling everything.

## Enforcement by provider

All twelve providers use the common turn boundary: explicit disabled `/name`,
`$name` and Pi `/skill:name` invocations are rejected; current owner restrictions
are carried on model turns, including revocation of older bycoda restrictions.
Native commands keep their complete argument string intact. Host search, exact
reads, alternative-copy reads and skill prompt expansion enforce the same policy.

| Provider | Additional native enforcement |
| --- | --- |
| Codex | Read effective native configuration and discovery, merge only disabled path overrides into thread start/resume configuration. Preserve existing native disables. Refresh native discovery and structured skill inputs; carry current restrictions in collaboration developer instructions. Rebind the process to the same conversation when policy changes. Never write the provider's global config. |
| Claude | Per-process `skillOverrides: off` and `--disallowedTools Skill(name)`; retain ordinary commands and enabled skills. Rebind to the same conversation when policy changes. Plugin visibility is not controlled by `skillOverrides`; the Skill denial and current restrictions still apply. |
| OpenCode | Append per-skill deny rules to session permissions, including full-access mode and resumed sessions. Permission update failures propagate. |
| Pi / OMP | Probe the provider's own catalog (including package resources), launch with `--no-skills` and explicit enabled `--skill` paths. Rebind when policy changes. Refuse incomplete catalogs that cannot preserve enabled skills safely. |
| Cursor / Grok / FX / Hermes / Antigravity / Gemini / generic ACP | Current instructions and bycoda-owned tools/invocation gates. The connected protocols do not provide a verified individual native skill-loading control. These are instruction-level restrictions, not a guarantee against independent native discovery or arbitrary filesystem reads. |

## State and lifecycle boundaries

Search excludes bycoda-disabled and known provider-disabled skills. Returned
`enabled` refers to the bycoda gate; `providerEnabled` is `enabled` only when native
discovery establishes it, otherwise `unknown`. `active` continues to mean the
default same-name copy. A shadowed copy can be inspected only while enabled.
Provider-disabled and bycoda-disabled reports retain their reason, so an old
bycoda disable cannot permanently block re-enabling.

Invocation visibility is independent of full disablement. Frontmatter
`disable-model-invocation: true` is manual-only: automatic search/read excludes it
unless the latest owner message explicitly invokes `/name`, `$name` or
`/skill:name`. Tool arguments cannot grant that exception. `user-invocable: false`
is automatic-only: the owner picker and explicit expansion exclude it, while an
enabled model may still discover/read it. Native provider-specific visibility
settings remain owned by that provider.

Settings preview/export remains available for disabled files: inspecting or editing
owner settings is not an agent invocation. No skill body or supporting file is
deleted or rewritten by the switch. Existing provider accounts, plugin permissions
and unrelated configuration are preserved.

Changes take effect at subsequent turn boundaries. A running provider turn may
already have loaded instructions; neither its transcript nor an in-flight model
request can be retroactively erased. Host skill tools recheck persistent policy on
each call. Native commands are never modified by appending policy text to their
arguments. Tests establish source/protocol behavior; live installed-provider and
two-machine acceptance are separate checks.

Native contracts: [Codex configuration](https://developers.openai.com/codex/config-reference/),
[Claude skills](https://code.claude.com/docs/en/skills),
[OpenCode skills](https://opencode.ai/docs/skills/),
[Pi CLI](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/cli.md).
