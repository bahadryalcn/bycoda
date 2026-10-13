# Development server tools

The **Development servers** tool lives with the project's terminal and conversation tools.
Discovery reads TCP listeners on the project's selected host; it does not scan a
guessed range of common development ports. Remote project requests never fall back
to the desktop's local machine.

The design references OpenChamber's [listener discovery implementation](https://github.com/openchamber/openchamber/tree/main/packages/web/server/lib/dev-servers)
and [preview workflow](https://github.com/openchamber/openchamber/blob/main/packages/docs/content/docs/preview.mdx).
bycoda adds birth identity checks, dedicated managed commands, and explicit process
control to its existing host browser and project action workflows.

## Discovery and association

Windows uses the listening socket table and process metadata. macOS uses `lsof`,
`ps`, and the system Perl native process helper for precise birth identity. If that
helper is unavailable, macOS listeners remain inspectable and process control is
disabled. Linux supports the socket table and `/proc`. Commands have
deadlines and output limits; concurrent metadata work and short-lived scan caches
are bounded. Scan failures are reported separately from successful empty scans.

Each process entry groups its listening addresses and ports. A process working
inside a registered project can be associated through its actual working directory.
Managed commands have a known project. Missing working directories or ambiguous
relationships remain explicitly uncertain; command text alone is not proof of a
project association. A process whose birth identity cannot be read remains
inspectable, but cannot be terminated safely.

## Running and controlling servers

Enable **Manage as development server** on a project action to start its command
as a dedicated host process using that host's existing shell profile. Existing
ordinary terminal actions keep their normal behavior. Managed commands expose
bounded captured logs and starting, running, stopping, stopped, and error states.
External processes do not provide historical output; the UI says when logs are
unavailable.

Stop first attempts graceful shutdown and waits for the selected process to exit.
If it remains alive, force termination is a separate explicit action. On Windows,
headless processes may not expose a graceful shutdown facility; a failed graceful
attempt must offer force termination rather than silently using it. Processes are
checked against their observed PID and birth identity before each signal. A stale
entry cannot authorize a signal to a reused PID.

Process tree control includes only the selected process and its descendants.
It does not ascend into a terminal shell or signal a whole shared process group.
The details view shows descendant identities and affected listening ports before
tree termination. Managed launches use a dedicated shell so their descendants can
be stopped without closing a user's shared terminal.

Restart waits for the previous run to stop. Managed runs retain the original
command and working directory. For external processes, users explicitly define the
restart command and working directory; the host does not reconstruct shell syntax
from process metadata. A configured expected port produces a conflict with the
existing process before launching. Choosing a different port requires an explicit
command change appropriate to the project's server; bycoda does not guess flags.

## Preview and external browser

Preview uses the existing shared host browser and its control lease. Thus remote
loopback URLs are loaded on the remote machine. The host's existing Playwright
setup requirement still applies. **Open in external browser on host** invokes the
OS browser on the owning host; it does not reinterpret a remote localhost URL on
the local desktop. A remote machine without a desktop browser reports the opener
error. Copy URL copies the address as seen from that host.

These are source-level contracts. Platform fixtures and host tests do not prove
an installed desktop, a remote OS, or a production host has accepted an update.
