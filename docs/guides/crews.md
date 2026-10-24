# Crews

Crews connect a coordinator conversation to independently addressable specialist and reviewer conversations. The host task scheduler runs assignments and retains their state when a desktop window closes.

## Ready-made bycoda team

The first owner-side Crew list on each host adds **bycoda Product Team** and
17 reusable member profiles to **Settings > Crews**. They are ordinary host-wide
records: edit their names, instructions, models, groups and working limits, copy
them into project crews, or delete them. Initialization happens once, including
on hosts that already contain custom crews. Existing records and run snapshots
are preserved. Deleted defaults stay deleted across reads and host restarts;
later revisions refresh only instruction text that still exactly matches the
previous bycoda template. Owner-edited instructions, names, models, settings,
groups, policy and scope remain intact. Custom crew copies and active run
snapshots do not receive automatic template updates.

New specialties are added to the library on a template revision. They join the
example crew automatically only if its roster still matches the previous seed;
an owner who pruned or customized the roster keeps that membership. Previously
deleted profiles and the deleted example crew stay deleted. Updates are persisted
atomically with their template revision so a restart does not replay them.

The seed uses the first model in the connected host catalog and that model's
default settings for every profile. Review these choices before starting work.
No model IDs, capabilities, cost estimates or quality ratings are invented.
An empty or unavailable catalog postpones initialization until a later owner
read with an available model. Merely opening Crews never starts an agent,
generates an asset, probes a paid tool or changes provider permissions.

| Profile                      | Crew responsibility  | Main handoff                                                     |
| ---------------------------- | -------------------- | ---------------------------------------------------------------- |
| Team Lead                    | Coordinator          | Scoped assignments, dependencies and integration acceptance      |
| Project Manager              | Advisor              | Milestones, blockers, delivery risks and status evidence         |
| Product Manager              | Advisor              | User outcome, bounded scope and acceptance scenarios             |
| UX Researcher                | Specialist           | User needs, observed friction and validation questions           |
| UX Designer                  | Specialist           | Task flows, interaction states and recovery behavior             |
| Designer                     | Specialist           | Visual direction, tokens, assets and visual criteria             |
| UI Engineer                  | Specialist           | Accessible, responsive interface implementation                  |
| Mobile Engineer              | Specialist           | Platform behavior, lifecycle and device evidence                 |
| Backend Engineer             | Specialist           | API/data contracts, validation and concurrency safety            |
| Database Administrator (DBA) | Specialist           | Database integrity, migration/query safety and tested recovery   |
| Data Engineer                | Specialist           | Ingestion, event/CDC contracts, replay, lineage and data quality |
| Architect                    | Advisor              | Boundaries, invariants, alternatives and integration risks       |
| DevOps Engineer              | Specialist           | Reproducible pipelines, reliability and rollback readiness       |
| Tester                       | Specialist           | Risk-based tests, reproducible defects and regression evidence   |
| Security Engineer            | Specialist           | Trust boundaries, mitigations and residual risks                 |
| Accessibility Specialist     | Specialist           | Keyboard, assistive-technology and accessibility findings        |
| Reviewer                     | Independent reviewer | Evidence-based pass/fail against the requested behavior          |

These titles describe specialties; the four Crew responsibilities still control
orchestration. The example is an expertise pool. The coordinator activates only
the members needed for a request, rather than launching everyone. It delegates
implementation and technical review, reconciles owner directives, and requires
the existing final integration assignment after multiple component assignments.
Tester can produce tests and defect reports; Reviewer checks independently in a
separate session and keeps review read-only. Advisors supply bounded decisions
through normal assignments without creating another management hierarchy.

The shared working agreement requires explicit acceptance criteria, assigned write
scopes, preserved unrelated changes, concise handoffs and honest evidence limits.
The default policy allows two parallel assignments, 20 assignments and 30 minutes,
with native subagents and delegated runtime approvals disabled. These are editable
execution limits, not a provider billing cap. Crew membership grants no additional
tool, publishing, production, communication or release authority.

