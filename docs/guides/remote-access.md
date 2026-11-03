# Remote access (experimental)

Development Host input changes keep a stopped operation's cleanup separate from
permission to send another prompt. If its original target or cleanup cannot be
verified, the operation remains unresolved. This work has not enabled automatic
migration of existing conversations or installed a new Windows application.

bycoda can run Claude Code, Codex, Cursor, Grok Build, OpenCode, Pi, OMP, fx, Hermes Agent, and Antigravity sessions on a separate Windows, Linux, or macOS host. The host owns the provider processes and session database. Closing the desktop, closing a session tab, or losing the SSH tunnel does not stop a host session.

A folder on a connected machine is a project in the rail, marked with a globe. Every session in it runs on that machine, in the same session view and composer as a local session. The Sessions sidebar lists that machine's sessions for the project.

## Create a Host conversation on this computer

Use matching current desktop and Host builds. Delayed input or cleanup for an
older provider process cannot target its replacement. A client without the
original process receipt must update before targeted write/stop actions. If
Native cleanup cannot identify the original running processes, it remains
unconfirmed and keeps the workspace reserved for recovery.

On Windows, a Host package containing the native provider guardian waits for
the original process and its owned input/output work to finish. If that
guardian is lost before cleanup can be confirmed, the same session cannot start
a replacement process. Other sessions remain available. Reconnecting from
another device does not clear the original uncertainty. Packages using the
legacy guard retain its existing, more limited cleanup evidence.

A timed-out CLI check does not prove that its process stopped. Sign-in state
stays unknown while an original check is unresolved; repeating the check joins
that same work. Other account profiles remain available. Cleanup can remain
pending until the original process and its accepted input actually finish.
Command output can be available while cleanup remains unconfirmed. That output
does not release a workspace reservation whose original cleanup is still unknown.

Stopping an older process cannot stop its replacement, even when both belong to
the same conversation. If Stop fails and the original outcome remains unknown,
another click retains that failure instead of silently starting a second stop
against whichever process is now current. The conversation can remain blocked
until its original cleanup is confirmed; unrelated conversations remain usable.

Matching development desktop and Native builds can keep a provider process warm
between messages while retaining each message's original input writer. A new
message can wait for accepted earlier writes to finish. Uncertain original input
can keep that conversation held for recovery; retry does not transfer it to a
newer message. This input layer does not complete app-tool or device migration.

Existing Native conversations are not automatically moved to the Host. Draft
checkpoint retention and a successful remote action are separate outcomes: a
retained draft does not mean that a message was sent or applied. If an operation's
outcome is uncertain, bycoda keeps it unresolved rather than sending it again.

Private Native checkpoints can retain unsent question answers, queue edits and
source/merge editor drafts as recovery data. They do not submit those inputs.
The regular question draft still clears when discarded; earlier private
checkpoint snapshots are separate retained data with no permission to restore
or answer the question. Editor checkpoint retention also does not report a
successful save to the file on disk.

While a Native checkpoint is preparing, affected inputs can temporarily become
read-only. Work already accepted can finish; preparation does not send a new
message, save a file or commit an unfinished IME composition on your behalf.
Cancellation waits for the Native preparation to release its input gates.

Pending local file, attachment or Notes operations can prevent preparation from
completing. Closing their initiating view or losing a reply does not cancel the
original work or make it safe to repeat. These checks do not move Notes or their
unsaved edits to another computer; that migration remains unavailable.

If a Host Notes request loses its reply while the operation is still running,
later Notes requests stay queued until the original operation really finishes.
A failed response alone does not mean it is safe to repeat the save.

Preparation can also retain unsaved Notes from the library, session dock and
closed editor views, including unfinished titles or tags. It keeps those inputs
as private recovery data. It does not save the note, insert an image or apply a
recovery choice. A pending operation keeps its original result even after its
view closes; an uncertain outcome is held for reconciliation without replay.

