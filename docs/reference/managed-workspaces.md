# Managed workspaces

This reference defines the worktree-first contracts. Contract availability does
not mean a Host implements or advertises a capability. Execution paths advertise
capabilities only after their behavior and recovery protocol exist.

## Ownership and policy

`ManagedWorkspace.id` is the authoritative workspace identity. `repositoryId`
identifies the canonical common Git directory; `cwd` remains project identity and
the workspace path is the execution directory. Owners are sessions, tasks,
automation runs or steward runs. One independently scheduled writer owns a
workspace; parallel child writers receive separate workspaces.

New coding work defaults to worktrees. Existing sessions keep their checkout
until explicitly migrated. Policy precedence is explicit owner creation choice,
then project policy, then execution-host default. Resolve the selected committed
base to an immutable SHA before creation; never copy an unrelated dirty checkout.
A configured root applies to new directories and does not move existing ones.

Branches use `bycoda/s/<slug>-<12id>` or `bycoda/t/<slug>-<12id>`; directories use
`wt-<12id>`. Generate names once. Validate collisions and ownership with the full
workspace ID, not its shortened display form. Creation failure never falls back
to main. Older Hosts require a visible update explanation.

`WorkspaceNames` freezes helper signatures only: S1 supplies branch/directory
naming and S2 supplies turn/rewind refs. Constants define prefixes and the
12-character display ID length; implementations still validate Git ref components.

## Lifecycle and storage

Lifecycle and directory existence are independent:

| Lifecycle state | Meaning                                           | Default automatic directory retention |
| --------------- | ------------------------------------------------- | ------------------------------------- |
| `active`        | Execution, writer or mutation in progress         | Never                                 |
| `idle`          | Unfinished, without active execution              | 14 days since meaningful activity     |
| `finished`      | Implementation/checks finished, awaiting delivery | 7 days                                |
| `merged`        | Delivery verified and recorded                    | 24 hours                              |
| `abandoned`     | Explicitly closed without delivery                | 7 days                                |

Directory states are `present`, `pendingRemoval`, `removing`, `removed` and
`blocked`. All retention periods support Never; pinning disables automatic
removal. Active work always retains Never regardless of policy overrides.
Inactivity does not imply abandonment. Removing a directory preserves
the conversation, local branch and recovery refs; resume rematerializes it.

The retention scheduler runs on startup, lifecycle transitions and hourly. Fresh
ownership, canonical path, branch/HEAD, clean source and activity checks precede
removal. Failed status reads mean unknown. Dirty work blocks automatic cleanup;
an explicit owner plan must bind the observed fingerprint and preserve source
state before removal. Unknown directories and main are never cleanup targets.

Default disk policy is 50 GiB for materialized directories, an 80% warning and
20 GiB minimum free space. Shared caches and recovery objects are reported
separately. Pressure only accelerates already eligible clean directory cleanup;
it cannot authorize source loss or deletion of unmerged branches/rescue refs.
Insufficient safe reclamation pauses new materialization.

Windows removal reserves the workspace against process starts, validates the
managed root/target without following reparse points, enumerates links with
no-follow metadata, and detaches dependency junctions/symlinks as link entries.
It preserves evidence/recovery material outside the directory before Git
worktree removal, then reconciles registration/remnants. Never recurse into link
targets. Unknown or unsafe reparse points block automatic removal; blocked
handles remain recoverable. Retirement never deletes shared caches.

## Rewind and delivery safety

Turn history maps accepted user boundaries to branch HEAD, index metadata,
working-copy snapshots, path manifests and capture status. Capture occurs before
provider execution. Unsupported or incomplete capture must not promise exact
rewind. Keep checkpoints for every boundary still offered as rewindable.

Retained ref namespaces are:

```text
refs/bycoda/turns/<workspace>/<turn>/before-head
refs/bycoda/turns/<workspace>/<turn>/before-index
refs/bycoda/turns/<workspace>/<turn>/before-worktree
refs/bycoda/turns/<workspace>/<turn>/after-head
refs/bycoda/rewinds/<operation>/rescue-head
refs/bycoda/rewinds/<operation>/rescue-index
refs/bycoda/rewinds/<operation>/rescue-worktree
```