## Keeping technical knowledge current

Every profile now has separate **Responsibilities**, **Current working method**,
**Technology and evidence**, **Working agreement**, **Handoff** and **Official
references** sections. These are editable instructions included in assigned work,
not a newly installed framework or a guarantee that a model has browsed the web.

The shared technology protocol requires the member to:

1. Inspect the actual manifests, lockfiles, runtime/build targets and existing
   abstractions before recommending an API, package or architecture.
2. Check current official documentation, release notes, advisories and migration
   guidance when behavior is unfamiliar, changing or deprecated. Match guidance
   to the installed version; a `/latest` documentation link is a discovery entry
   point and does not establish compatibility.
3. For an actual unmet requirement, compare the native/platform option, the
   existing project solution and a maintained alternative. Explain compatibility,
   security, licensing, accessibility, resource cost and migration tradeoffs.
4. Prefer a small compatible adoption with measurable benefit. Do not add a new
   stack or upgrade unrelated packages just because something newer exists.
5. For consequential choices, hand off the exact version/range, official links,
   verification date, alternatives and validation evidence. If current sources
   cannot be checked, state that limitation instead of claiming current knowledge.

Role-specific methods put these principles into practice: UI covers React Effect
discipline, the configured Compiler and deliberate TanStack Query cache/mutation
behavior; Mobile checks Expo/React Native/native-module compatibility; Backend
owns versioned contracts and replay/retry semantics; DevOps correlates telemetry;
Tester uses isolated behavior and contract checks; Security uses versioned
verification criteria. Leadership keeps delivery in small verifiable batches.
These are conditional guidance for the project's actual stack, not mandates to
adopt React, Expo, OpenAPI, OpenTelemetry or Kafka in unrelated projects.

DBA owns storage correctness and operational recovery. It must inspect the actual
embedded engine/driver versions, review locks and migration-tool restrictions,
measure query plans safely, bound backfills and establish backup/restore evidence.
`EXPLAIN ANALYZE` executes statements. A backup job succeeding is not a restore
test, and copying a live SQLite database file alone is not a consistent backup
strategy. Engine-specific rules must come from that engine's current documentation.
Data Engineer owns pipeline schemas, lineage, freshness, quality, ordering and
replay. Application/API contracts remain with Backend; production data operations
retain their existing owner-authorization requirements.

Current technical source entry points are included directly in the relevant
profiles so future assignments can refresh their evidence:

