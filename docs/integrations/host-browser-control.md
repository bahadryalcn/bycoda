# Host browser and responsive control

Browser control uses the existing authenticated bycoda host.
It adds no alternate session engine, permissive CORS, cloud account, or persistent
browser credential storage. Web/mobile means a responsive browser interface, not
a native mobile package.

## Web control

Open the host's configured `/control` URL. Enter a previously paired device's
43-character credential from the existing host pairing workflow. The page keeps
it in memory only and clears it when disconnected. Never place credentials in
URLs, logs, bookmarks, or a reverse proxy configuration. Device revocation remains
the same host authority as desktop RPC.

The canonical origin must be explicitly configured by the host. Remote origins
require HTTPS; local `http://127.0.0.1:PORT` is supported. For LAN/Tailscale access,
configure a trusted HTTPS reverse proxy preserving the canonical Host header and
set `BYCODA_WEB_CONTROL_ORIGIN` to its HTTPS origin. Do not expose a cleartext bearer
credential over a LAN. The server never trusts forwarded headers to infer origin.

Only POST `/control/rpc` with matching Origin, Host and JSON content type enters
the existing RPC switch. `/rpc` retains its native-only Origin restriction.
The page provides project/session lists, supervised new session creation, model
selection, prompt sending, stop, approval and question responses, bounded earlier
history, shared browser controls and diagnostics. It does not execute transcript
HTML. Rendered text uses textContent. CSP disallows framing and external scripts.

Session reads use bounded previews and partial deltas, pause while the document
is hidden, and never run overlapping polls. Earlier history opens a bounded page
rather than retaining an unbounded transcript. Provider state is not migrated.
Mutations are never automatically retried: if the response is uncertain, the page
retains the command ID and offers a receipt lookup before resending.

## Shared browser setup and ownership

The **Tool machine** selector in Devices, Host browser and Resource usage offers
**Project host**, **This computer**, and saved remote hosts. Project host follows
the conversation's project; an explicit selection runs those tools on that
computer even when the conversation belongs elsewhere. Host-local URLs refer to
the selected computer. Switching clears preview, live viewing and control state;
a disconnected target reports an error rather than falling back to another host.

Development servers and browser element attachments
retain their owning project. Element selection is available only when the
selected browser is on that conversation's project host. Cross-machine browser,
device and resource requests do not register the conversation directory or send
its project/session IDs to the selected host. Paired-host authentication still
applies; newer setup/device machine selection requires the
`host.tools.machine-targets` capability.

Playwright is optional. In **Host browser → Setup and access**, choose **Set up
host browser** to install pinned `playwright@1.64.0` and Chromium on the project's
own host. Setup uses the host's Node runtime and an existing npm CLI, with hidden,
bounded child processes. Status and opening never download dependencies implicitly.
An interrupted setup can be retried; partial directories are retained.

The installation lives in `~/.bycoda-host/tools/playwright-1.64.0`, outside the
immutable application/runtime packages, and survives host upgrades. Status checks
both the completed package and Chromium binary. The `browser.shared.setup`
capability identifies hosts offering this setup action; older hosts need the normal
local update first. Do not manually modify a frozen host package.

From Windows, select the MacBook's remote project and open its conversation tools.
The remote project determines the host for setup, navigation and frames; localhost
addresses refer to that Mac. Claim control, enter the Mac project's URL, and open
it. **Live view** requests one frame per second while the panel is visible and
idle, and pauses during element selection. Device tools in the same conversation
can list and boot an iOS simulator, capture it, and provide opt-in live viewing and
control through the Mac host. They require full Xcode and an installed simulator
runtime; see [device setup](devices.md).

The host starts one headless ephemeral Chromium context at 1280×720. It does not
load the user's browser profile and disables downloads. Any authenticated device
may request a JPEG frame; a 30-second lease controls navigation, click, text,
supported keys, scroll and closing. It has one in-flight operation and a 2 MiB
frame budget. Control can be released or reclaimed after expiry. Idle Chromium
closes after five minutes; host shutdown also closes it. It is a shared browser,
so pages opened in it are visible to other authorized devices. This is not a video
stream or an automatic agent browser automation protocol.

## Select an element for a conversation

The terminal area's Host browser tool offers **Select element and add to composer**
after control is claimed and a current frame is loaded. Hover outlines the DOM
element under the preview coordinates; clicking captures it without issuing a
mouse click, pointer event, focus change, or keyboard event to the page. Arrow
keys move the inspection point in the preview and Enter selects it. Escape or
Cancel selection cancels; Remove selection keeps inspection mode open.