HEAD refs retain commits; index/worktree snapshots may wrap trees in internal
commits. Preserve separate index metadata for exact staging restoration. These
are turn/recovery records, with no periodic WIP ring or nightly job.

Rewind previews use short-lived plan tokens. Apply settles writers and buffers,
acquires execution/session/Git gates, revalidates revisions and fingerprints,
and journals rescue transcript/HEAD/index/worktree state before mutation.
Recovery phases are `prepared`, `git-restored`, `conversation-restored`,
`complete`. Incomplete operations block writes until reconciled; duplicate
commands return their recorded receipt. Undo follows the same protocol against
rescue state. Later changes require a fresh preview. Never run unrestricted
`git clean -fdx` or combine opaque provider file revert with host restoration.
Rewind does not rewind main or force-push a published branch.

Delivery review binds source SHA, target SHA, workspace revision and target
status fingerprint. Movement invalidates approval. Preserve unrelated dirty
target paths; staged, unstaged, untracked or renamed overlap blocks delivery.
Never auto-stash, reset, clean or commit the target's dirty files. Only the
authenticated owner UI may authorize integration merge, push or PR publication;
an agent tool or renderer boolean is insufficient. Persistent automatic merge
preferences require renewed approval. Completion is separate from delivery.
Push and PR creation retain separate receipts so publication can resume without
duplicating a successful push or PR.

## RPCs and capabilities

RPC request/response types are frozen in
[`host/workspace-rpc-contracts.ts`](../../host/workspace-rpc-contracts.ts).

| RPC methods                                                         | Capability                     |
| ------------------------------------------------------------------- | ------------------------------ |
| `workspaces.prepare/get/list/resume/finish/close`                   | `workspaces.managed.v1`        |
| `projects.workspacePolicy.get/update`                               | `workspaces.policy.v1`         |
| `workspaces.featureClaims.list/acquire/release`                     | `workspaces.managed.v1`        |
| `sessions.rewind.plan/apply`                                        | `sessions.git-rewind.v1`       |
| `sessions.rewind.undo`                                              | `sessions.git-rewind-undo.v1`  |
| `workspaces.delivery.review/merge`                                  | `workspaces.delivery.v1`       |
| `workspaces.delivery.publish`                                       | `workspaces.pr-publication.v1` |
| `workspaces.cleanup.plan/apply/status`, `workspaces.storage.status` | `workspaces.lifecycle.v1`      |

`build.identity.v1` identifies immutable frozen-source manifests, including Git
identity, dirty paths, fingerprint, capture time, component identities and
included source/delivery references. `HostDescriptor.buildIdentity` is optional;
an unstamped build has unknown source identity. Equal versions or capture times
alone do not establish inclusion.

## Interface ownership

| Stream | Contract responsibility                                                                      |
| ------ | -------------------------------------------------------------------------------------------- |
| S0     | Contract freeze and this initial reference                                                   |
| S1     | `WorkspaceRegistry`, policy resolution, feature claims; Host RPC/capability integration      |
| S2     | `TurnGitHistory`, `SessionRewindService`, native receipt/recovery bridge                     |
| S3     | `BranchDeliveryService`; task/goal/automation/steward execution adapters                     |
| S4     | `WorkspaceRemovalService`, `RetentionScheduler`, storage and execution-activity reservations |
| S5     | Session/task/settings clients and UI against versioned contracts                             |
| S6     | `WorkspaceBootstrap`, `PortLeases`, `BuildIdentity` and isolated development runs            |
| S7     | Instructions, feature cards, maintained guides and acceptance inventory                      |

Records, policy and naming contracts live in
[`host/workspace-contracts.ts`](../../host/workspace-contracts.ts); service
boundaries live in
[`host/workspace-service-contracts.ts`](../../host/workspace-service-contracts.ts).
The app consumes type-only mirrors from
[`src/features/workspaces/model/contracts.ts`](../../src/features/workspaces/model/contracts.ts).
S2 and S3 acquire S4 execution-activity reservations before destructive Git or
delivery work. One execution-host Git service remains authoritative across
native and remote callers. Independent stream checks do not establish integrated,
native, installed or released acceptance.

## Feature awareness and instruction delivery

