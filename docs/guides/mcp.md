# MCP connections

The connection list scrolls continuously, retaining search and provider/scope
filters during refresh. Refresh failures appear after the last loaded row and
keep that result available with Retry.

Each connection shows permission, verified readiness and activity separately.
Configured or signed in does not mean verified ready. Current successful connection
health can confirm readiness; a failed refresh clears the old health observation.
Activity stays unknown where the provider does not expose a live operation feed.
Opening this page only reads configuration and status; it does not enable a server.

Settings > MCP opens in **Global** view. Use the **Global / Project** buttons to switch;
Project reveals the local project picker and includes its inherited global entries.
Global reads only machine-wide provider configuration, independently of project-path
errors. Claude Code permissions are project-specific: select Project to change them.
Global refresh does not run Claude's project-based health check. Each row belongs to a specific
provider and scope, shown as a tag next to its name: **Global** applies to every
project for that provider, **Project** is saved in the selected project's provider
configuration, and **Local project** applies only to the selected project in your
personal Claude configuration. Filters can narrow the list by provider and scope.
**Add MCP server** starts with the Global scope. Choose provider and scope, then paste
an `mcpServers` block or a named server object. The project path appears only for
project scopes. Saving adds configuration; Refresh checks available status. Credentials saved by one provider are not evidence that another
provider is signed in; complete that provider's authorization when needed.

Use a connection's action menu to **Enable** a disabled server or **Disable** an
enabled server for Codex, OpenCode or Claude Code. Codex and OpenCode changes apply
to that exact provider, scope and configuration file. Claude Code changes apply to
every scope with that server name in the selected project. Cursor and Claude Desktop
connections require their own client controls and do not support this action here.
A disabled connection stays
listed so it can be enabled again. **Disabled** describes saved configuration,
not connection health. Start a new conversation in the provider to load the changed
tool configuration; an existing running conversation can retain its current tools.
If saving fails, the row retains its last confirmed state. Refresh and inspect the
configuration before retrying an uncertain write.

For enabled HTTP/SSE connections managed by Claude Code, Codex, Cursor or OpenCode, choose
**Sign in** on the row and complete the authorization in your browser. bycoda runs
the provider's own CLI and refreshes the list after it finishes. Keep the app open
while authorization is pending. For a connection already reported as Connected or
Signed in, the row's action menu offers **Sign in again**. If the provider's CLI is
not installed, the page says so instead of starting a sign-in.

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
Some MCP services use API keys or environment variables instead
of OAuth; follow the service's setup instructions in the owning provider's config.
The **Connection details** disclosure identifies that config file.

Adding a Cursor, Claude Desktop or OpenCode server keeps unrelated JSON/JSONC
settings, comments and property order. Existing symbolic links continue to point to the
edited target. If the configuration is invalid, contains duplicate keys or changes
while saving, the operation stops so you can inspect the file before retrying.
An uncertain native replacement reports its retained recovery files; inspect the
configuration before submitting the same change again.

**External MCP access** is separate: its tokens allow another client to access
bycoda's local Host. Creating one does not sign in to Cloudflare, Hostinger or any
other outgoing MCP service.

MCP operation errors can be dismissed using the close control beside the message. Dismissing an error does not retry the operation.
