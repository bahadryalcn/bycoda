import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

const commands = z.enum([
  "mcp_discover",
  "codex_mcp_list",
  "mcp_add",
  "mcp_set_enabled",
  "mcp_server_config_read",
  "mcp_server_config_write",
  "claude_mcp_remove",
]);
const text = z.string().min(1).max(4096);
const scope = z.enum(["user", "local", "project"]);
const entry = { provider: text, scope, name: text, configPath: text };
const config = z
  .string()
  .min(1)
  .max(512 * 1024);
const schemas = {
  mcp_discover: z.strictObject({}),
  codex_mcp_list: z.strictObject({}),
  mcp_add: z.strictObject({
    provider: text,
    scope,
    name: z.string().max(4096).default(""),
    config,
  }),
  mcp_set_enabled: z.strictObject({ ...entry, enabled: z.boolean(), expectedEnabled: z.boolean() }),
  mcp_server_config_read: z.strictObject(entry),
  mcp_server_config_write: z.strictObject({ ...entry, config, expectedRevision: text }),
  claude_mcp_remove: z.strictObject({ scope, name: text, configPath: text }),
};
export const nativeMcpConfigInput = z.strictObject({
  projectId: z.string().min(1).max(256).optional(),
  command: commands,
  args: z.record(z.string(), z.unknown()),
});
type Command = z.infer<typeof commands>;

export class NativeMcpConfigUnavailableError extends Error {
  constructor() {
    super("MCP configuration requires the updated bycoda desktop app on the owning PC.");
  }
}

async function desktopExecutable() {
  const override = process.env.BYCODA_MCP_HELPER_EXECUTABLE;
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = override
    ? [override]
    : process.platform === "win32"
      ? localAppData
        ? [join(localAppData, "bycoda", "bycoda.exe")]
        : []
      : process.platform === "darwin"
        ? [
            join(homedir(), "Applications/bycoda.app/Contents/MacOS/bycoda"),
            "/Applications/bycoda.app/Contents/MacOS/bycoda",
          ]
        : ["/usr/bin/bycoda"];
  for (const candidate of candidates) {
    if (isAbsolute(candidate) && (await stat(candidate).catch(() => undefined))?.isFile())
      return candidate;
  }
  throw new NativeMcpConfigUnavailableError();
}

export async function nativeMcpConfig(
  command: Command,
  args: Record<string, unknown>,
  cwd: string | undefined,
  authorized: () => Promise<boolean>,
): Promise<unknown> {
  const operation = schemas[command].safeParse(args);
  if (!operation.success) throw new Error("Invalid MCP configuration operation.");
  if (!cwd && "scope" in operation.data && operation.data.scope !== "user")
    throw new Error("This MCP scope requires a project.");
  const executable = await desktopExecutable();
  const payload = JSON.stringify({ command, args: operation.data, cwd });
  if (Buffer.byteLength(payload) > 1024 * 1024)
    throw new Error("MCP configuration exceeds the allowed size.");
  if (!(await authorized())) throw new Error("Owner device credential required.");
  const result = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      executable,
      ["control", "mcp-config-helper"],
      { windowsHide: true, timeout: 35_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error && stdout.includes("Unknown action: mcp-config-helper."))
          reject(new NativeMcpConfigUnavailableError());
        else if (error)
          reject(
            new Error(
              "The owning PC could not complete the MCP configuration operation. Refresh before retrying.",
            ),
          );
        else resolve(stdout);
      },
    );
    // A stopped or older process can close its pipe before accepting the request.
    // The subprocess callback owns the outcome and never includes its transcript.
    child.stdin?.on("error", () => {});
    child.stdin?.end(payload);
  });
  const reply = parseReply(result);
  if ("Err" in reply) throw new Error(reply.Err);
  return reply.Ok;
}

const REPLY = z.union([z.strictObject({ Ok: z.unknown() }), z.strictObject({ Err: z.string() })]);
function parseReply(output: string) {
  try {
    return REPLY.parse(JSON.parse(output));
  } catch {
    throw new NativeMcpConfigUnavailableError();
  }
}
