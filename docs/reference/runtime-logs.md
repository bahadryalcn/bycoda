# Runtime logs

The **Logs** tab in Conversation Tools combines console output and runtime errors
from the managed host browser with output from development servers and native
bycoda terminals. Terminal capture runs outside the webview, so switching tabs or
closing the log panel does not interrupt it. Output belongs to the terminal's
launch directory on the local machine and is redacted before host retention. It runs on the selected tool machine and defaults to the conversation's
project host.

Monitoring is stopped on entry. Click **Read logs** to read the project's
captured sources; a new conversation does not need a host session record. A read
failure pauses polling until you explicitly resume or refresh. Source choices and
the watching summary show the source URL, including its port when reported.

Enter a port (for example `5173`) or an HTTP(S) URL and click **Open website and capture logs** to
open an independent, isolated browser on the project's host. These monitors
capture browser console, page errors and network failures without replacing the
shared Host browser. Multiple projects and URLs can run simultaneously (up to
eight host-wide). **Load monitors** lists existing project monitors, **Show logs**
selects one and **Stop monitor** closes its browser. Closing a panel or pausing
its reads does not stop these monitors; a host shutdown closes all of them.
A port alone cannot expose an unrelated server process's stdout/stderr. Start
the server through Development servers or a bycoda terminal to capture its output.
Terminal capture requires both the updated desktop and host; earlier output from
an already running terminal cannot be recovered. Browser runtime
setup remains explicit through Host browser; starting a monitor never installs it.

**Expand / restore** enlarges the footer panel. **Place in layout** opens a
resizable workspace region with left, right, top and bottom placement. **Separate
Logs panel** places only Logs there. Open panels from different projects to keep
their views visible together in that region. **Open in new window** and **Logs in new
window** open resizable native windows that can be moved to another monitor.

## Inspecting output

The log canvas is neutral. Each row starts with a colored `[SERVER]` or `[BROWSER]`
label. ERROR, WARN, INFO, DEBUG, HTTP and SUCCESS have separate text colors.
Next.js request lines with 4xx/5xx responses appear as ERROR; successful request
lines appear as HTTP, while ready/compiled messages appear as SUCCESS.
These display categories preserve the host's four-level transport contract.

Use **Filters and options** for source/severity filters, monitor management and
export. This overlay does not resize the log timeline. Use text search to narrow
the timeline. Repeated errors
can be grouped; expand an entry to inspect captured arguments, a stack trace or a
source location. Source navigation is available on the project's host when a
location can be resolved within the project.

Pause freezes collection in the panel. Resume catches up from its cursor.
Auto-scroll follows the latest visible rows. Clear removes the current panel view
and sets a cursor watermark; it does not stop a process or delete another
conversation's logs. Export writes the visible log selection to a local file.

**Add to conversation** adds diagnostic data to the selected conversation's
composer. Review and send the draft to start analysis. This action never sends a
message automatically. Log text, URLs, error messages and object values are
untrusted application data, not instructions.

## Captured sources and limits

- The managed browser captures console events, uncaught page errors, failed
  requests and HTTP error responses after capture begins. Opening it from the
  conversation assigns the project and session context to subsequent events.
- Development servers launched by bycoda produce timestamped output from stdout
  and stderr. A partial UTF-8 sequence or line is buffered until it can be read;
  storage and individual entries are bounded.
- A process launched outside bycoda can be discovered as a source, but its past
  stdout/stderr cannot be recovered. Such sources show output as unavailable.
- Capture survives closing the Logs panel while the host and managed sources
  remain running. The panel polls only while mounted. In-memory history does not
  survive a host restart. A dropped-record indicator describes retention gaps.
- Common credential patterns are redacted before retention. Avoid printing
  sensitive information in application logs; pattern redaction cannot identify
  every possible secret.

## Host and agent tools

The host advertises `runtime.logs`. Paired owner clients can call
`runtimeLogs.read` and `runtimeLogs.sources` with their selected host context.
The desktop forwards these read operations through its ordinary remote method
allowlist. Hosts advertising `runtime.logs.monitors` also accept paired-owner
`runtimeLogs.monitors.list`, `runtimeLogs.monitors.start` and
`runtimeLogs.monitors.stop` requests with a validated project ID. Session log
grants cannot create, stop or list monitors; agent tools remain read-only.

Agents receive an independent, short-lived session grant. The host derives the
project and session from its own session identity, checks issuer revocation and
does not accept a caller-supplied project or session override. Log grants neither
grant social actions nor replace social access grants.

The `bycoda-runtime-logs` MCP bridge exposes `runtime_logs_read` and
`runtime_logs_sources`. Providers without MCP support can use the same host CLI:

```text
bycoda-host runtime-logs read --input -
bycoda-host runtime-logs sources --input -
```

Input is a JSON object on stdin. Read filters include `source` (`browser` or
`server`), `sourceId`, `levels`, `search`, `after` and `limit`. Read-only tools
cannot navigate a browser, execute commands, change policies, clear host history
or send messages. Remote projects read the logs on their own host; an unavailable
remote host never silently falls back to the local machine.