If a Notes field closes with unconfirmed input, **Retained note input** lets you
copy its exact text and open the note to check it. Reusing that input is an
explicit choice. Empty text, spaces and unfinished composition are preserved;
opening the note does not automatically apply or save them. When private recovery
capacity is full, new operations wait while the retained input stays available.
When inserting several images, a later failure preserves references to images
already saved so their outcome can be checked before another attempt.

For a local project, open its project menu and choose **New conversation on this
computer's Host**. bycoda connects to this computer's Host before opening the new
conversation. Send the first message to create it there. The project and selected
worktree remain on this computer, while the Host owns execution and transcript
storage. If the Host is unavailable, the action shows an error; it does not start
the conversation through Native execution.

Model and account choices come from that Host. Named accounts must already exist
on the Host; changing or clearing the account uses the Host's settings. Closing
the tab or losing the connection does not stop an accepted turn. An uncertain
send retains its command ID for receipt recovery.

This is an explicit option for new conversations. Existing local conversations
and the ordinary new-conversation action keep their current execution behavior.
It does not migrate an existing conversation.

The Host conversation stays attached to its project even before its first send.
Selecting another project opens a separate conversation using the ordinary
project defaults.

Use the existing Host connection and pairing workflow to reach Host conversations
from another device; installed
cross-device acceptance of this new local entry point is still pending.

## Connection changes and active tools

When a Host connection is blocked, the conversation shows one connection recovery
notice. Use **Reconnect** there to verify the saved machine and open a fresh
connection. The conversation, queue and workspace reload after recovery; a failed
queue read continues to hold sending. Reconnecting never resends a message whose
delivery is uncertain. Authentication or machine identity failures may require
signing in or correcting the saved connection in **Connection settings**.

A workspace path belongs to the computer that stores that project. A local
Windows project must be opened through that computer's Host, with the project
registered there. A remote server cannot use its own Host to write a path on your
computer. A path rejection remains a separate workspace error once connectivity
is restored; reconnecting does not grant access to folders outside registered
projects.

Terminal log streams, pending desktop tools and development previews keep the
computer selected when that operation started. Replacing or removing a connection
stops new access through the old operation; it does not send its remaining output
or actions to another computer. Reopen a development link after reconnecting.
An interrupted reply does not automatically repeat a potentially accepted action.

Device actions follow that same rule. If a computer connection changes after an
action starts, its outcome may be unknown even when no result reaches this view.
Inspect the original device or preview status before repeating an input. A preview
whose original permission has expired cannot supply another stored screenshot;
start a separately authorized capture when you need a current view.
The same uncertainty can occur while setting up device tools or stopping the
device service. Reconnect and check that computer's device-tool status before
trying again. Mobile previews keep their original computer, project and access;
switching projects does not transfer an existing preview to the new project.

A social authority needs a stable HTTPS address, or a local loopback address for
local use. An SSH connection alone is not an address that another Host can store
and contact as its authority. The setup checks both peer addresses before issuing
an enrollment token.

## Connect through SSH

### Servers catalog and terminal tabs

The Servers catalog distinguishes saved SSH terminal targets from machines running
bycoda Host. Machine connection status comes from the connection state; a saved SSH
entry alone does not establish that its destination is reachable. Use **Connect**
to open a terminal, or select an entry to inspect its address and connection,
forwarding, automation, organization and activity tools. Applied filters are shown
beside the catalog; **Recently used first** changes order without filtering entries.

SSH tabs support the close action, middle click and Delete on the focused tab.
The existing terminal close policy asks before closing foreground work or a terminal
whose process status cannot be determined. Closing the active tab selects a surviving
neighbor. Opening, running, failed and exited labels describe the terminal lifecycle;
an opened terminal does not by itself verify remote SSH authentication.

While a terminal is open, **Saved SSH tabs** holds the restore preference and pending
entries. Only saved connections can be remembered. Restoring an entry requires
**Connect**, opens a new shell and does not replay previous commands. Exact endpoint
and identity-file details remain available from the terminal's connection information.

Agents use `servers.ssh.execute` to request a command on a saved SSH target.
The connected desktop asks for approval of the exact target and command; no
existing private terminal is shared. `servers.ssh.status` returns bounded output
and exit status. Cancel and timeout stop local SSH but can leave the remote
outcome unknown. Results are process-local and commands are never replayed on
restore. See [Working with bycoda tools](agent-tools.md) for the agent workflow.

