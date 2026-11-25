# MCP connections

The connection list scrolls continuously, retaining search and provider/scope
filters during refresh. Refresh failures appear after the last loaded row and
keep that result available with Retry.

Each connection shows permission, verified readiness and activity separately.
Configured or signed in does not mean verified ready. Current successful connection
health can confirm readiness; a failed refresh clears the old health observation.
Activity stays unknown where the provider does not expose a live operation feed.
Opening this page only reads configuration and status; it does not enable a server.

Settings > MCP lists provider configurations and the servers the selected bycoda Host
finds, including Claude plugins and account connections. Open a row and look under
**Use in bycoda** to manage sign-in, project credentials where supported, and session
startup for that server.
Provider controls include **Enabled**, the file path, **Edit provider JSON**, and
**Remove** for Claude Code. Edits save to the same provider file. If the file changes
after you open it, reload it and apply your edits again.

**Session startup** below the list chooses **When needed** (a server starts the first
time a session uses one of its tools) or **With every session** (all servers start when
a session opens).

Settings > MCP opens in **Global** view. Choose a **Computer** to see its machine-wide
provider configuration. The list starts on **This computer**. Switch to **Project**
and select a project to see its configuration and inherited global entries. The
project determines which computer and Host bycoda uses in this view. Select a project
to change Claude Code permissions.

If the selected computer has a reachable Host but lacks the updated bycoda desktop
app, you can still view servers the Host knows about and manage their bycoda credentials.
Install the updated desktop app on that computer to edit provider configuration.
Global refresh does not run Claude's project-based health check. Each row belongs to a specific
provider and scope, shown as a tag next to its name: **Global** applies to every
project for that provider, **Project** is saved in the selected project's provider
configuration, and **Local project** applies only to the selected project in your
personal Claude configuration. Filters can narrow the list by provider and scope.
**Add server** defaults to **bycoda Hub** on the selected computer. Add a Global
server for that computer or a Project server for the selected project. The Hub
publishes the entry to bycoda-managed Claude Code, Codex and OpenCode sessions.
The Hub runs managed HTTP servers on demand through conversation tools.
Open a Hub server to edit, disable or remove its definition. A project definition
with the same name takes precedence over a Global definition for that project.
Global Hub credentials apply on that computer. Project credentials can override
them. Choose a provider in the add form when you need its own configuration file.
In Project view you
can also choose the scope. Claude Code starts with **Local project** in this view.
For HTTP or HTTPS servers, enter the **Server URL** where
supported. Choose **JSON configuration**
to paste an `mcpServers` block or a server object, including stdio configurations.
The project path appears for project scopes. If saving
succeeds but refreshing fails, the dialog keeps the saved fields locked. **Retry**
only refreshes discovery; it does not add the server again. **Done** closes the dialog.
Credentials saved by one provider are not evidence that another
provider is signed in; complete that provider's authorization when needed.

For a server that needs an API token, select **Project**, open the server and choose
**Set credentials**. Enter HTTP header names and values for an HTTP server, or
environment variable names and values for a stdio server. The project's Host stores
these values in its encrypted vault. Keep tokens out of provider JSON, which may be
shared with the project. These credentials apply to bycoda sessions for the selected
project on that computer. Start a new session after setting, replacing or removing
credentials. Saving replaces all previously saved values for that server in the
project. Removing them restores the server's default authentication for new sessions.
bycoda uses its conversation tools to start HTTP servers with project credentials on
demand. This keeps their credentials in the Host.

Use a file's **Enabled** switch in the detail panel to enable or disable a server for
Codex, OpenCode or Claude Code. Codex and OpenCode changes apply
to that exact provider, scope and configuration file. Claude Code changes apply to
every scope with that server name in the selected project. Cursor and Claude Desktop
connections require their own client controls and do not support this action here.
A disabled connection stays
listed so it can be enabled again. **Disabled** describes saved configuration,
not connection health. Start a new conversation in the provider to load the changed
tool configuration; an existing running conversation can retain its current tools.
If saving fails, the row retains its last confirmed state. Refresh and inspect the
configuration before retrying an uncertain write.

For a remote computer, use **bycoda sign-in** for supported HTTP OAuth connections.
The selected bycoda Host handles authorization and stores the login for its sessions.
Manage provider CLI sign-in on the computer that runs that provider.

Open a signed-in server's details to see the account email or name when the
server advertises a compatible MCP profile tool. bycoda looks it up automatically
using the selected computer and project's effective OAuth login. When a profile
is unavailable, the row keeps its sign-in status and says so.

In **Global**, bycoda sign-in sets the computer's default account for that server.
Choose **Cancel** in the server list or details to stop a pending bycoda sign-in.
In **Project**, bycoda uses that account until you sign in or disconnect for the
project. **Uses global sign-in** identifies an inherited account. Choose **Use a
different account** to sign in for this project, or **Disconnect for this project**
to stop using the server's OAuth login in this project. After either action, the
project uses its own sign-in state and stops falling back to the global account.

For local enabled HTTP/SSE connections managed by Claude Code, Codex, Cursor or
OpenCode, choose the provider's **Sign in** action and complete authorization in your
browser. bycoda runs
the provider's own CLI and refreshes the list after it finishes. Keep the app open
while authorization is pending. For a connection already reported as Connected or
Signed in, the row's action menu offers **Sign in again**. If the provider's CLI is
not installed, the page says so instead of starting a sign-in.

If a configuration file exists but cannot be read, for example while a provider is
rewriting `~/.claude.json` or after a syntax error, the page names the file and the
reason instead of showing "No MCP servers configured". Its servers are not listed until
it is readable again; choose **Retry**. Nothing in the file is changed.

**Configured** means the configuration was found. It does not confirm a connection
or a successful login. Opening settings reads configuration only. Choose **Refresh**
to run provider health checks; these may start configured MCP helpers. Claude Code
rows show **Checking** until the Claude CLI reports health; that check can take
more than 30 seconds, and servers it did not
reach in time stay Configured. Claude CLI health is matched by name and is not verified
independently for duplicate names in different scopes. Codex rows show **Signed in**
or **Needs authentication** from Codex's own sign-in state. Cursor and OpenCode can remain
Configured after a successful login because this list has no independent health
probe for them.

Disabled connections, local/stdio tools and clients without a supported CLI login
do not offer this browser action. Manage Claude Desktop authentication
in that client. Cursor uses its [CLI MCP login](https://cursor.com/docs/cli/mcp).
The detail panel shows each file's path, with **Show in folder** and **Copy config
path**.

Adding a Cursor, Claude Desktop or OpenCode server keeps unrelated JSON/JSONC
settings, comments and property order. Existing symbolic links continue to point to the
edited target. If the configuration is invalid, contains duplicate keys or changes
while saving, the operation stops so you can inspect the file before retrying.
An uncertain native replacement reports its retained recovery files; inspect the
configuration before submitting the same change again.

**External MCP access** is separate: its tokens allow another client to access
bycoda's local Host. Creating one does not sign in to Cloudflare, Hostinger or any
other outgoing MCP service.

Incoming tokens retain their project, tool groups, access modes and expiry. The Host
checks expiry again after project validation before issuing a token, and rechecks
revocation and expiry before returning access. Invalid stored grants do not authorize
requests. Lists expose grant metadata only; a failed refresh keeps the last successful
list visible. The issued secret remains a one-time display, never a history field.

MCP operation errors can be dismissed using the close control beside the message. Dismissing an error does not retry the operation.
