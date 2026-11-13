# Crews

Crews connect a coordinator conversation to independently addressable specialist and reviewer conversations. The host task scheduler runs assignments and retains their state when a desktop window closes.

## Ready-made bycoda team

The first owner-side Crew list on each host adds **bycoda Product Team** and
17 reusable member profiles to the **Crews** page. They are ordinary host-wide
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

Team rows show each member's name, role, model and groups. Select a member to
read or edit their full instructions.

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

Open **Crews** from the compact rail, the command palette (**Open Crews**) or
Ctrl/Cmd+Shift+E. The page has **Teams**, **Members** and **Work** tabs and a
**New crew** button.

**Teams** lists saved crews as cards or rows (switch with **Cards** / **List**,
filter by name). A card shows the crew seated around a table; the props on the
table show whether the crew is idle, working, needs a decision or is blocked. A
list row shows the members' faces overlapping, as the project rail does. Each crew
has **New work**, **Edit** and an options menu containing **Open coordinator** when
one active run is available, **Crew work**, **New work**, **Edit crew**, **Add
members**, **Duplicate**, scope copying and, on a compatible host, **Delete crew**.

**Members** is the member library. Each member shows the teams it is in. Use **Add
to team** or **Remove from team** on a member, or select members and use **Add to
team…** to add them all to one team. When a change would make a crew invalid, the
option is disabled and shows the reason; in a bulk add, each skipped member is
listed with its reason.

**Work** shows the same work management as the **Crew work** dialog, inline on the
page. The project rail lists the same crews with overlapping member faces and the
same options menu. The **Crews** heading opens the page; its separate chevron
collapses or expands the list. **Settings > Agents > Crews** keeps **Show crews** for the rail
and an **Open Crews** button.

The editor is one page. Give the crew a name, and choose **This project** or
**All projects** when creating it; All projects means projects on the same host.

**Access for every member** sets the permission mode every member of this crew's
work runs with (default **Supervised**), next to **Coordinator answers permission
requests** and **Allow provider sub-agents**. It is the only place access is set;
hosts without crew access support hide the picker and run work supervised.

**Members** groups the roster by coordinator, specialists, reviewer and advisors.
Each row has a selection box, the name, a responsibility selector, the model
picker (model and its options such as reasoning effort) and a remove button, so
models can be changed directly in the list. The bulk bar above the list applies
one model with its options to the selected members, or to every member when none
is selected; those members become fixed-model members. It starts on the model
most members already use. Expand a row to edit its name, instructions, groups,
automatic candidates (**More options**), capabilities and library link. Add
members from the searchable library or create a member; an empty crew also offers
a starter team. Unfinished additions are kept when you go back and return, until
you add them or choose **Discard draft**. A valid crew has one coordinator, one
reviewer, at least one specialist and at most 20 members.

Every member has a pixel avatar drawn from its library profile, so copies of the
same profile look alike. Avatars follow the ambient scene theme: Classic draws the
member as an uncle (amca) character, Star Wars as a protocol droid, Lord of the
Rings as an Ent and Matrix as an agent. The saved look does not change; only its
drawing does. On hosts that support crew identity, the expanded member
also has a **Handle** field and an **Appearance** picker. The handle is optional
and written as `@name`: lowercase letters, digits and hyphens, up to 24 characters,
unique among library members you can see together and unique within the crew.
**Appearance** sets headwear, face, glasses, outfit, colors and accessory, with a
live preview; **Shuffle** picks a random complete look and **Reset** returns to the
look drawn from the profile.

Members choose **Default**, **Pool** or **Fixed**. Default follows the Crew member
role in **Settings > Models**; Pool follows a named subset of the shared order;
Fixed uses the selected model. **Manage in Models** opens the shared model order,
limits and pools. The former Crew Models tab and cost/quality ranking are removed.
Running work keeps its concrete model
and team snapshot. See [Models](models.md) for eligibility and waiting behavior.

Groups help find library members. Inspecting capabilities does not establish
verified runtime access. **Advanced** holds execution limits, appearance and
copy/delete. The crew's supported icon and color follow it across devices;
**Show crews** for the rail remains a setting of this device.