- [React Effects](https://react.dev/learn/you-might-not-need-an-effect),
  [React Compiler](https://react.dev/learn/react-compiler/introduction) and
  [TanStack Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).
- [Expo CLI compatibility checks](https://docs.expo.dev/more/expo-cli/),
  [Expo Router](https://docs.expo.dev/router/introduction/) and
  [React Native performance](https://reactnative.dev/docs/performance).
- [OpenAPI](https://spec.openapis.org/oas/latest.html),
  [OpenTelemetry signals](https://opentelemetry.io/docs/concepts/signals/),
  [DORA small batches](https://dora.dev/capabilities/working-in-small-batches/) and
  [OWASP ASVS](https://asvs.owasp.org/).
- [PostgreSQL index operations](https://www.postgresql.org/docs/current/sql-createindex.html),
  [recovery](https://www.postgresql.org/docs/current/continuous-archiving.html),
  [EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html),
  [SQLite backups](https://www.sqlite.org/backup.html) and
  [WAL behavior/advisories](https://www.sqlite.org/wal.html).
- [Kafka processing semantics](https://kafka.apache.org/43/design/design/#semantics)
  and [PostgreSQL logical replication](https://www.postgresql.org/docs/current/logical-replication.html)
  for projects that actually use these data technologies.

The role boundaries and working agreement are bycoda's synthesis of primary
guidance, adapted to this application's scheduler and owner-approval contracts:

- [GOV.UK service-team roles](https://www.gov.uk/service-manual/the-team/service-manager.html)
  informs multidisciplinary handoffs and the separation of product, delivery,
  research, design and development responsibilities.
- [The Scrum Guide](https://scrumguides.org/scrum-guide.html) informs shared
  outcomes, cross-functional delivery and explicit completion criteria. The
  example does not require a Scrum process or map its job titles to Scrum roles.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) informs accessibility acceptance.
- [Android architecture recommendations](https://developer.android.com/topic/architecture/recommendations)
  inform mobile state ownership and UI/data boundaries, adapted to each project's stack.
- [NIST SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final) informs security
  requirements, secure defaults, review and vulnerability handling.
- [Google SRE: Implementing SLOs](https://sre.google/workbook/implementing-slos/)
  informs measurable reliability and operational tradeoffs.
- [Architecture Decision Records](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html)
  informs concise recording of consequential architecture decisions.
- [Playwright testing practices](https://playwright.dev/docs/best-practices)
  informs isolated, user-observable verification.

## Navigation

Use **Settings > Crews** to create a team and save reusable agents to its library. Definitions can belong to the current project or all projects on the selected host. Copying a definition to another scope creates a new definition. Each run keeps a snapshot; editing a definition does not change active work.

Choose a crew from **Your crews**. **Team members** shows each member's purpose and model; select a row to open that member's detail view. **Role and instructions** and **Models and capabilities** separate the member's responsibilities from its runtime choices. **Back to team** returns to the roster without discarding edits. Fixed selection uses one chosen model; automatic selection uses an allowed model pool. **Models and capabilities** contains capability inspection, cost/quality estimates, provider settings and the reusable agent library action. **Use starter roster** adds a coordinator, developer and reviewer using the first available catalog model. Use the member library to add the ready-made specialty profiles; review model choices before starting work.

**Team**, **Working style** and **Crew settings** are separate views. **Working style** contains the automatic selection preference, concurrency, budget limits and permissions. **Crew settings** contains the name and scope. Save explicitly with **Save crew**. Drafts survive switching crews and leaving Settings in the same desktop window, separately for each host and project. They are not saved across window reloads or app restarts. If another session changes a definition, keep local edits as a new crew or explicitly discard them and load the latest version before saving. Active runs keep their original settings.

Use the **+** action under **Crews** in Sessions to select a definition and describe a deliverable. The coordinator opens in the normal conversation pane. Assignments, their selected model, request counts and independent review conversations remain visible under the crew without expanding a group. Select the request action to open the coordinator. Each conversation can be opened separately. Managed conversations appear in this group instead of being duplicated in the ordinary Sessions list.

Pause holds new assignments while active work continues. Stop pauses the crew and cancels its active work. Stopped assignments remain available in Tasks; resume does not automatically retry blocked work.

## Roles and model selection

A crew has one coordinator, one reviewer and at least one specialist. Advisors are optional. Each role has instructions and either a fixed model or an allowed list for automatic selection. Model settings, including supported effort controls, come from the connected host catalog.

Automatic selection checks required capabilities, model availability, fixed choices and policy limits before applying cost and quality preferences. Economy, balanced and quality presets can be adjusted with explicit weights. The UI identifies custom weights; selecting a preset resets both overrides. Selection reasons are retained on assignments.

Cost and quality inputs are owner estimates, not billing records or universal model benchmarks. After at least three reviewed assignments for the same member/model/settings combination in a project, first-pass review history can inform selection when no owner quality estimate is supplied. Samples and acceptance counts remain inspectable. This history is task-specific evidence, not a guarantee of future quality.

The estimated assignment budget reserves both implementation and its initial review. It is not a provider billing cap. Additional owner-requested retries, coordinator turns, native subagents and opaque subscription usage are not priced by this estimate. Assignment-count, time and host execution limits remain separate.

## Capabilities

Inspect saved capabilities to view model availability, image-tool access and review observations. Unknown capability is not treated as support. User-entered declarations cannot create verified tool access.

Native Codex image generation is probed on demand through the installed runtime and account. This checks feature/auth availability; it neither enables ImageGen nor proves that a future image request will succeed. Other capability probes may return unknown. Generated results still need inspection by the specialist/reviewer. No paid calibration or image generation runs merely because Settings is opened.

## Coordination and review

The coordinator delegates through Conversation Tools and the host task queue. Specialists use crew requests for missing resources or expertise. Messages are persisted and significant events wake an idle coordinator. Replayed requests and event deliveries reuse durable IDs.

Direct messages sent to a member through the host are recorded for the coordinator to reconcile. Existing queue/steer behavior governs the member's running turn. The coordinator cannot accept that assignment until its owner directives are resolved.

Technical review runs in a separate session using the configured reviewer model. Direct crew tasks wait for coordinator acceptance after review; the Tasks board cannot mark them done directly. Acceptance checks the reviewed file snapshot; changed owned files require another independent review. Multiple component assignments require a final integration assignment that depends on the other work before the crew can finish.

Assignments declare project-relative file scopes. Overlapping scopes serialize through the task scheduler; disjoint scopes can run within host and crew concurrency limits. These leases coordinate tasks; they do not introduce a new filesystem sandbox for provider tools. Root-scoped integration work runs exclusively against other direct tasks. Existing project instructions and unrelated dirty work must be preserved.

Runtime approvals and questions remain owner-controlled unless the owner explicitly grants delegation in the crew definition. A coordinator cannot grant this permission to itself. Delegated replies bind to the exact member turn and pending request. Inbox, social, publication and other native owner gates retain their own contracts. Crew acceptance does not authorize staging, commits, merges, pushes or publication.

## Tools and recovery

All crew roles use normal host sessions and their available application tools. Coordinators, workers and reviewers discover actions through `tools.list`; tasks, notes, automations, devices, terminals, servers, logs, skills and app UI remain available according to their existing contracts. Social policy and native owner approvals still apply. A crew cannot enable a missing integration or grant itself permissions.

In Tasks, choose a saved crew under **Run with**, then **Start with crew**. Each task starts its own coordinator and independent run from the saved definition. The parent task waits for accepted assignments and crew completion; an idle coordinator does not mark it done. A required task check must pass on the final integration assignment (or the sole assignment). Stopping the parent pauses that run and cancels its active work; retry creates a fresh run. Coordinators have a separate concurrency allowance using the host task limit, so a one-worker host can still execute delegated work.

Use **Duplicate crew** to make an editable copy. Host-wide definitions can be selected in other projects on the same host; project definitions stay scoped. Multiple tasks can use the same definition independently, subject to host limits and file-scope scheduling. Task execution requires the host capability `crews.tasks.v1`.

Conversation Tools `tasks.create` accepts `crewDefinitionId` and `status: "queued"` to schedule a team; it inherits the caller's runtime permissions. Its task ID is an idempotency key. `crews.start` with `newConversation: true` starts a separate coordinator instead of attaching the caller. The requester can inspect and send crew requests, while acceptance stays with the new coordinator.

Agents can discover definition contracts with `crews.schema`, inspect the connected catalog with `crews.inspect`, save project definitions and attach a compatible existing host conversation with `crews.start`. A fixed coordinator choice must match the existing conversation. New coordinator conversations can be started from Sessions.

Crew assignments use existing task dependencies, checks, retry and review recovery. Coordinator launch and event delivery use host receipt IDs. Interrupted work is retained; unresolved or uncertain runtime operations are not described as completed work. A missing coordinator session pauses its crew rather than blocking other crews.

The installed desktop and host must both advertise the Crews capability. Source and fixture tests do not establish installed-host, physical-device or live paid-provider acceptance.
