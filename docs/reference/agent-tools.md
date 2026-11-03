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

## Saved SSH Servers

Saved inventory tools (`servers.list/get`, SSH and metadata edits) are separate
from execution. `servers.ssh.execute` requests one command on a saved SSH record
through the connected desktop. Native approval displays the exact target and
command; tool input cannot grant approval. The desktop rechecks the original
conversation authority and effective SSH configuration before starting. Existing
manual SSH terminals remain private and are not adopted by `terminals.*`.

Use a stable `requestId`, then read `servers.ssh.status` for bounded output,
truncation, state and exit code. `servers.ssh.cancel` stops only the owned local
SSH process; remote completion can remain unknown. Receipts and output are
process-local, not restart-durable. Reusing an ID with changed input is rejected;
an uncertain reply never authorizes a new ID and another execution. Trust and
noninteractive authentication must already work; this route cannot accept new
host keys, import credentials or approve proxy credential access.

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

## Optional desktop control

`desktop.status` reports readiness and the owner's allowlisted app names.
`desktop.windows.list`, `desktop.snapshot`, `desktop.find` and `desktop.screenshot`
observe only an allowed app; window-specific reads bind its actual process and
window. Search returns at most 50 matches. `desktop.wait` observes a current
same-conversation ref for at most 10 seconds. Screenshot bytes are MCP image
content, with only metadata duplicated into text.

`desktop.act` and its `desktop.click`, `desktop.setValue` and `desktop.press`
entry points share snapshot ownership, exact-operation approvals and durable
request identities. Physical shortcuts retain their separate grant. A stopped,
locked, revoked or stale target cannot be bypassed by a model argument.
`desktop.launch` accepts only an allowlisted app, without arbitrary command-line
arguments, environment, working directory, activation or debugging options.
`desktop.clipboard` supports bounded plain-text get/set/clear; every clipboard
operation requires actual focused native owner approval and current presence.
An owner's ordinary RPC identity alone cannot supply that approval.

Clipboard contents never enter durable receipts or audit. Retrying a clipboard
read returns its receipt, without cached text. Unknown effects must be inspected
before another operation. Stop invalidates queued observations/input while keeping
already-issued operation outcomes available as metadata. The helper's temporary
accessibility-ref cache belongs to one Host instance and is removed after its
Stop/close settles; a crash may leave that private temporary cache for recovery.

## Verification boundaries

Registry tests check coverage, bounded continuation, scope preservation and metadata.
Domain tests check actual execution/recovery; UI tests check mounting and targeting.
Offline eval fixtures do not prove model tool selection. Native/live acceptance,
build inclusion, installation and release must be reported independently.