Tracked project feature cards live under `.agents/skills/feature-<name>/SKILL.md`.
Their `name` and `description` frontmatter makes them discoverable by the existing
project skill loader in `host/skills.ts`. Use the
[card template](../../.agents/skills/feature-card-template/SKILL.md) for purpose,
code-backed surfaces, preservation, owner quotes, checks, blockers and committed
handoffs. A card is not a live lock: query/acquire feature claims against canonical
project identity and coordinate a dependency or explicit sub-scope on conflict.

Runtime guidance routes feature work to its card, requires every affected surface
including the Host operation, opened screenshot evidence for UI changes, and
build-status/source comparison before treating a screenshot as a new defect.
Missing skills/capabilities are reported; installation still requires owner
authorization. No profile-level instruction or skill edits are implied.

## Integration acceptance inventory

This is a review checklist, not a claim that other streams passed. The S7 baseline
is contract commit `f26ac112404e326478adb687c23ca9cc032acfef`. New services and UI
must be checked after the owner integrates their committed results. See the
[user guide](../guides/managed-workspaces.md) for the workflow and legacy limits.

| Area / owner                 | Required exercised behavior                                                                                                                                                                                                                              | Evidence boundary                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Registry/policy/claims / S1  | Idempotent creation, immutable committed base, explicit/project/Host precedence, full-ID collision checks, no fallback to main; duplicate writer/feature conflicts and explicit old-Host update state                                                    | Fake Git repositories and Host RPC tests; actual routed capability checks after integration                                 |
| Rewind / S2                  | Multiple agent commits plus staged/unstaged/untracked state restore exactly; Undo restores rescue state; displaced commits retained; siblings unchanged; external drift rejects; each journal phase recovers                                             | Temporary repos plus crash/restart cases; native/Host parity checked separately from transcript fixtures                    |
| Execution/delivery / S3      | Sessions, tasks, goals, automations, stewards and parallel children use assigned independent workspaces; old auto-approval suspended; SHA/fingerprint-bound owner approval; dirty non-overlap preserved and overlap rejected; push/PR receipts reconcile | Orchestrator/tool tests and authenticated UI integration; no live publication needed for fake-provider tests                |
| Lifecycle/removal / S4       | Startup/transition/hourly eligibility, timers/pins/Never, active/dirty/unknown/in-use blocking, Windows no-follow dependency detachment, blocked-handle recovery, evidence preservation, resume after removal, branch/ref retention                      | Temporary repos/link targets, with target content checked unchanged; actual Windows handle scenario distinct from mocks     |
| UI / S5                      | Creation/defaults, workspace identity, review/delivery/retirement, rewind/Undo preview, settings policy/storage/retention and update explanations; local pending/error/retry/cancel feedback and keyboard use                                            | Every affected surface at 1280/800, light/dark, opened screenshots; fixtures separate from isolated native/Host integration |
| Development/build / S6       | Own dependency links, deduplicated cancellable bootstrap, cache lease feedback, isolated Host/desktop data and executable run dirs, Vite/HMR/Host/CDP bind-race handling, consistent URLs/CSP, immutable frozen manifest and comparison                  | Concurrent isolated runs plus provenance checks; unstamped or unresponsive runtime remains unknown                          |
| Instructions/cards/docs / S7 | AGENTS at most 11,000 UTF-8 bytes; worktree-first and current-session transition; complete searchable surface cards; current crew guide; runtime missing-capability/feature guidance; valid cited paths                                                  | Focused runtime tests, byte count, reference and repository-hygiene checks; no product/native acceptance inferred           |

For final integration, exercise one complete native scenario: create independent
writers, commit and review a result, approve delivery, rewind/Undo another branch,
retire/rematerialize an eligible directory, and compare its source/build identity.
Do not run destructive acceptance on production data. Record each step's actual
branch/SHA, capability, receipt and artifact. Leave unavailable checks named with
their blocker; seven individually passing stream branches do not establish this
scenario. Mobile source is absent from the frozen baseline, and cross-platform
native visual acceptance remains separate from Windows/browser evidence.

Reports include outcome; done by surface with path:line; checks and opened
screenshots with exact unverified checks; branch/commit and readiness for review;
remaining blockers with actor; and build stamp with inclusion
included/excluded/unknown. A completion timestamp alone cannot prove inclusion.
