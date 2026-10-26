# Crews

Crews connect a coordinator conversation to independently addressable specialist and reviewer conversations. The host task scheduler runs assignments and retains their state when a desktop window closes.

## Ready-made bycoda team

The first owner-side Crew list on each host adds **bycoda Product Team** and
17 reusable member profiles to **Settings > Agents > Crews**. They are ordinary host-wide
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

## Find, edit and start a crew

Open **Settings > Agents > Crews**. **Show crews** controls whether the crew
section appears in the project rail. **Your crews** lists saved definitions with
scope and member count; choose **Edit**, **Crew work**, or **New crew**. The rail
also has **New crew**, a start action on each crew, and an options menu containing
**Open coordinator** when one active run is available, **Crew work**, **Start
work**, **Edit crew**, **Add members**, **Duplicate**, scope copying and, on a
compatible host, **Delete crew**.

The editor has **Team (count)** and **Working settings** views. Give the crew a
name and choose **This project** or **All projects** when creating it. All projects
means projects on the same host. Team groups members by coordinator, specialist,
reviewer and advisor. Add members from the searchable library or create a member;
an empty crew also offers a starter team. **Role** is an editable specialty name;
**Responsibility in the crew** determines orchestration. A valid crew has one
coordinator, one reviewer, at least one specialist and at most 20 members.

A member editor contains instructions, fixed or automatic model choice, and
advanced options. Fixed models use the normal provider/model picker and the
model's supported settings. Automatic selection uses a searchable allowed-model
list with owner cost and quality ratings. Switching a fixed model loads that
model's own defaults. Groups help find library members and require a host that
supports member groups. Inspect capabilities when needed; editing a capability
declaration does not establish verified runtime access.

**Working settings** contains the crew icon/color, automatic model priority
(**Economy**, **Balanced**, **Quality**), highest cost and lowest quality allowed,
whether unrated cost is allowed, and a bulk model choice for fixed members. The
limits are **Members working at once** (1–4), **Assignments per job** (1–20), and
**Minutes per assignment** (1–240). Permission switches control coordinator
answers to member permission requests and provider-native subagents. These are
execution policies, not provider billing caps. Appearance and rail visibility
are device-local; the host stores execution definitions.

Choose **Create crew** or **Save**, or **Save and start work** where offered.
**Discard** restores the saved definition. Unsaved drafts survive closing the
editor and navigating away within the same desktop window, separated by host,
project and crew; they do not survive reloads or app restarts. If another session
changes the definition, choose **Keep edits as new crew** or **Discard edits and
load latest**. Active runs retain their saved definition snapshot.

To launch, choose **Start work**, select the crew, and fill **What should the crew
deliver?** The first non-empty line becomes the work title. Editing the crew from
this dialog preserves the delivery draft. A successful launch opens the
coordinator in the normal conversation pane. If opening the conversation fails
after creation, **Open conversation** reuses the created run rather than starting
another one.

## Member library and copies

The Settings page's **Member library** offers **New member**, search, group
filtering and member editing. Save a crew member to the library or explicitly
update its source profile. Crews hold independent copies: a library edit reaches
a crew only through an explicit update there. Group rename/delete updates the
profiles, not the members' existence; deleting a group keeps the members. These
controls are hidden on hosts without group support.

**Duplicate** makes an editable crew copy. **Copy to all projects** and **Copy to
this project** create a separately scoped definition. Deleting a saved crew
requires confirmation and the host's delete capability; existing work snapshots,
tasks and conversations remain available.

## Crew work and conversations

Open **Crew work** from Settings or the rail. The management dialog has a crew
selector, **Ongoing**, **Finished** and **All** views, and a selectable work list.
A selected work item shows its status, progress, decisions needed, blocked
assignments, and coordinator, worker and reviewer conversations. Select a
conversation to open it. The session sidebar keeps managed conversations grouped
instead of duplicating them in the ordinary Sessions list.

**Pause** holds new assignments while active work continues; **Resume work**
allows scheduling again. **Stop work** asks for confirmation, pauses the run and
cancels active assignments. Stopped assignments remain in Tasks; resuming does
not automatically retry blocked work. **Delete work** is available only on hosts
with run-delete support and after active work is stopped. It removes the work
from the list while keeping the crew, tasks and conversations. Decisions are
answered in the coordinator conversation through **Answer**.