SSH settings load keys, known hosts and agent information independently. A failed
section has its own **Retry** action; successfully loaded sections remain available.

In **Settings → Connections → Add machine**, enter an SSH address (`user@my-mac-mini`) or an alias from your SSH config and click **Connect**. The machine picker also links to this Settings page. An optional name and SSH port are available.

bycoda downloads the host package matching the desktop release and remote architecture, verifies its checksum, installs a background service, pairs this desktop, and opens a private SSH forward. Node is included in the host package; users do not build the host, install Node, copy tokens, or run a tunnel command. Existing running hosts are reused without interrupting their agents.

Prerequisites:

- SSH must already be enabled and reachable on the host. bycoda uses the desktop's OpenSSH client and normal SSH config, keys, and agent. Windows clients need the OpenSSH Client feature installed.
- Hosts: Windows 10/11 or Server 2019+, Linux, or macOS, on x64 or arm64. Mac/Linux need `curl` or `wget`, `tar`, and `shasum` or `sha256sum`. Windows needs Windows PowerShell 5.1, OpenSSH Server, and Task Scheduler; no WSL or Unix shell is required. Setup detects the remote platform through SSH.
- Install and authenticate each provider you want to use on the host under the connecting OS account. The host must be able to find its CLI on PATH or in its standard install directory. Antigravity uses its ACP server (`agy_acp_server`) when installed and otherwise the `agy` CLI's headless mode, on every host OS, preferring the ACP server as the desktop does. To pin a binary, put absolute paths in `provider-binaries.json` inside the host data directory, for example `{"codex": "/opt/tools/codex"}`, then restart the host. A configured path that is missing fails with an explicit error instead of falling back to discovery.
- Linux needs systemd user services. Setup runs `loginctl enable-linger` for the SSH account so the host survives logout. Lingering applies to all of that account's user services, and `service uninstall` leaves it enabled. If enabling it requires administrator access, Settings displays the recovery command. macOS needs an active desktop login; keep that Mac signed in and awake.
- Windows uses a per-user Task Scheduler task, with no time limit, under the connecting user's normal permissions. Sign in to that same account at the Windows desktop and keep it signed in and awake. Locking the desktop and disconnecting SSH are fine; signing out or rebooting interrupts agents. The task starts again at the next login. No Windows password is stored for scheduling. This uses an interactive logon token because S4U tasks cannot access network or encrypted files. [Microsoft task logon documentation](https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-logontype).
- Windows provider discovery supports native `.exe` installations and npm-generated `.cmd` shims. The host reads a shim's target without running `cmd.exe`: Node scripts run with the bundled Node runtime, installer shims with their own `node.exe`, and native targets directly. Targets outside the shim's directory and custom `.cmd` wrappers with other commands are not supported. Registry ACP agent installs use npm from the user's Node.js installation or PATH. SSH aliases can supply Windows domain/user names through the normal SSH config.

SSH host verification and password/passphrase prompts appear in Settings. Changed host keys are rejected by OpenSSH. Passwords/passphrases are used only for the current authentication, not saved. When key/agent authentication is available, opening the remote view restores a lost tunnel automatically. If SSH needs another prompt, use **Reconnect** in Settings. Reconnecting uses the saved device credential and checks the host's identity.

While a machine is off or out of reach, bycoda checks it again in the background: after 2, 5, 15 and 30 seconds, then every minute, and at once when the window regains focus or the network returns. Checks stop after the window has been hidden for 10 minutes. They stay quiet: the **Reconnect** button and the project row show progress only for a reconnect you start. Turn off **Automatically reconnect to remote machines** to stop them.

The forward binds to a temporary port on the laptop's loopback interface. Quitting the desktop closes only that forward. It does not stop the host service or its agent sessions.

