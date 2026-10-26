import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  SessionToolsRelay,
  type SessionToolGroup,
  type SessionToolCapability,
} from "./session-tools-relay";
import { authorizeSocialAcpFrame } from "./social-tools";
import { authorizeRuntimeLogsAcpFrame, type RuntimeLogAccess } from "./runtime-log-tools";
import { authorizeConversationAcpFrame } from "./conversation-tools";
import { join, basename, dirname, extname, isAbsolute } from "node:path";
import { readFile, stat, mkdtemp, mkdir, writeFile, open, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { GenericAcpService } from "./generic-acp";
import type { GenericAcpConfig } from "../src/features/providers/model/genericAcp";
import { saveHostGeneratedImage, deleteHostGeneratedImages } from "./generated-images";
import type { ChildBackend } from "../src/integrations/harness/core/child";
import { isRemoteProvider, type RemoteProvider } from "../src/features/connections/model/protocol";
import { binaryNames, providerLaunch, resolveProvider } from "./process";
import { providerAccountEnvironment } from "./provider-accounts";
import { providerAuthStatus } from "./provider-auth";
import {
  ProviderLines,
  PROVIDER_STDOUT_LINE_BYTES,
  PROVIDER_STDERR_LINE_BYTES,
} from "./provider-lines";

const ALLOWED_EXEC_ARGS: readonly (readonly string[])[] = [
  ["--version"],
  ["--list-models"],
  ["models", "--verbose"],
  ["models", "--json"],
  ["models"],
  ["status", "--json"],
  ["agent", "list"],
];
// OpenCode 2.x runs as a background service; other providers' CLIs may give
// these subcommands unrelated meanings, so they stay OpenCode-only.
const OPENCODE_EXEC_ARGS: readonly (readonly string[])[] = [
  ["service", "status"],
  ["service", "start"],
  ["service", "get", "password"],
];

function execArgsAllowed(provider: RemoteProvider, args: string[]): boolean {
  const matches = (allowed: readonly string[]) =>
    allowed.length === args.length && allowed.every((arg, index) => arg === args[index]);
  return (
    ALLOWED_EXEC_ARGS.some(matches) ||
    (provider === "opencode" && OPENCODE_EXEC_ARGS.some(matches)) ||
    (provider === "grok" &&
      args.length === 4 &&
      args[0] === "--no-auto-update" &&
      args[1] === "sessions" &&
      args[2] === "delete" &&
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args[3]))
  );
}

function loopbackUrl(value: unknown): string {
  const url = new URL(String(value));
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("OpenCode HTTP is limited to localhost");
  return url.href;
}

/** Native process implementation for the headless execution proof. */
const expandHome = (path: string) =>
  path === "~" || /^~[\\/]/.test(path) ? join(homedir(), path.slice(1)) : path;

/** A configured provider binary: absolute, existing and launchable. Paths that arrive from a
 * client must also be named like the provider, as the desktop requires. */
async function configuredBinary(
  provider: RemoteProvider,
  value: string,
  requireProviderName: boolean,
): Promise<string> {
  const path = expandHome(value.trim());
  if (!path || !isAbsolute(path))
    throw new Error(`Configured ${provider} binary must be an absolute path`);
  if (!(await stat(path).catch(() => undefined))?.isFile())
    throw new Error(`Configured ${provider} binary was not found: ${path}`);
  const windows = process.platform === "win32";
  // Windows matches the file stem, like the desktop (agy_acp_server.par, agy.exe).
  const name = windows ? basename(path, extname(path)) : basename(path);
  if (
    requireProviderName &&
    provider !== "acp" &&
    !binaryNames[provider].some((expected) =>
      windows ? expected.toLowerCase() === name.toLowerCase() : expected === name,
    )
  )
    throw new Error(
      `Configured ${provider} binary must be named ${binaryNames[provider].join(" or ")}`,
    );
  await providerLaunch(path, []);
  return path;
}

/** Spawn reports a missing cwd as the executable being missing; name the folder instead. */
async function workingDirectory(value: string): Promise<string> {
  const cwd = expandHome(value);
  if (!(await stat(cwd).catch(() => undefined))?.isDirectory())
    throw new Error(`Working directory does not exist on this host: ${cwd}`);
  return cwd;
}

