# Managed workspaces

This reference describes the integrated managed-workspace implementation and its
versioned contracts. The source includes the registry, policy, turn history,
delivery, retention, bootstrap and desktop surfaces. A connected execution Host
must advertise an operation's capability; a contract or matching app version
alone does not establish runtime support.

## Implemented service graph and acceptance limits

`host/managed-workspace-runtime.ts` composes the production services once. Startup
reconciles provably stopped Host activities and recovers creation, rewind,
delivery and removal journals before admitting new writers. Sessions, tasks,
goals, automations and stewards use authoritative registry execution paths.
Providers, shells, terminals, editor writes and development servers participate
in shared durable activity/reservation admission. Uncertain activity remains
blocked instead of expiring by age.

The desktop includes current-checkout creation by default, opt-in worktrees,
policy/retention/storage settings, managed directory review and removal, task delivery state and artifact
previews, rewind/Undo previews, and General build details. Native session storage
preserves workspace identity through full and incremental reloads. Native turn,
activity and rewind adapters use native-kept paired Host credentials and durable
SQLite fences; missing capabilities keep these operations unavailable.
The integrated Host implements and advertises managed creation, native turn
capture, native process/buffer admission and native rewind coordination through
the trusted transports below. Isolated native acceptance is described below;
live provider and installed/released acceptance remain separate.

`host/managed-workspaces.e2e.test.ts` exercises the production graph with real
temporary Git repositories and SQLite, independently committed sessions,
rewind/Undo, owner delivery with unrelated dirty target preservation, and
junction-safe retirement retaining branches and recovery refs. Its providers are
fake. Browser fixtures exercise interface states, not installed application or
live provider behavior. On 2026-10-26, an isolated Windows native profile at
`915dd790` also exercised native SQLite, authenticated IPC/Host and real Git
across two session workspaces: rewind across two commits, Undo of commits and
staged/unstaged/untracked state, owner-approved merge, and directory retirement
preserving its branch, sibling and main dependency sentinel. Those turns were
manual synthetic writers. Live providers, simultaneous native applications in
separate worktrees, and installed/released behavior still require acceptance.

Native process leases are released by the same authenticated device only after
confirmed settlement. Complete buffer reports are scoped to device, app profile,
process instance and window; another client cannot clear them. Restart, stale,
missing or uncertain reports remain blocking until fresh reconciliation. There
is no blind timeout that declares a dead or unreachable app clean. Stale windows
or earlier process instances can therefore remain blocked until explicitly
reconciled; a fresh report from a different instance does not erase them. Mobile source
is absent from this integrated tree. Installed/released inclusion remains unknown
until compared with the actual running build identity.

## Ownership and policy

`ManagedWorkspace.id` is the authoritative workspace identity. `repositoryId`
identifies the canonical common Git directory; `cwd` remains project identity and
the workspace path is the execution directory. Owners are sessions, tasks,
automation runs or steward runs. For managed execution, one independently scheduled
writer owns a workspace; parallel child writers receive separate workspaces.

Path comparisons resolve existing ancestor aliases before comparing registry and
Git paths. Removal fixes its canonical boundary first, then checks the boundary
and every traversed descendant without following links. System aliases above
that boundary are valid, including macOS temporary-directory ancestors. Missing
descendants in interrupted-removal recovery retain that same boundary. Windows
canonical paths are exposed to Git and UI consumers without verbatim prefixes.

New sessions, tasks, goal tasks, writing automation runs and steward runs default
to the current checkout. Policy precedence is explicit owner creation choice,
then stored project policy, then execution-host default (`current`). Existing
project policies retain their explicit values, including `worktree`; existing
sessions retain their execution identity. The composer selects **Current checkout**
unless a choice or project policy resolves to **Worktree**. Current execution
does not require managed-workspace admission. In a shared checkout, agents keep
changes uncommitted unless directed otherwise and preserve other sessions' work.
Quick composer uses the same resolved policy for its display and admission, while
keeping explicit current/worktree choices through the native popup and launch.

Desktop automation definitions preserve an omitted workspace mode through native
JSON persistence so execution can inherit Host policy. Explicit `current`,
`worktree` and `existing` modes keep their values; `existing` still requires its
selected worktree path. The GitHub issue auto-fix template requires a clean,
owned managed worktree and returns `SKIPPED` before any branch or publication
step in shared/current or unknown ownership. This guard preserves shared branch,
index and dirty work; it grants no publication authority.

Contextual handoffs and second opinions remain an integration exception: their
protected Host creation path still requires an independent managed worktree,
including from current-mode sources. Applying current/project-policy resolution
there requires the contextual handoff owner's coordinated change in
`host/engine.ts` and `host/managed-workspace-runtime.ts`.

For managed worktree creation, resolve the selected committed base to an immutable
SHA; never copy an unrelated dirty checkout. A configured root applies to new
directories and does not move existing ones. Preparation failure for a resolved
or explicitly selected worktree remains an error; it never switches to current.

Branches use `bycoda/s/<slug>-<12id>` or `bycoda/t/<slug>-<12id>`; directories use
`wt-<12id>`. Generate names once. Validate collisions and ownership with the full
workspace ID, not its shortened display form. Creation failure never falls back
to main. Unsupported managed operations on older Hosts require a visible update
explanation; current-checkout creation uses the existing compatible path.