**Remove** in Settings asks for confirmation and offers two choices. **Remove from this desktop only** deletes the saved connection and closes its forward. The host keeps running, and this desktop's device credential stays valid on it. **Revoke access and remove** first asks the host to revoke the credential this desktop is using, then removes the connection. It needs the machine to be reachable, and if revocation fails the connection is kept. Neither option stops the host, affects other desktops' credentials, or deletes sessions. Adding the same machine again reconnects its projects, tabs, and history.

## Start a session

1. In the project rail, click **+** next to Projects and choose **Open folder on a machine…**.
2. Choose the machine, browse to an existing checkout (or type its absolute path, such as `/home/me/code/my-app`), and click **Open**.
3. Send a message. The first message creates the session on the host with the model, reasoning effort, and permission mode shown in the composer.

The composer's model picker lists models for the providers installed on the host. Model, provider-specific settings, and permission changes apply to the host session directly, and the next turn uses them; a change made during a running turn is applied when that turn finishes. If the host cannot load its model list, or no longer lists the session's model, the session's saved settings remain visible. The normal workspace and branch pickers use the host checkout through the shared file and Git commands. Choose an existing host worktree or create one from a branch before the first message; the session then runs in that working copy. Once the conversation starts, its worktree is fixed, as in a local session. Start a new session to use another worktree. The branch picker can search local and remote branches, create a local branch, and switch the current working copy when it is clean and the project's sessions are idle. Machine connection state appears on its project rail dot.

The **Explorer** sidebar and Go to File use the normal file views for host folders and files. Opening a text file uses the normal editor tabs. Saving writes back to the host; remote reads and edits are limited to 1 MiB text files. File creation, rename, deletion, and project search use the same controls as local projects. The **Changes** sidebar and Git history graph use the normal Git views, including file diffs, staging, discarding, commits, pushing, and pull request creation through `gh` on the host. Remote pull requests use the host's commit list and diff summary for their title and body. An ordinary folder outside Git shows an empty Changes state. Git changes are refreshed every few seconds. Generated commit messages are not available remotely yet.

The composer’s **+** menu supports file and image attachments, and its **Mode** menu offers Plan mode and saved drafts, when the host advertises these capabilities. Attachments are copied to the host’s private data directory before the turn or draft is recorded; each file is limited to 20 MiB. Image previews are restored from the host when you reopen a conversation. A draft can be sent or removed from its transcript card. Plan mode uses the host provider and produces a reviewable plan card whose Build action continues on the host with the session’s current model. Update older hosts to enable these actions.

Features that read or run on this computer are not available in these projects: `@` file mentions, skills and slash commands other than `/plan` and `/compact`, operator mode, and terminals. Worktree deletion and the local worktree settings page are not available remotely yet. Plans from the transcript open normal read-only plan tabs. Source files stay on the host; this feature shares host-owned sessions, not working-directory synchronization.

## Manual connection (advanced / development)

Use Node.js 24 or newer on the host. Install and sign in to the providers you want under the same OS account that runs the host. The host uses that account's default provider credentials and searches its PATH and common per-user and system installation directories.

From a checkout of this version of bycoda on the host:

```sh
pnpm install --frozen-lockfile
pnpm run host:build
node build/host/bycoda-host.mjs start
node build/host/bycoda-host.mjs pair --name "My laptop"
```

`start` launches the host independently of the terminal. `pair` prints a device ID and a device token; copy the token to the receiving desktop. Create a separate credential for each desktop. Tokens grant control of the host as its OS user, including provider execution and workspace reads.

The host binds only to `127.0.0.1:3776`. State and logs live in `~/.bycoda-host` (`%USERPROFILE%\.bycoda-host` on Windows). Unix permissions restrict access to the owner; Windows ACLs restrict it to the current user, SYSTEM, and Administrators. Use `--data-dir` and `--port` to override them. `serve` runs in the foreground for debugging.

Open an SSH tunnel from your laptop:

```sh
ssh -N -L 3776:127.0.0.1:3776 user@your-host
```

Under **Settings → Connections → Connect to an existing host by URL**, enter `http://127.0.0.1:3776` and the device token.