/** Host-owned provider binary overrides from `<host dir>/provider-binaries.json`. */
export async function readProviderBinaryOverrides(
  directory: string,
): Promise<Partial<Record<RemoteProvider, string>>> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(directory, "provider-binaries.json"), "utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([provider, path]) =>
          isRemoteProvider(provider) && typeof path === "string" && path.trim().length > 0,
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.error("Ignoring invalid provider-binaries.json:", error);
    return {};
  }
}

type PreparedTool = { env: NodeJS.ProcessEnv; mcpUrl?: string };
type ToolPreparation = {
  live: boolean;
  owner?: object;
  groups: Map<SessionToolGroup, Promise<PreparedTool | undefined>>;
  capabilities: Set<SessionToolCapability>;
  expiry?: ReturnType<typeof setTimeout>;
};

export class HostChildBackend implements ChildBackend {
  private readonly toolRelay = new SessionToolsRelay();
  private readonly preparedTools = new Map<string, ToolPreparation>();
  private readonly activeTools = new Map<string, ToolPreparation>();
  private readonly socialEnvironments = new Map<string, NodeJS.ProcessEnv>();
  private readonly runtimeLogEnvironments = new Map<string, NodeJS.ProcessEnv>();
  private readonly conversationEnvironments = new Map<string, NodeJS.ProcessEnv>();
  private conversationAccess?: { service: RuntimeLogAccess; endpoint: string };
  setConversationAccess(service: RuntimeLogAccess, endpoint: string): void {
    this.conversationAccess = { service, endpoint };
  }
  private runtimeLogAccess?: { service: RuntimeLogAccess; endpoint: string };
  setRuntimeLogAccess(service: RuntimeLogAccess, endpoint: string): void {
    this.runtimeLogAccess = { service, endpoint };
  }
  private socialAccess?: { service: import("./social").SocialService; endpoint: string };
  setSocialAccess(service: import("./social").SocialService, endpoint: string): void {
    this.socialAccess = { service, endpoint };
  }
  private genericAcp?: GenericAcpService;
  setGenericAcpService(service: GenericAcpService): void {
    this.genericAcp = service;
  }
  private events = new EventEmitter();
  private children = new Map<string, ChildProcessWithoutNullStreams>();
  private starts = new Map<string, object>();
  private startWork = new Set<Promise<number>>();
  private streams = new Map<string, AbortController>();
  private closing = false;
  private closePromise?: Promise<void>;

  constructor(
    private readonly binaries: Partial<Record<RemoteProvider, string>> = {},
    private readonly artifactDirectory = join(homedir(), ".bycoda-host", "attachments"),
  ) {
    this.events.setMaxListeners(0);
  }

  async resolve(provider: RemoteProvider): Promise<string> {
    const configured = this.binaries[provider];
    if (configured) return configuredBinary(provider, configured, false);
    return resolveProvider(provider);
  }

