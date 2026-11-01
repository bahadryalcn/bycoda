# MCP connections

Open Settings > MCP for the selected local project. Each row belongs to a specific
provider and scope. Credentials saved by one provider are not evidence that another
provider is signed in; complete that provider's authorization when needed.

For enabled HTTP/SSE connections managed by Claude Code, Codex, Cursor or OpenCode, choose
**Sign in** on the row and complete the authorization in your browser. bycoda runs
the provider's own CLI and refreshes the list after it finishes. Keep the app open
while authorization is pending. For a connection already reported as Connected,
the row's action menu offers **Sign in again**.

**Configured** means the configuration was found. It does not confirm a connection
or a successful login. Claude CLI health is matched by name and is not verified
independently for duplicate names in different scopes. Other providers can remain
Configured after a successful login because this list has no independent health
probe for them.

Disabled connections, local/stdio tools and clients without a supported CLI login
do not offer this browser action. Manage Claude Desktop authentication
in that client. Cursor uses its [CLI MCP login](https://cursor.com/docs/cli/mcp).
Some MCP services use API keys or environment variables instead
of OAuth; follow the service's setup instructions in the owning provider's config.
The **Connection details** disclosure identifies that config file.

**External MCP access** is separate: its tokens allow another client to access
bycoda's local Host. Creating one does not sign in to Cloudflare, Hostinger or any
other outgoing MCP service.