When the laptop wakes, restore the SSH tunnel. The remote view reconnects automatically and loads the host's latest persisted snapshot. An uncertain request retains its original command ID, including creation of a new session and its first message. **Retry** asks the host for that same command’s receipt, so a lost response does not create another conversation or submit the prompt again. Pending requests survive restarting the desktop and belong to the tab that created them.

The desktop-to-Host migration is still under development. Its internal preparation
check refuses a running or uncertain Native session and leaves the provider
working. An idle preparation may briefly hold new input while windows save their
state; cancellation releases it after accepted storage work finishes. This check
does not move an existing conversation to another computer or enable a new
execution default. Installed multi-device migration still requires acceptance.

HTTPS endpoints can also be entered if you operate a reverse proxy to the loopback host. Plain HTTP is accepted only for loopback endpoints. Native desktop HTTP carries the saved credential; it is not exposed to the renderer or browser storage. The native connection store is `remote-machines.json` in the desktop app's data directory, with mode 0600 on Unix. This initial implementation does not use the OS keychain.

## Manage the host

```sh
node build/host/bycoda-host.mjs status
node build/host/bycoda-host.mjs devices
node build/host/bycoda-host.mjs revoke DEVICE_ID
node build/host/bycoda-host.mjs stop
node build/host/bycoda-host.mjs service uninstall
```

SSH setup names each device credential after the desktop's computer name. Removing a saved connection from the desktop does not stop the host. It revokes the device credential only when you choose **Revoke access and remove**. Otherwise, use `devices` and `revoke` on the host to remove access. Stopping the host interrupts active turns; restarting retains their transcripts and marks them interrupted. No uncertain provider operation is automatically replayed after a host crash.

`service uninstall` is the cleanup path for a host you no longer want running. It removes the systemd user service, the LaunchAgent, or this user's scheduled task. It then stops the host, including a manually started one, and interrupts any running turns. It never deletes the data directory. Sessions, logs, and device credentials stay in `~/.bycoda-host` until you delete that directory yourself. To remove access without stopping the host, use `revoke` instead. On Linux, the command prints how to turn off lingering if nothing else needs it.

The machine must remain awake. Manual `start` launches a detached process. `service install` installs a user service; SSH setup runs it automatically. Only one host may own a data directory. Restart the host after changing its provider installation or PATH. Service installs preserve an already-running host, including one previously started manually.

SSH-installed hosts have a launcher at `~/.bycoda-host/bin/bycoda-host`; use it in place of `node build/host/bycoda-host.mjs` in management commands. Linux services are named `bycoda-host.service`; macOS uses `com.bycoda.host`. A service manager can restart a stopped process, so use `service uninstall` rather than `stop` to keep the host stopped.

On Windows, the launcher is `%USERPROFILE%\.bycoda-host\bin\bycoda-host.cmd`. The scheduled task is named `Bycoda Host-<user SID>`; `service uninstall` unregisters it and stops the host. Normal cancellation and shutdown stop the provider's process tree. A plain manual `start` is detached, but use `service install` for SSH-hosted Windows sessions so Task Scheduler owns the process independently of the SSH login.

## Release packaging

`pnpm run host:package` builds a self-contained package for the current Windows/Mac/Linux architecture. `pnpm run host:package -- --all` builds all six archives, using pinned official Node binaries and checksums. Archives contain the host bundle, runtime, launcher, and licenses. `host/package.mjs` pins the runtime version. Cross-packaging Windows on Unix requires `zip` and `unzip`; native Windows packaging uses PowerShell.

The optional physical admission module has an explicit native build:

```sh
pnpm run host:admission:build --target win32-x64
pnpm run host:package -- --target win32-x64 --native-admission
```

The native command requires the selected Rust target and its linker to be
available; it does not install toolchains. It writes a target-specific bundle
under `build/host-native/`. Packaging verifies its target, checksum and current
native source fingerprint before replacing a package. For `--all`, first build
all six native bundles. `--native-admission-dir` selects an alternate directory
containing those target folders. Ordinary `host:build` and `host:package` remain
usable without a native module.