  async listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
    this.events.on(event, handler);
    return () => {
      this.events.off(event, handler);
    };
  }

  private emit(event: string, payload: unknown): void {
    this.events.emit(event, { payload });
  }

  async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const id = String(args.sessionId ?? "");
    if (command === "harness_auth_status") {
      const provider = args.provider;
      if (provider !== "claude" && provider !== "codex") return "unknown" as T;
      return (await providerAuthStatus(
        provider,
        await this.resolve(provider),
        typeof args.accountId === "string" ? args.accountId : undefined,
      )) as T;
    }
    const toolGroup =
      command === "harness_conversation_tools_bridge"
        ? "conversation"
        : command === "harness_runtime_logs_bridge"
          ? "runtime-logs"
          : command === "harness_social_bridge"
            ? "social"
            : undefined;
    if (toolGroup) {
      const tools = this.preparation(id);
      const tool = await this.prepareTool(id, tools, toolGroup);
      return (
        tool
          ? {
              command: process.execPath,
              args: [process.argv[1]],
              ...(tool.mcpUrl ? { mcpUrl: tool.mcpUrl } : {}),
            }
          : null
      ) as T;
    }
    if (command.startsWith("generic_acp_")) {
      const service = this.genericAcp;
      if (!service) throw new Error("Generic ACP management is unavailable on this host");
      switch (command) {
        case "generic_acp_list":
          return (await service.list()) as T;
        case "generic_acp_save":
          await service.save(args.config as GenericAcpConfig);
          return undefined as T;
        case "generic_acp_remove":
          await service.remove(String(args.id));
          return undefined as T;
        case "generic_acp_registry":
          return (await service.registry(args.refresh === true)) as T;
        case "generic_acp_install":
          await service.install(String(args.id), String(args.version));
          return undefined as T;
        case "generic_acp_cancel_install":
          service.cancelInstall(String(args.id));
          return undefined as T;
        default:
          throw new Error("Unknown generic ACP command");
      }
    }
    if (command.startsWith("harness_resolve_")) {
      const configured = command === "harness_resolve_configured";
      const provider = configured
        ? String(args.provider)
        : command.slice("harness_resolve_".length);
      if (!isRemoteProvider(provider)) throw new Error(`Unsupported provider: ${provider}`);
      const path = configured
        ? await configuredBinary(provider, String(args.binaryPath ?? ""), true)
        : await this.resolve(provider);
      const transport = /^(agy|agy\.exe|agy\.cmd)$/i.test(basename(path)) ? "stream-json" : "acp";
      return {
        path,
        ...(provider === "antigravity"
          ? {
              transport,
              args: transport === "acp" && process.platform === "linux" ? ["--uid="] : [],
            }
          : {}),
      } as T;
    }
    switch (command) {
      case "harness_prepare_text_workspace": {
        if (typeof args.content !== "string" || args.content.length > 20_000)
          throw new Error("Invalid text agent profile");
        const cwd = await mkdtemp(join(tmpdir(), "bycoda-antigravity-text-"));
        const profile = join(cwd, ".agents", "agents");
        await mkdir(profile, { recursive: true });
        await writeFile(join(profile, "bycoda-text.md"), args.content, "utf8");
        return { cwd, logPath: join(cwd, "agent.log") } as T;
      }
      case "harness_save_generated_image":
        return (await saveHostGeneratedImage(this.artifactDirectory, {
          data: String(args.data),
          name: String(args.name),
        })) as T;
      case "harness_delete_generated_images":
        await deleteHostGeneratedImages(this.artifactDirectory, args.paths as string[]);
        return undefined as T;
      case "harness_exec": {
        const provider = args.binaryProvider;
        if (!isRemoteProvider(provider)) throw new Error("Unsupported headless catalog command");
        const commandPath = await this.resolve(provider);
        if (
          args.command !== commandPath ||
          !Array.isArray(args.args) ||
          !args.args.every((arg) => typeof arg === "string") ||
          !execArgsAllowed(provider, args.args as string[])
        )
          throw new Error("Unsupported headless catalog command");
        const launch = await providerLaunch(commandPath, args.args as string[]);
        const { stdout } = await exec(launch.command, launch.args, {
          cwd: typeof args.cwd === "string" ? args.cwd : undefined,
          timeout: 10_000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
        });
        return stdout as T;
      }
      case "harness_free_port": {
        const server = createServer();
        try {
          return await new Promise<T>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
              const address = server.address();
              if (!address || typeof address === "string")
                reject(new Error("Could not reserve a local port"));
              else resolve(address.port as T);
            });
          });
        } finally {
          server.close();
        }
      }
      case "harness_http": {
        const url = loopbackUrl(args.url);
        const response = await fetch(url, {
          method: String(args.method),
          headers: args.headers as Record<string, string> | undefined,
          body: args.body as string | undefined,
          redirect: "error",
          signal: AbortSignal.timeout(
            typeof args.timeoutMs === "number" ? Math.max(1, args.timeoutMs) : 30_000,
          ),
        });
        return { status: response.status, body: await response.text() } as T;
      }
      case "harness_sse_open": {
        const url = loopbackUrl(args.url);
        this.stopStream(id);
        const controller = new AbortController();
        this.streams.set(id, controller);
        void this.readStream(
          id,
          url,
          args.headers as Record<string, string> | undefined,
          controller,
        );
        return undefined as T;
      }
      case "harness_sse_close":
        this.stopStream(id);
        return undefined as T;
      case "harness_read_task_output": {
        const path = String(args.path ?? "");
        const taskId = String(args.taskId ?? "");
        if (
          !/^[a-zA-Z0-9_-]+$/.test(taskId) ||
          !isAbsolute(path) ||
          basename(path) !== `${taskId}.output` ||
          basename(dirname(path)) !== "tasks"
        )
          throw new Error("Invalid task output path");
        const resolved = await realpath(path);
        // Shell output is a regular task file, never a link to unrelated data.
        if (basename(resolved) !== `${taskId}.output` || basename(dirname(resolved)) !== "tasks")
          throw new Error("Invalid task output target");
        const file = await open(resolved, "r");
        try {
          const info = await file.stat();
          if (!info.isFile()) throw new Error("Not a task output file");
          const size = Math.min(info.size, 32 * 1024);
          const bytes = Buffer.alloc(size);
          const { bytesRead } = await file.read(bytes, 0, size, Math.max(0, info.size - size));
          return {
            text: bytes.subarray(0, bytesRead).toString("utf8"),
            truncated: info.size > size,
          } as T;
        } finally {
          await file.close();
        }
      }
      case "harness_read_text_file": {
        const path = String(args.path ?? "");
        const info = await stat(path);
        if (!info.isFile() || info.size > 8 * 1024 * 1024)
          throw new Error("File is not a readable text file of at most 8 MiB");
        const bytes = await readFile(path);
        if (bytes.includes(0)) throw new Error("Binary file is not readable as text");
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes) as T;
      }
      case "harness_spawn":
        return (await this.start(id, args)) as T;
      case "harness_write": {
        const child = this.children.get(id);
        if (!child || child.stdin.destroyed) throw new Error("Provider process is not running");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(
              new Error(
                `Provider stdin write timed out (session ${id}, pid ${child.pid}, ${Buffer.byteLength(String(args.line))} bytes)`,
              ),
            );
            // Retire only this generation; a replacement must never be killed.
            if (this.children.get(id) === child) void this.kill(id);
          }, 12_000);
          child.stdin.write(
            `${authorizeConversationAcpFrame(
              authorizeRuntimeLogsAcpFrame(
                authorizeSocialAcpFrame(String(args.line), this.socialEnvironments.get(id) ?? {}),
                this.runtimeLogEnvironments.get(id) ?? {},
              ),
              this.conversationEnvironments.get(id) ?? {},
            )}\n`,
            (error) => {
              clearTimeout(timer);
              if (error) reject(error);
              else resolve();
            },
          );
        });
        return undefined as T;
      }
      case "harness_kill":
        await this.kill(id);
        return undefined as T;
      case "harness_kill_all":
        await this.close();
        return undefined as T;
      default:
        throw new Error(`Unsupported headless process operation: ${command}`);
    }
  }

  private stopStream(id: string): void {
    this.streams.get(id)?.abort();
    this.streams.delete(id);
  }

  private async readStream(
    id: string,
    url: string,
    headers: Record<string, string> | undefined,
    controller: AbortController,
  ): Promise<void> {
    let error: string | undefined;
    try {
      const response = await fetch(url, {
        headers: { Accept: "text/event-stream", ...headers },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error(`OpenCode event stream returned HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let data: string[] = [];
      let dataLength = 0;
      while (!controller.signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        if (buffer.length > 8 * 1024 * 1024)
          throw new Error("OpenCode event stream frame is too large");
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (!line) {
            if (data.length)
              this.emit("harness-sse", {
                sessionId: id,
                data: data.join("\n"),
              });
            data = [];
            dataLength = 0;
          } else if (line.startsWith("data:")) {
            const piece = line.slice(5).replace(/^ /, "");
            dataLength += piece.length;
            if (dataLength > 8 * 1024 * 1024)
              throw new Error("OpenCode event stream frame is too large");
            data.push(piece);
          }
        }
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      if (this.streams.get(id) === controller) this.streams.delete(id);
      this.emit("harness-sse-end", { sessionId: id, error });
    }
  }

  private start(id: string, args: Record<string, unknown>): Promise<number> {
    const work = this.startOwned(id, args);
    this.startWork.add(work);
    void work.finally(() => this.startWork.delete(work)).catch(() => undefined);
    return work;
  }

  private async startOwned(id: string, args: Record<string, unknown>): Promise<number> {
    if (this.closing) throw new Error("Host is stopping");
    const attempt = {};
    let tools: ToolPreparation | undefined;
    let published = false;
    let ownedChild: ChildProcessWithoutNullStreams | undefined;
    this.starts.set(id, attempt);
    const check = () => {
      if (this.closing) throw new ProviderStartupCancelled("Host is stopping");
      if (this.starts.get(id) !== attempt)
        throw new ProviderStartupCancelled("Provider startup cancelled");
    };
    try {
      let genericEnv: Record<string, string> = {};
      if (args.genericAcpId) {
        if (!this.genericAcp) throw new Error("Generic ACP management is unavailable");
        const config = await this.genericAcp.get(String(args.genericAcpId));
        check();
        args = { ...args, command: config.command, args: config.args };
        genericEnv = config.env ?? {};
      }
      await this.killCurrent(id);
      check();
      tools = this.preparation(id, attempt);
      const account = await providerAccountEnvironment(
        args.account as { provider?: string; id?: string } | undefined,
      );
      check();
      const cwd = await workingDirectory(String(args.cwd));
      check();
      const launch = await providerLaunch(String(args.command), args.args as string[]);
      check();
      const env: NodeJS.ProcessEnv = { ...process.env, ...genericEnv, ...account?.set };
      for (const key of Object.keys(env))
        if (
          ["BYCODA_SOCIAL_", "BYCODA_RUNTIME_LOGS_", "BYCODA_CONVERSATION_"].some((prefix) =>
            key.startsWith(prefix),
          )
        )
          delete env[key];
      for (const group of ["social", "conversation", "runtime-logs"] as const) {
        const tool = await this.prepareTool(id, tools, group, check);
        check();
        Object.assign(env, tool?.env);
      }
      for (const key of account?.remove ?? []) delete env[key];
      check();
      // Preparation is local to this attempt. A cancelled older grant must not
      // replace the authority used by a newer child under the same session ID.
      for (const [prefix, target] of [
        ["BYCODA_SOCIAL_", this.socialEnvironments],
        ["BYCODA_RUNTIME_LOGS_", this.runtimeLogEnvironments],
        ["BYCODA_CONVERSATION_", this.conversationEnvironments],
      ] as const) {
        const scoped = Object.fromEntries(
          Object.entries(env).filter(([key]) => key.startsWith(prefix)),
        );
        target.delete(id);
        if (Object.keys(scoped).length) target.set(id, scoped);
      }
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./provider-guard.mjs", import.meta.url)),
          launch.command,
          ...launch.args,
        ],
        {
          cwd,
          stdio: ["pipe", "pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
          windowsHide: true,
          env: { ...env, BYCODA_HOST: "1" },
        },
      );
      ownedChild = child;
      this.children.set(id, child);
      this.activeTools.set(id, tools);
      if (this.preparedTools.get(id) === tools) this.preparedTools.delete(id);
      child.stdin.on("error", () => {
        /* write callbacks report failures */
      });
      let exitReason: string | undefined;
      const overflow = (reason: string) => {
        if (exitReason) return;
        exitReason = reason;
        void this.kill(id);
      };
      this.lines(child, id, "stdout", overflow);
      this.lines(child, id, "stderr", overflow);
      child.on("close", (code) => {
        if (this.children.get(id) === child) {
          this.children.delete(id);
          this.releaseActiveTools(id);
        }
        this.emit("harness-exit", {
          sessionId: id,
          code,
          pid: child.pid,
          ...(exitReason ? { reason: exitReason } : {}),
        });
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      check();
      published = true;
      return child.pid!;
    } finally {
      if (!published && tools) {
        if (this.preparedTools.get(id) === tools) this.preparedTools.delete(id);
        this.retireTools(tools);
        if (ownedChild && this.children.get(id) === ownedChild) await this.killCurrent(id);
      }
      if (this.starts.get(id) === attempt) this.starts.delete(id);
    }
  }

  private retireTools(tools: ToolPreparation): void {
    tools.live = false;
    clearTimeout(tools.expiry);
    for (const capability of tools.capabilities) capability.dispose();
    tools.capabilities.clear();
  }

  private releaseActiveTools(id: string): void {
    const tools = this.activeTools.get(id);
    if (tools) this.retireTools(tools);
    this.activeTools.delete(id);
    this.socialEnvironments.delete(id);
    this.runtimeLogEnvironments.delete(id);
    this.conversationEnvironments.delete(id);
  }

  private preparation(id: string, owner?: object): ToolPreparation {
    if (this.closing) throw new ProviderStartupCancelled("Host is stopping");
    let tools = this.preparedTools.get(id);
    if (tools && owner && tools.owner && tools.owner !== owner) {
      this.retireTools(tools);
      this.preparedTools.delete(id);
      tools = undefined;
    }
    if (!tools) {
      if (this.preparedTools.size >= 512)
        throw new Error("Session tool preparation capacity reached.");
      tools = { live: true, groups: new Map(), capabilities: new Set() };
      this.preparedTools.set(id, tools);
      const current = tools;
      tools.expiry = setTimeout(() => {
        if (this.preparedTools.get(id) === current && !current.owner) {
          this.preparedTools.delete(id);
          this.retireTools(current);
        }
      }, 60_000);
      tools.expiry.unref();
    }
    if (owner) {
      tools.owner = owner;
      clearTimeout(tools.expiry);
    }
    return tools;
  }

  private async prepareTool(
    id: string,
    tools: ToolPreparation,
    group: SessionToolGroup,
    startupCheck = () => {},
  ): Promise<PreparedTool | undefined> {
    const check = () => {
      startupCheck();
      if (this.closing || !tools.live)
        throw new ProviderStartupCancelled("Provider startup cancelled");
    };
    const existing = tools.groups.get(group);
    if (existing) {
      const value = await existing;
      check();
      return value;
    }
    const work = (async (): Promise<PreparedTool | undefined> => {
      const access =
        group === "social"
          ? this.socialAccess
          : group === "conversation"
            ? this.conversationAccess
            : this.runtimeLogAccess;
      if (!access) return undefined;
      const sessionId = id.replace(/#\d+$/, "");
      const prefix =
        group === "runtime-logs" ? "BYCODA_RUNTIME_LOGS" : `BYCODA_${group.toUpperCase()}`;
      try {
        if (group === "social") {
          const social = this.socialAccess!.service;
          const remote = await social.remoteAccess?.(sessionId);
          check();
          if (remote)
            return {
              env: {
                BYCODA_SOCIAL_ENDPOINT: remote.endpoint,
                BYCODA_SOCIAL_TOKEN: remote.token,
                BYCODA_SOCIAL_ENVIRONMENT: remote.environmentId,
              },
            };
          if (await social.isDelegated?.()) return undefined;
          check();
        }
        const grant = await access.service.issueSessionGrant(sessionId);
        check();
        const capability = await this.toolRelay.create({
          group,
          upstream: access.endpoint,
          grant,
          renew: async (scope) => {
            if (this.closing || !tools.live) throw new Error("Session tool capability retired.");
            const localSocial = async () => {
              if (
                group === "social" &&
                ((await this.socialAccess!.service.isDelegated?.()) ||
                  (await this.socialAccess!.service.remoteAccess?.(sessionId)))
              )
                throw new Error("Social execution authority moved; reconnect explicitly.");
            };
            await localSocial();
            const fresh = await access.service.issueSessionGrant(sessionId, undefined, scope);
            await localSocial();
            if (this.closing || !tools.live) throw new Error("Session tool capability retired.");
            return fresh;
          },
        });
        if (!tools.live || this.closing) capability.dispose();
        tools.capabilities.add(capability);
        check();
        return {
          mcpUrl: `${capability.endpoint}/mcp/${group}`,
          env: {
            [`${prefix}_ENDPOINT`]: capability.endpoint,
            [`${prefix}_TOKEN`]: capability.token,
            [`${prefix}_ENVIRONMENT`]: grant.scope.environmentId,
          },
        };
      } catch (error) {
        check();
        // Helpers without an authoritative session must not inherit any access.
        if (error instanceof ProviderStartupCancelled) throw error;
        return undefined;
      }
    })();
    tools.groups.set(group, work);
    void work.then(
      (tool) => {
        if (!tool && tools.groups.get(group) === work) tools.groups.delete(group);
      },
      () => {
        if (tools.groups.get(group) === work) tools.groups.delete(group);
      },
    );
    return work;
  }

  private lines(
    child: ChildProcessWithoutNullStreams,
    id: string,
    stream: "stdout" | "stderr",
    onOverflow: (reason: string) => void,
  ): void {
    const maxBytes = stream === "stdout" ? PROVIDER_STDOUT_LINE_BYTES : PROVIDER_STDERR_LINE_BYTES;
    const tokens = [
      this.socialEnvironments.get(id)?.BYCODA_SOCIAL_TOKEN,
      this.runtimeLogEnvironments.get(id)?.BYCODA_RUNTIME_LOGS_TOKEN,
      this.conversationEnvironments.get(id)?.BYCODA_CONVERSATION_TOKEN,
    ].filter((token): token is string => !!token);
    const lines = new ProviderLines(
      maxBytes,
      (line) => {
        for (const token of tokens) line = line.replaceAll(token, "[session credential redacted]");
        this.emit(`harness-${stream}`, {
          sessionId: id,
          line,
        });
      },
      () =>
        onOverflow(
          `Provider ${stream} message exceeded the ${maxBytes / 1024 / 1024} MiB limit; bycoda host stopped the process.`,
        ),
    );
    child[stream].setEncoding("utf8");
    child[stream].on("data", (data: string) => lines.push(data));
    child[stream].on("end", () => lines.end());
  }

  private signal(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
    try {
      if (process.platform === "win32") child.kill(signal);
      else if (child.pid) process.kill(-child.pid, signal);
    } catch {
      /* already exited */
    }
  }

  async kill(id: string): Promise<void> {
    this.starts.delete(id);
    const prepared = this.preparedTools.get(id);
    if (prepared) this.retireTools(prepared);
    this.preparedTools.delete(id);
    await this.killCurrent(id);
  }

  private async killCurrent(id: string): Promise<void> {
    this.releaseActiveTools(id);
    const child = this.children.get(id);
    if (!child) return;
    this.children.delete(id);
    if (process.platform === "win32") {
      // Kill descendants while the leader still exists. Closing stdin first
      // can let the leader exit, making its remaining children untraceable.
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          await exec(
            join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, timeout: 10_000 },
          );
        } catch {
          child.kill();
        }
      }
      child.stdin.destroy();
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return;
    }
    child.stdin.destroy();
    this.signal(child, "SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.signal(child, "SIGKILL");
        resolve();
        // The guard needs a full second to escalate against the provider's
        // separate process group before we may kill the guard itself.
      }, 3_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.starts.clear();
    for (const tools of this.preparedTools.values()) this.retireTools(tools);
    this.preparedTools.clear();
    for (const id of this.activeTools.keys()) this.releaseActiveTools(id);
    for (const id of this.streams.keys()) this.stopStream(id);
    const work = [
      ...[...this.children.keys()].map(async (id) => this.kill(id)),
      ...this.startWork,
      this.toolRelay.close(),
    ];
    this.closePromise = Promise.allSettled(work).then((results) => {
      const errors = results.flatMap((result) =>
        result.status === "rejected" && !(result.reason instanceof ProviderStartupCancelled)
          ? [result.reason]
          : [],
      );
      if (errors.length)
        throw new AggregateError(errors, "Provider shutdown could not drain every operation.");
    });
    return this.closePromise;
  }
}

class ProviderStartupCancelled extends Error {}