The user can review the masked screenshot, redacted page URL, viewport and scroll
position, structural CSS selector, DOM ancestry, visible text, bounds, and relevant
computed styles, then add a comment. **Add selection to composer** adds an ordinary
image attachment with inspectable metadata to that exact conversation draft. It
does not send a message or start an agent. The user reviews/removes the attachment
and sends through the existing composer. Remote host session IDs and desktop
composer IDs are tracked separately.

This vocabulary follows the [OpenChamber browser annotation contract](https://github.com/openchamber/openchamber/blob/main/packages/ui/src/lib/browser/contract.ts).
bycoda collects one element using its existing headless browser and device lease.
The host checks project/session membership at the RPC boundary and binds each
inspection to its owner, lease, annotation ID and navigation ID. Main-frame
navigation (including history navigation), browser input, control release/expiry,
revocation and target changes invalidate pending selections. Late UI responses
cannot attach to a newly selected project/session. The host rechecks the DOM,
geometry and redaction plan after capture and before adding the selection. Once
added, the attachment is a dated snapshot in the draft, independent of live
browser control.

Selectors use tag names and sibling positions rather than potentially sensitive
attribute values. Form values, editable content, hidden text, sensitive-marked
blocks and detected credential text are excluded. URL queries/fragments and
credential-like path segments are removed. The screenshot masks form controls,
sensitive blocks, detected secrets, all iframes and custom element hosts. iframe
content (including cross-origin frames) and shadow DOM inspection are explicitly
unsupported. Exceeding bounded inspection/redaction budgets fails the capture.
Chromium's DOM protocol identifies closed shadow hosts as well. A temporary
screenshot stylesheet hides private content overflowing its element box and is
restored after capture; neither shadow attributes nor shadow contents are copied.
The context and screenshot are marked as untrusted page data in provider prompts;
page text is displayed as text and cannot grant sending permissions.

Annotation RPCs are `browser.annotation.start`, `.hover`, `.select`, `.clear`,
`.read` and `.cancel`, advertised under `browser.annotation`. They reuse
`browser.shared`, its 30-second lease, one-operation gate and frame budget.
An older host without annotation support reports that it needs updating.

Source acceptance runs with
`pnpm exec playwright test --config tests/browser/playwright.browser-annotation.config.ts`.
The fixture uses the actual BrowserPanel, Composer and source SharedBrowser with
a separate Chromium page. Its test identity and RPC route are isolated from any
installed host or provider. It proves fixture behavior only; installed Windows/Mac
app acceptance still requires the normal authorized local update and live checks.

## Diagnostics and acceptance

`resources.read` samples OS memory/load and the host Node process on demand, at
most once per second. It retains up to 60 samples and 64 KiB, limits active readers
to 32 with a 60-second TTL, and retains hashed reader identifiers. CPU excludes
provider subprocesses. Windows load average is reported as unavailable, not zero.
There is no background sampler or whole-system process enumeration.

The desktop panels mount only when selected. Browser frames refresh explicitly or
through opt-in live viewing; diagnostics refresh explicitly. Live acceptance requires a paired remote browser, real
provider session including an approval/question, and Playwright/Chromium on the
target host. Source tests do not establish network, simulator, packaged Windows,
Mac, or installed mobile acceptance.

## Integration hooks

- Instantiate `WebControl(origin)`. Call `handle(request,response)` before the
  native RPC guard. Permit `acceptsRpc(request)` only as the narrow browser route
  exception; retain existing bearer authentication and post-body revocation checks.
- `ResourceDiagnostics.read(token)` handles `resources.read`;
  capability `resources.diagnostics`. Call `revoke(token)` on revocation and
  `close()` on shutdown.
- `SharedBrowser.dispatch(method,params,token)` handles `browser.status`, `.claim`,
  `.release`, `.open`, `.frame`, `.input`, `.close`; capability `browser.shared`.
  `revoke(token)` clears the lease and `close()` shuts down Chromium.
- Annotation calls validate their project/session at the host RPC boundary and
  carry `{projectId, sessionId, leaseId, navigationId, annotationId}` after start.
- Desktop `BrowserPanel` and `DiagnosticsPanel` take `{cwd}` and resolve only the
  owning host through `hostFeatureRequest`.
- Advertise the canonical control URL in authenticated host metadata so callers
  can show or copy a token-free link. Never embed the bearer credential.