## Model evidence, coordination and review

Automatic selection filters required capabilities, availability, fixed choices
and policy limits before ranking cost and quality. Custom weight overrides remain
visible; selecting a priority preset resets them. Ratings are owner estimates,
not bills or universal model benchmarks. After at least three reviewed assignments
for the same member/model/settings combination in a project, first-pass review
history can inform selection when no owner quality estimate exists. Unknown
capability does not count as support. Native Codex image-tool probing is on demand;
opening Settings neither generates an asset nor starts a paid calibration.

The coordinator delegates through Conversation Tools and the host task queue.
Specialists request missing resources or expertise. Messages persist, significant
events wake idle coordinators, and durable IDs prevent replayed requests from
creating duplicate work. Owner messages sent directly to a member remain directives
the coordinator must reconcile before accepting that assignment.

Technical review runs in a separate conversation using the configured reviewer.
The coordinator accepts reviewed assignments; Tasks cannot mark direct crew tasks
done around that gate. Acceptance checks the reviewed file snapshot; changed owned
files require another independent review. Multiple component assignments require
a final integration assignment depending on all of them before the crew finishes.
Project-relative file scopes serialize overlapping assignments; disjoint scopes
can run within crew and host limits. These leases are scheduling coordination,
not a filesystem sandbox. Preserve unrelated changes.

Runtime approvals and questions remain owner-controlled unless the owner enabled
delegation in the definition. A coordinator cannot authorize itself. Delegated
responses bind to the exact member turn and pending request. Inbox, social and
publication gates retain their own contracts. Workers commit within their
authorized branch and file scope; crew acceptance never authorizes merging,
pushing or publishing.

## Tasks, tools and recovery

In Tasks, select a saved crew under **Run with**, then **Start with crew**. Each
task gets an independent coordinator/run from that definition and waits for
accepted assignments and crew completion. A required task check must pass on the
final integration assignment or sole assignment. Stopping the parent pauses and
cancels its active crew work; retry creates a fresh run. Coordinators have a
separate allowance under the host task limit so a one-worker host can delegate.
Task execution requires `crews.tasks.v1`.

All roles have normal host session tools under their existing permissions. Agents
use `tools.list` to discover actions, `crews.schema` and `crews.inspect` to inspect
contracts/models, and `crews.save` to save project definitions. `crews.start`
attaches a compatible conversation by default; `newConversation: true` launches
a separate coordinator. `tasks.create` with `crewDefinitionId` and
`status: "queued"` schedules a board task, inheriting caller permissions and using
the task ID as its idempotency key. A fixed coordinator must match an attached
conversation. Starting a new coordinator avoids that attachment constraint.

Interrupted work is retained. Unknown runtime outcomes are not completed work;
inspect the authoritative run before retrying. A missing coordinator pauses its
crew without blocking unrelated crews. A missing host shows an update/connection
error. Older hosts hide unsupported delete/group controls instead of pretending
they succeeded.

## Managed workspace transition and verification

This guide describes the crew UI and host behavior present on the frozen contract
baseline. The [managed workspace reference](../reference/managed-workspaces.md)
defines the worktree-first target: independently scheduled writers receive distinct
managed workspaces and delivery needs owner approval. The contract alone does not
prove a connected host implements it. Existing current-mode sessions retain their
checkout until explicitly migrated; do not infer new worktree isolation from a
crew definition or a file-scope lease.

The ambient **Agent crew** scene in Appearance is separate from a reusable Crew:
its Classic, Star Wars and Lord of the Rings characters do not start assignments.

Source and browser fixtures do not prove installed-host, physical-device or paid
provider acceptance. Compare build identity before treating an owner screenshot
as a new defect; then exercise the affected flow on the identified app and host.

### Local lead-run workers

New isolated workers launched by the local lead-run controller use managed,
session-owned branches. Each worker commits its assigned changes and reports its
branch and final SHA. Review retains the result until the owner opens that worker
session's **Workspace actions**, reviews the branch and approves its merge. Retry
the coordinator review after delivery. New commits after a merge require another
owner review. Checkpoint copying does not count as branch delivery.

Retained workers from older local runs keep their existing checkout and commits;
they require explicit owner migration before managed acceptance. Removing a
managed worker directory uses the shared cleanup guards and keeps its branch.