`host/managed-workspaces.ts` implements branch/directory naming and
`host/turn-git-history.ts` implements turn/rewind refs. Constants define prefixes
and the 12-character display ID length; implementations validate Git ref
components and full ownership.

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
`host/server.ts` routes owner operations through the shared runtime; delivery and
publication require authenticated owner transport, not agent credentials.

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

Additional integration transports retain the frozen owner contract:

- Managed `sessions.create` binds the persisted session ID before execution and
  advertises `sessions.managedCreation.v1`.
- `workspaces.pin` uses `workspaces.pinning.v1`.
- `workspaces.bootstrap.prepare/status/cancel` explicitly prepare dependencies;
  workspace creation never silently installs them.
- `sessions.rewind.status` exposes durable operation/Undo discovery for
  Host-executed sessions; persisted browser IDs are discovery hints only.
- Trusted `native.turn.begin/end/recover`, `native.activity.start/end`,
  `native.buffers.update` and `native.rewind.plan/prepare/apply/status/ack` use
  native execution/activity/rewind capabilities. Native transcript rescue is
  persisted before Git restore; Host completion waits for native receipt
  acknowledgement. Capability absence must never trigger opaque provider revert
  or a second independent native Git restoration algorithm.

Native turn admission recognizes at most one provider process registered by the
same authenticated device and session before its before-capture. The accepted
turn retains its own run-bound activity marker; another run, device, terminal,
independent shell, dev server or dirty/unknown editor buffer still blocks it.
The provider must retire before after-capture; accepting preflight activity does
not authorize capturing a still-running writer's end.

Desktop busy publications and desktop run leases precede native capture. Native
turn/activity calls carry the current desktop client separately from persisted
turn identity. A scoped Host probe recognizes that mirror only with a fresh,
authenticated matching device/client/session and a positive matching busy or
lease claim. Another window/device, a real Host run and unknown stored running
state remain writers. Legacy bindings retain their original identity during
recovery; the current caller context does not rewrite them.

Rejected begins cancel their exact binding durably before releasing the native
SQLite admission. `native.turn.recover` validates the complete persisted request
and owner device under the workspace Git mutation lock. Unknown legacy requests
are cancelled only with no complete before-capture and no non-read activity;
complete before-captures are never reset. A previous durable cancellation can be
acknowledged without stopping a foreign writer. Cancellation tombstones reject
delayed begin requests. Native recovery validates all echoed identity/revision
fields before releasing only the matching `starting` row. Session load and the
pre-save send path retry this proof; failed reads preserve the fence and drafts.

The trusted native transport capabilities are `sessions.native-execution.v1`,
`workspaces.native-activity.v1` and `sessions.native-rewind.v1`; all are implemented
and advertised by the integrated Host. Native rewind still requires the general
Git rewind/Undo capabilities and the matching complete native adapter.

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

This remains a release review checklist, separate from implementation inventory.
The integrated source includes I2 Host `b77b8f39` and I2 app `9f7c1e94`; I3
verification and integration fixes belong to `bycoda/wt-model/integration`.
See the
[user guide](../guides/managed-workspaces.md) for the workflow and legacy limits.

| Area / owner                 | Required exercised behavior                                                                                                                                                                                                                              | Evidence boundary                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Registry/policy/claims / S1  | Idempotent creation, immutable committed base, explicit/project/Host precedence, full-ID collision checks, no fallback to main; duplicate writer/feature conflicts and explicit old-Host update state                                                    | Fake Git repositories and Host RPC tests; actual routed capability checks after integration                                 |
| Rewind / S2                  | Multiple agent commits plus staged/unstaged/untracked state restore exactly; Undo restores rescue state; displaced commits retained; siblings unchanged; external drift rejects; each journal phase recovers                                             | Temporary repos plus crash/restart cases; native/Host parity checked separately from transcript fixtures                    |
| Execution/delivery / S3      | Sessions, tasks, goals, automations, stewards and parallel children use assigned independent workspaces; old auto-approval suspended; SHA/fingerprint-bound owner approval; dirty non-overlap preserved and overlap rejected; push/PR receipts reconcile | Orchestrator/tool tests and authenticated UI integration; no live publication needed for fake-provider tests                |
| Lifecycle/removal / S4       | Startup/transition/hourly eligibility, timers/pins/Never, active/dirty/unknown/in-use blocking, Windows no-follow dependency detachment, blocked-handle recovery, evidence preservation, resume after removal, branch/ref retention                      | Temporary repos/link targets, with target content checked unchanged; actual Windows handle scenario distinct from mocks     |
| UI / S5                      | Creation/defaults, workspace identity, review/delivery/retirement, rewind/Undo preview, settings policy/storage/retention and update explanations; local pending/error/retry/cancel feedback and keyboard use                                            | Every affected surface at 1280/800, light/dark, opened screenshots; fixtures separate from isolated native/Host integration |
| Development/build / S6       | Own dependency links, deduplicated cancellable bootstrap, cache lease feedback, isolated Host/desktop data and executable run dirs, Vite/HMR/Host/CDP bind-race handling, consistent URLs/CSP, immutable frozen manifest and comparison                  | Concurrent isolated runs plus provenance checks; unstamped or unresponsive runtime remains unknown                          |
| Instructions/cards/docs / S7 | AGENTS at most 11,000 UTF-8 bytes; current-checkout default and managed-worktree opt-in; complete searchable surface cards; current crew guide; runtime missing-capability/feature guidance; valid cited paths                                           | Focused runtime tests, byte count, reference and repository-hygiene checks; no product/native acceptance inferred           |

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