A saved crew saves itself shortly after each valid change; the footer shows
**Saving…** or **All changes saved**, or the error with **Retry**. An invalid crew
is not saved until the issue shown is fixed. A new crew is saved once with
**Create crew** and saves itself afterwards. Unsaved drafts survive closing the
editor within the same desktop window. If another session changes the
definition, choose **Keep edits as new crew** or **Discard edits and load
latest**. Work already started keeps its own team snapshot and access mode.

To launch, choose **New work**, check the **Project** (the open project by
default), select the crew, check **Access for every member**, fill **What should
the crew deliver?** and choose **Start**. **Project** lists the projects registered
on that machine; **New project…** opens a compact dialog with the machine, project
name and destination folder. Creating it makes a folder next to the current project,
registers it as a project and adds it to the project list, so the work runs
there. Changing access saves it to the crew before the work starts. The first non-empty line becomes the work
title. Editing the crew from
this dialog preserves the delivery draft. A successful launch opens the
coordinator in the normal conversation pane. If opening the conversation fails
after creation, **Open conversation** reuses the created run rather than starting
another one.

## Member library and copies

The **Members** tab of the Crews page offers **New member**, search, group
filtering and member editing. Search matches the name, responsibility, model
summary, candidate models, groups and instructions. When picking members to add,
the picked members stay listed above the results, including those the current
search or group hides, with **Clear selection** and **Clear filters**. Save a crew
member to the library to reuse it.

A member added from the library stays linked to that profile and shows a
**Library** badge. Editing the profile updates every crew that uses it, unless the
member was customized in that crew. Changing a member inside a crew marks it
**Customized** when the result differs from the profile, and a customized member
then keeps its own copy. In the member's details, **Use library version** copies
the profile back into the crew and **Edit library profile** opens the profile
itself. When the profile has changed since the member was added, **Update from
library** copies it into that crew. Deleting a library profile keeps the copies in crews, which are no
longer linked. Work that is already running keeps its team snapshot. On hosts
without linked members, crews hold independent copies and a library edit reaches a
crew only through an explicit update there.

A member's **Tools** is one choice of profile. **Full access** is the default and needs no
setup: the member uses every tool the run allows. **Developer**, **Designer** and **Tester** are
ready-made profiles; each can still write code and only chooses which Host tool groups the member
sees (Developer: files, Git, terminals, dev servers, browser, tasks and pull requests; Designer:
image generation, visual previews, browser and dev servers; Tester: dev servers, browser,
simulators and desktop apps). **Custom** opens three lists picked, not typed: Host tools from the
Host's own catalog (a whole group such as `files`, or single tools marked as reading or writing),
and the MCP servers and skills installed on this computer. Empty lists mean no limit. Where a list
is not available (an older Host, or a project on another machine) the field takes typed names.
A member saved as read-only by an earlier version shows as Custom until another profile is chosen.
A profile only narrows what that member's sessions can use; it never goes beyond the run's access
mode or the owner approvals, and work already running keeps the profile it started with. The Host
blocks Host tools outside the profile with a clear error. Every profile keeps the provider's own
file-edit and shell tools as the run's access mode allows; an older read-only member loses them
(Claude) or runs in a read-only sandbox (Codex). The MCP server list keeps only those servers for
Claude, Codex and OpenCode (other providers refuse the member), and the skill list disables every
other skill (Claude blocks them at launch; other providers are told not to use them). The control
needs a host that supports tool profiles.

Group rename/delete updates the
profiles, not the members' existence; deleting a group keeps the members. These
controls are hidden on hosts without group support. Select library profiles (or
none, for all shown) and use the bulk bar to give them one model and its options;
each profile is saved and failures are listed by profile.

**Duplicate** makes an editable crew copy. **Copy to all projects** and **Copy to
this project** create a separately scoped definition. Deleting a saved crew
requires confirmation and the host's delete capability; existing work snapshots,
tasks and conversations remain available.

## Crew work and conversations

Open **Crew work** from Settings or the rail. The management dialog has a crew
selector, **Ongoing** and **Finished** views, a search over the loaded work and a
selectable work list with update times. The search and selection survive refreshes;
switching crews clears the search. Each item shows a live or paused state only when it says something, and,
separately, whether it needs you (**Needs decision**, **Needs review** or
**Blocked**); a paused run can still need a decision and stays answerable. A
selected work item has one row of controls next to its title: **Pause** and
**Stop**, or **Resume** and **Stop** while paused (the Resume button is the
paused signal). Below it are progress, decisions needed, blocked assignments,
the conversations with member names and models from that run (view only), the
team, one message box and the latest timeline events (**Show all** for the
rest). The team is a strip of member faces fixed when the work started; hover a
face for its role, model and spend, or select it to address that member. The
message box sends a note to the lead by default; for a specialist or advisor it
also offers **Assign**, which uses the first line of the message as the task
title. Select a conversation to open it. The session sidebar keeps managed conversations grouped
instead of duplicating them in the ordinary Sessions list.