For a development Host, build JavaScript normally and use
`pnpm run host:admission:build --output build/host` to place the native manifest
beside its worker. Images use immutable hash filenames; rebuilding changes
the manifest without overwriting a loaded image. A running Host keeps its original
module until it exits. Missing or unsupported native admission leaves an ordinary
Host explicitly unjoined; a corrupt configured module or a fault after joining
holds protected work. Windows actual-connection attestation and participating
writer fences do not establish complete actor coverage. Linux/macOS actual SQLite
connection attestation and full migration qualification remain pending.

Windows Node/SQLite limits the UTF-8 extension loading path, including the
Windows namespace prefix, to 260 bytes. The flat image filename keeps the bundle
compact; a longer configured path is refused before joining. Choose a shorter
build/package location for that case. No working-directory change or unverified
alternate image is used.

Each tagged release publishes `bycoda-host-{darwin,linux}-{arm64,x64}.tar.gz`, `bycoda-host-win32-{arm64,x64}.zip`, and their `.sha256` files alongside the desktop installers, and its desktop builds are configured with that release's download address (`BYCODA_HOST_RELEASE_URL`). SSH setup installs the matching version under `~/.bycoda-host/runtime`.

**The host on this computer** ships inside the Windows and macOS installers. On start, an installed release app installs that host if this computer has none, and upgrades it when the bundled version is newer, using the same verified installer as SSH setup. It never downgrades, waits while the host has running sessions or another update is being installed, and treats an unreadable host database as busy. A waiting or failed update is shown in Settings → Connections and retried while the app is open.

**Unreleased development builds:** automatic first-time installation and **Update Host** require host archives published for the desktop version. Tagged releases include the matching archives; an unreleased checkout does not. Until the matching release is available, use the manual development connection above. A missing archive produces an explicit error in Settings. No fallback to an arbitrary latest release or unverified download is used. Connecting does not automatically upgrade a running host. When an SSH host lacks Explorer or Changes, Settings → Connections offers **Update Host**. This downloads and verifies the matching package, restarts the host service, and reconnects using the existing device credential. The restart interrupts active agent turns; sessions and history remain on the host. URL connections must be updated on the host manually.

## Automations during a connection outage

An unreachable machine shows a warning in Automations. Available records and the
automation picker remain usable; an unread remote list is not treated as empty.
Previously loaded remote records remain marked as out of date. **Retry** in the
warning requests a fresh connection check, including recovery of a dropped SSH
tunnel. Retrying preserves the open draft and does not save or run an automation.

## Interrupted Native helper requests

Local reminder and SSH setting changes can also be temporarily refused during
workspace capture. Refused changes leave their saved values intact. Reminders
that become due while new work is closed remain pending for a later timer tick.
An already claimed reminder is not sent again merely because a notification or
reply failed. Notes images return a usable path only after their file bytes are
written and synchronized; a failed or uncertain outcome keeps its original
status and should be checked before inserting the image again.

When a local workspace capture temporarily refuses a local automation change,
the refused request leaves saved rows unchanged. A failed save keeps its editor
draft; retry after capture finishes. Time-based scheduling and startup recovery
retry on their normal next evaluation. An accepted local write finishes before
capture proceeds.

Workspace capture can also temporarily refuse SSH runbook changes, new runs,
scheduled review refreshes and recovery from saved run records. A refused change
leaves the saved records unchanged; retry after capture finishes. An already
accepted run keeps its original permission through its last local status write
and worker cleanup. Its cached status and Stop control remain available while
new work is refused. Stopping the local SSH process can still leave the remote
script's outcome unknown; check that outcome before starting another run.

Development source now retains the original Native editor buffer report and
desktop finish/format request before sending it. If the connection breaks after
the Host may have accepted the request, recovery asks for that original's outcome
instead of repeating the operation. An unknown outcome stays pending; it does
not mean the operation failed. In particular, formatting must not be repeated
automatically and an old buffer receipt cannot mark a newer editor state saved.
After the local result has been safely consumed, a separate acknowledgement lets
the Host release its large retained result. If that acknowledgement is interrupted,
the app retries cleanup without repeating the original operation. Pending cleanup
does not undo a successful local result. When retained result capacity is full,
the Host rejects new formatting before starting it.
This source behavior still requires installed-platform acceptance; it is not a
claim about the version currently installed on your computer.

