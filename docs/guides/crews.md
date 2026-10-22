# Crews

Crews connect a coordinator conversation to independently addressable specialist and reviewer conversations. The host task scheduler runs assignments and retains their state when a desktop window closes.

## Navigation

Use **Settings > Crews** to create a team and save reusable agents to its library. Definitions can belong to the current project or all projects on the selected host. Copying a definition to another scope creates a new definition. Each run keeps a snapshot; editing a definition does not change active work.

Choose a crew from **Your crews**. **Team members** shows each member's purpose and model; select a row to open that member's detail view. **Role and instructions** and **Models and capabilities** separate the member's responsibilities from its runtime choices. **Back to team** returns to the roster without discarding edits. Fixed selection uses one chosen model; automatic selection uses an allowed model pool. **Models and capabilities** contains capability inspection, cost/quality estimates, provider settings and the reusable agent library action. New crews start with coordinator, backend, UI and reviewer roles using the first available catalog model; review these choices before starting work.

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