**Pause** holds new assignments while active work continues; **Resume**
allows scheduling again. **Stop work** asks for confirmation, pauses the run and
cancels active assignments; it is not offered again for that work while the
coordinator's cancellation settles (**Stopping…**). Stopped assignments remain in Tasks; resuming does
not automatically retry blocked work. **Delete work** is available only on hosts
with run-delete support and after active work is stopped. It removes the work
from the list while keeping the crew, tasks and conversations. Decisions are
answered in the coordinator conversation through **Answer**.

When more than one connected machine runs crews, a **Machine** selector chooses
whose crews and work the dialog shows and where **New work** runs. Next to it,
**Project** chooses which project's work is listed, including **New project…**. It opens on
the project's own machine, which is **This computer** for a local project; other
machines follow. On another machine the dialog uses the project with the same
folder name, else that machine's first project. A failed action names the action
and the machine. A failure to reach the machine clears itself once the machine
answers again.

The work list appears only when a crew has more than one piece of work; a single
piece of work opens its detail directly, and a crew without work shows one
**New work** entry. In a narrow window the dialog shows either the list or one
piece of work, with **Back to work list**. A selected piece of work leads with its
status, decisions, blockers and the next action; requests, the team and **Delete
work** follow below. While an action runs its name stays beside the controls
(for example **Pausing…**).

**Advanced** groups model rules, execution limits, appearance and copy/delete.
Opening it shows the model rules (cost, quality, unrated models, automatic
ranking) beside the limits, with any blocked or narrowed warning above them. Settings belong to the crew and apply to work you start afterwards; appearance is
saved the same way as in the editor.

## Model evidence, coordination and review

Automatic selection filters required capabilities, availability, fixed choices
and policy limits before ranking cost and quality. Custom weight overrides remain
visible; selecting a priority preset resets them. Ratings are owner estimates,
not bills or universal model benchmarks. After at least three reviewed assignments
for the same member/model/settings combination in a project, first-pass review
history can inform selection when no owner quality estimate exists. Unknown
capability does not count as support. Every member can call `images.generate`, so
`image-generation` reflects the Host's image providers; Antigravity members also
qualify through their built-in Nano Banana tool. Probing is on demand; opening Settings neither generates an asset nor starts
a paid calibration.

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

An attached coordinator may be a Host conversation or a native desktop
conversation on the same machine. The host verifies its project, model and
permission mode from that conversation's metadata. Crew events wait while the
desktop owns a running turn. Delivery to an idle coordinator uses the normal
command ownership and writer-retirement checks; Stop uses the current turn's
owner. A session on another machine is never used as a fallback. Pending events
keep their original command identity when delivery must be reconciled.

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
its Classic, Star Wars, Lord of the Rings and Matrix characters do not start
assignments.

Source and browser fixtures do not prove installed-host, physical-device or paid
provider acceptance. Compare build identity before treating an owner screenshot
as a new defect; then exercise the affected flow on the identified app and host.

### Local lead-run workers

New isolated workers launched by the local lead-run controller use managed,
session-owned branches based on the selected lead checkout's committed SHA. The
lead branch and directory are saved as the delivery target, including when the
lead works outside the project integration branch. Uncommitted lead files are
excluded. Missing, detached or changed lead targets block preparation or review;
the controller does not substitute the integration checkout.

Each worker commits its assigned changes and reports its
branch and final SHA. Review retains the result until the owner opens that worker
session's **Workspace actions**, reviews the branch and approves its merge. Retry
the coordinator review after delivery into the saved lead target. A merge into a
different branch does not permit acceptance. New commits after a merge require
another owner review. Checkpoint copying does not count as branch delivery.

Retained workers from older local runs keep their existing checkout and commits;
they require explicit owner migration before managed acceptance. Removing a
managed worker directory uses the shared cleanup guards and keeps its branch.
