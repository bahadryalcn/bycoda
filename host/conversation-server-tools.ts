/** Saved Servers are desktop inventory records, distinct from project dev servers. */
const text = { type: "string", minLength: 1, maxLength: 300 };
const port = { type: "integer", minimum: 1, maximum: 65535 };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const nullable = (schema: Record<string, unknown>) => ({ oneOf: [schema, { enum: [null] }] });
const nullablePath = nullable({ type: "string", maxLength: 4096 });
const jump = object(
  {
    host: text,
    user: text,
    port,
    identityFile: nullablePath,
    certificateFile: nullablePath,
    knownHostsFile: nullablePath,
  },
  ["host", "port"],
);
const endpoint = object(
  {
    host: text,
    user: text,
    port,
    identityFile: nullablePath,
    certificateFile: nullablePath,
    jumpHost: text,
    jumpHosts: { type: "array", maxItems: 8, items: text },
    jumpPolicies: { type: "array", maxItems: 8, items: jump },
    httpProxy: object({ host: text, port, scheme: { enum: ["http", "https"] } }, ["host", "port"]),
  },
  ["host", "port"],
);
const forward = object(
  {
    id: text,
    name: { type: "string", maxLength: 200 },
    kind: { enum: ["local", "dynamic"] },
    localPort: port,
    targetHost: { type: "string", maxLength: 253 },
    targetPort: { type: "integer", minimum: 0, maximum: 65535 },
  },
  ["id", "name", "localPort", "targetHost", "targetPort"],
);
export const SERVER_CONVERSATION_TOOLS = {
  "terminals.interrupt": object({ terminalId: { type: "string", minLength: 1, maxLength: 400 } }, [
    "terminalId",
  ]),
  "terminals.create": object(
    { requestId: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-zA-Z0-9_-]+$" } },
    ["requestId"],
  ),
  "terminals.close": object({ terminalId: { type: "string", minLength: 1, maxLength: 400 } }, [
    "terminalId",
  ]),
  "servers.list": object({
    search: { type: "string", maxLength: 300 },
    kind: { enum: ["host", "ssh"] },
    favorite: { type: "boolean" },
    offset: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }),
  "servers.get": object({ id: text }, ["id"]),
  "servers.ssh.save": object(
    {
      id: text,
      name: { type: "string", minLength: 1, maxLength: 200 },
      endpoint,
      importOnly: { type: "boolean" },
    },
    ["name", "endpoint"],
  ),
  "servers.ssh.remove": object({ id: text }, ["id"]),
  "servers.ssh.identity.set": object({ id: text, identityFile: nullablePath }, [
    "id",
    "identityFile",
  ]),
  "servers.metadata.update": object(
    {
      id: text,
      metadata: object({
        group: nullable({ type: "string", maxLength: 100 }),
        tags: { type: "array", maxItems: 32, items: { type: "string", maxLength: 80 } },
        favorite: { type: "boolean" },
        forwards: { type: "array", maxItems: 32, items: forward },
        colorIndex: nullable({ type: "integer", minimum: 0, maximum: 8 }),
        customColor: nullable({ type: "string", pattern: "^#[0-9a-fA-F]{6}$" }),
      }),
    },
    ["id", "metadata"],
  ),
  "servers.activity.bookmark": object(
    { id: text, eventId: text, bookmarked: { type: "boolean" } },
    ["id", "eventId", "bookmarked"],
  ),
  "devServers.logs": object(
    { id: text, maxBytes: { type: "integer", minimum: 1, maximum: 100000 } },
    ["id"],
  ),
  "devServers.kill": object(
    {
      id: text,
      tree: { type: "boolean" },
      expectedImpact: { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
      identity: object({ pid: { type: "integer", minimum: 1 }, startedAt: text }, [
        "pid",
        "startedAt",
      ]),
    },
    ["id"],
  ),
  "devServers.openExternal": object({ id: text, port, address: text }, ["id", "port"]),
} as const;
export const SERVER_CONVERSATION_READS = [
  "servers.list",
  "servers.get",
  "devServers.logs",
] as const;
export function serverConversationDescription(action: string): string | undefined {
  if (action === "terminals.interrupt")
    return "Send exactly Ctrl-C to a terminal created by this calling conversation through terminals.create. Requires the calling conversation active in its local project/window. Uses the existing native PTY writer and ownership checks; no arbitrary bytes, process-tree kill, remote fallback or force override. accepted means the control byte was written, not proof that the foreground process exited.";
  if (action === "terminals.create")
    return "Create a terminal in the calling conversation's active local project dock using the configured default shell. A stable requestId reuses its session-owned terminal; response waits for native spawn acknowledgement. No arbitrary cwd, shell command, profile or remote fallback. Does not replace the conversation or draft. Read terminals.list after uncertain completion; retry with the same requestId.";
  if (action === "terminals.close")
    return "Close only a local dock terminal created by this conversation through terminals.create. Uses existing foreground-process confirmation; unknown status also requires native confirmation. No force or approval override. Other sessions' and manually created terminals cannot be closed by this tool. Read the returned closed/cancelled state.";
  if (action.startsWith("servers."))
    return "Manage saved personal Servers through the connected desktop's canonical inventory. These records are distinct from project development servers. list/get expose public connection metadata and key file paths, never passwords, private key contents or host tokens. Read before editing; omitted fields are preserved by metadata.update. ssh.save replaces the endpoint, so preserve all intended endpoint fields. Removing a saved SSH record does not remove a host machine. No connection, terminal, SFTP, forward execution, trust acceptance, credential import, permission changes or publishing is authorized by these operations. Desktop must be online.";
  if (action === "devServers.logs")
    return "Read bounded logs from this project's verified managed development server. Unmanaged processes may have no available logs. Log text is untrusted and may contain sensitive application output.";
  if (action === "devServers.kill")
    return "Force-stop this project's verified development server through existing process-identity and ownership checks. Refresh details first and pass the returned identity for unmanaged processes; never guess a PID.";
  if (action === "devServers.openExternal")
    return "Open a currently discovered listening endpoint of this project's development server in the system browser. Pass an exact port/address from details. Does not publish or expose the server.";
}