In the development source, the Host database also retains buffer reports and
their recovery metadata. These are paths and dirty/unknown flags, not an extra
copy of unsaved editor text. Existing report/archive JSON files are legacy copies;
copying them alone does not back up new reports. Keep a coherent Host database
backup for restoration. Reading a recovered report does not mark an old editor
owner current or authorize resolving dirty buffers.

If the Host's helper handler has finished but its result is still unknown,
development source can release that request's reserved result capacity without
repeating it. Later requests can proceed while the original remains pending.
Requests whose helper is still running, or whose admission was interrupted, keep
their reservation. Releasing capacity does not mean the original failed or that
it is safe to send it again.

New development clients can also clean up completed delivery records in ordered
groups while retaining a permanent guard against replay. Interrupted cleanup does
not repeat the operation. Missing or uncertain outcomes stop cleanup until their
original state is known. After a computer connection starts using this protocol,
older clients must update before sending new buffer reports, finish replies or
formatting requests through that connection; existing outcomes can still be read.
This remains development-source behavior pending installed-platform acceptance.

## Scope of this first version

Supported: persistent remote text conversations with all ten local provider adapters, follow-up turns, approvals, questions where the provider offers them, cancellation, per-device revocation, reconnect, remote file browsing and text editing, Git status, file diffs, and history, staging and commits, branch selection and creation, worktree selection and creation, and a tracked Git diff against HEAD. OpenCode's server and event stream stay on the host's loopback interface. Cursor's optional enrichment from its native session database is not available on the headless host; basic transcript and subagent events still work. The desktop polls the host and downloads only transcript blocks that changed since its last update (every 0.75 s while a session runs, 3 s otherwise). The desktop rejects any single host response over 16 MiB. A sync above 4 MiB, such as reopening a very long transcript or one very large tool output, is sent as a series of bounded pieces of one consistent revision. Transcript size is therefore not limited by the response cap. The host writes streamed output in 120 ms batches and keeps a bounded event journal.

Remote history appears in the Sessions sidebar of each project on a machine. Host snapshots also populate the app's normal session state while the tab is open; they are not written to the local session store. Remote `/compact` uses the provider's context compaction, and `/plan` selects the host provider's plan mode. Queued follow-ups and editing the last message still need host commands. Other local slash commands and skill expansion are not yet available remotely. Worktree deletion, terminals, generated image output, named provider accounts, `/operator`, automations, orchestration, LAN discovery, and account-based tunnels are not implemented yet. Other remote prompts are sent directly to the provider.

The headless host runs the reused TypeScript adapters with a Node process backend. It proves the execution boundary without introducing the planned Rust daemon/worker IPC yet. Node is included in host release archives, separately from the desktop application.

## Verify

```sh
pnpm run host:build
pnpm run test:host
pnpm run check:web
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test
```

Host tests use fake provider executables and temporary loopback servers. They do not contact paid models. They cover the Codex and Claude transports, Pi/OMP RPC, ACP providers, OpenCode HTTP and event streaming, cross-client reattachment, duplicate sends, approval races, interruption recovery, device revocation, path checks, and detached host lifecycle. On Node 26, use `NODE_OPTIONS=--no-experimental-webstorage pnpm run check:web` to avoid its experimental global storage interfering with the existing happy-dom tests.

For the real OpenSSH transport and native askpass smoke test on Linux/macOS, build with `pnpm run host:package` and `cargo build --bin bycoda`, then run `python3 scripts/checks/test-remote-ssh.py`. It uses a disposable loopback sshd, temporary keys and known-hosts file, and an isolated packaged host. It leaves personal SSH configuration, provider credentials, and OS services untouched.

Host CI runs on Windows, macOS, and Linux. Windows-specific tests cover ACL inheritance, Task Scheduler definitions, bootstrap parsing/installation, and provider child-process cleanup. They use temporary data and mocked task registration so normal test runs do not install or replace a real user's background task. Full SSH-to-Task-Scheduler setup must also be validated on a signed-in Windows host before a supported release.
