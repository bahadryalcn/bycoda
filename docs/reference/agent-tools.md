# Agent tool management

Bycoda keeps tool discovery and workflow metadata separate from domain execution.
Conversation, Social and Runtime Logs retain their own authenticated dispatchers,
permissions and target identity. Metadata never grants authority.

## Discovery

`tools.search` returns bounded summaries filtered by query, group or family.
`tools.describe` returns complete schemas and management metadata for up to four
namespaced IDs or exact tool names. Its JSON document may span chunks: concatenate
`content` in cursor order until `nextCursor` is null before parsing. Cursors are
bound to the request and catalog revision. `tools.status` reports declared support
and explicit capability evidence. A missing domain probe remains `unknown`.

Legacy `tools.list` and direct tool names remain supported. Search/description
does not dynamically register native tools with a provider. Current session
discovery can describe all three built-in groups; this is not proof that all
groups are offered or connected. External MCP discovery includes only the
credential's existing allowlisted operations and read/write scopes.

`host/tool-management.ts` owns the pure metadata/projection logic. Catalog inputs
remain in the owning schema modules. The management contract distinguishes
legacy authorization scope, effects, identity-bound retry, preconditions,
readback, cancellation, presentation and capability evidence. Unknown extensions
are explicitly unsupported until reviewed. Full domain validators remain in force.

## Workflows and providers

`toolWorkflowGuidance.ts` covers every Conversation Tools family and separate
Social/Runtime Logs rules. `runtimeGuidance.ts` delivers the versioned content
through the existing desktop/headless pipeline and provider/account fingerprints.
Native slash commands and Codex Plan instructions retain their existing behavior.
Bridge presence means offered transport metadata, not a ready browser/device or
authorized external action. Workflow guidance is context, never new permission.

Read-before-write, native owner approvals, disabled skills and provider restrictions
remain authoritative. Browser fallback rules do not apply to uncertain sends,
publication, deletion or credential operations. Reconcile the original receipt
before considering a repeated mutation. Schedule saved, task completed, review
accepted, external delivery and UI visibility are distinct observations.

## Browser preview

`browser.preview` accepts a stable `requestId`, URL, optional viewport and `show`
(default true). It composes the existing scoped browser controller with the
originating conversation's project-Host Browser panel. It never takes another
owner's lease or silently switches machines. Repeating an identical request ID
reads its receipt; different input with that ID is rejected.

The response separates `execution`, `presentation` and `evidence`. A verified page
can have an unavailable panel in a headless/inactive desktop. A navigation timeout
does not prove navigation failed. MCP returns frame bytes as image content rather
than duplicating them into metadata text. Request receipts are in-memory and do
not claim restart durability; inspect browser/panel state after a Host restart.

`browser.resize` changes the leased CSS viewport (240–2560 by 240–2160), invalidates
old annotations and requires a new frame. It is not physical-device emulation.
Runtime coordinates are checked against the actual viewport. Native-size mode
keeps a narrow viewport at its real width rather than stretching it to the panel.

`ui.tools.open` accepts `projectHost:true` to explicitly select the project Host.
It cannot be combined with `machineId`. Omitting it preserves the existing target.
Completion still requires the matching panel/tab/machine to be mounted.

## Social and adapter parity

`socialToolCatalog` supplies the same schemas and scope classifications to
HTTP, stdio and voice. Mutation tools accept an optional stable `requestId`.
Adapters remove that transport field from the domain payload and pass it to
existing signature-bound receipts. Missing IDs retain legacy UUID behavior.
An ID does not grant send authority. Unknown external delivery must be reconciled;
it is never an instruction to resend with a fresh ID.

## Verification boundaries

Registry tests check coverage, bounded continuation, scope preservation and metadata.
Domain tests check actual execution/recovery; UI tests check mounting and targeting.
Offline eval fixtures do not prove model tool selection. Native/live acceptance,
build inclusion, installation and release must be reported independently.
