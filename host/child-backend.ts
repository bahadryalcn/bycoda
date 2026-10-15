import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { authorizeSocialAcpFrame } from "./social-tools";
import { authorizeRuntimeLogsAcpFrame, type RuntimeLogAccess } from "./runtime-log-tools";
import { authorizeConversationAcpFrame } from "./conversation-tools";
import { join, basename, dirname, isAbsolute } from "node:path";
import { readFile, stat, mkdtemp, mkdir, writeFile, open, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { GenericAcpService } from "./generic-acp";
import type { GenericAcpConfig } from "../src/features/providers/model/genericAcp";
import { saveHostGeneratedImage, deleteHostGeneratedImages } from "./generated-images";
import type { ChildBackend } from "../src/integrations/harness/core/child";
import { isRemoteProvider, type RemoteProvider } from "../src/features/connections/model/protocol";
import { providerLaunch, resolveProvider } from "./process";
import { providerAccountEnvironment } from "./provider-accounts";
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
export class HostChildBackend implements ChildBackend {
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
  private streams = new Map<string, AbortController>();
  private closing = false;

  constructor(
    private readonly binaries: Partial<Record<RemoteProvider, string>> = {},
    private readonly artifactDirectory = join(homedir(), ".bycoda-host", "attachments"),
  ) {
    this.events.setMaxListeners(0);
  }

  async resolve(provider: RemoteProvider): Promise<string> {
    if (this.binaries[provider]) return this.binaries[provider]!;
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
    if (command === "harness_conversation_tools_bridge") {
      return (
        this.conversationAccess?.service.hasSession(id.replace(/#\d+$/, ""))
          ? { command: process.execPath, args: [process.argv[1]] }
          : null
      ) as T;
    }
    if (command === "harness_runtime_logs_bridge") {
      return (
        this.runtimeLogAccess?.service.hasSession(id.replace(/#\d+$/, ""))
          ? { command: process.execPath, args: [process.argv[1]] }
          : null
      ) as T;
    }
    if (command === "harness_social_bridge") {
      if (!this.socialAccess) return null as T;
      try {
        this.socialAccess.service.store.session(id);
        return { command: process.execPath, args: [process.argv[1]] } as T;
      } catch {
        return null as T;
      }
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
      const provider = command.slice("harness_resolve_".length);
      if (!isRemoteProvider(provider)) throw new Error(`Unsupported provider: ${provider}`);
      const path = await this.resolve(provider);
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

  private async start(id: string, args: Record<string, unknown>): Promise<number> {
    if (this.closing) throw new Error("Host is stopping");
    let genericEnv: Record<string, string> = {};
    if (args.genericAcpId) {
      if (!this.genericAcp) throw new Error("Generic ACP management is unavailable");
      const config = await this.genericAcp.get(String(args.genericAcpId));
      args = { ...args, command: config.command, args: config.args };
      genericEnv = config.env ?? {};
    }
    await this.kill(id);
    if (this.closing) throw new Error("Host is stopping");
    const account = await providerAccountEnvironment(
      args.account as { provider?: string; id?: string } | undefined,
    );
    const launch = await providerLaunch(String(args.command), args.args as string[]);
    if (this.closing) throw new Error("Host is stopping");
    const env = await this.runtimeLogEnvironment(
      id,
      await this.socialEnvironment(id, { ...genericEnv, ...account?.set }),
    );
    for (const key of account?.remove ?? []) delete env[key];
    if (this.closing) throw new Error("Host is stopping");
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./provider-guard.mjs", import.meta.url)),
        launch.command,
        ...launch.args,
      ],
      {
        cwd: String(args.cwd),
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
        env: { ...env, BYCODA_HOST: "1" },
      },
    );
    this.children.set(id, child);
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
      if (this.children.get(id) === child) this.children.delete(id);
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
    return child.pid!;
  }

  private async socialEnvironment(
    id: string,
    overrides: NodeJS.ProcessEnv = {},
  ): Promise<NodeJS.ProcessEnv> {
    this.socialEnvironments.delete(id);
    const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
    for (const key of Object.keys(env)) if (key.startsWith("BYCODA_SOCIAL_")) delete env[key];
    if (!this.socialAccess) return env;
    try {
      const sessionId = id.replace(/#\d+$/, "");
      const grant = (await this.socialAccess.service.remoteAccess?.(sessionId)) ?? {
        ...this.socialAccess.service.issueSessionGrant(sessionId),
        endpoint: this.socialAccess.endpoint,
        environmentId: this.socialAccess.service.store.environmentId,
      };
      env.BYCODA_SOCIAL_ENDPOINT = grant.endpoint;
      env.BYCODA_SOCIAL_TOKEN = grant.token;
      env.BYCODA_SOCIAL_ENVIRONMENT = grant.environmentId;
      this.socialEnvironments.set(id, {
        BYCODA_SOCIAL_TOKEN: grant.token,
        BYCODA_SOCIAL_ENDPOINT: grant.endpoint,
        BYCODA_SOCIAL_ENVIRONMENT: grant.environmentId,
      });
    } catch {
      /* Isolated helper/catalog children do not receive session access. */
    }
    return env;
  }

  private async runtimeLogEnvironment(
    id: string,
    env: NodeJS.ProcessEnv,
  ): Promise<NodeJS.ProcessEnv> {
    this.conversationEnvironments.delete(id);
    for (const key of Object.keys(env)) if (key.startsWith("BYCODA_CONVERSATION_")) delete env[key];
    if (this.conversationAccess) {
      try {
        const grant = this.conversationAccess.service.issueSessionGrant(id.replace(/#\d+$/, ""));
        const scoped = {
          BYCODA_CONVERSATION_TOKEN: grant.token,
          BYCODA_CONVERSATION_ENDPOINT: this.conversationAccess.endpoint,
          BYCODA_CONVERSATION_ENVIRONMENT: this.conversationAccess.service.environmentId,
        };
        Object.assign(env, scoped);
        this.conversationEnvironments.set(id, scoped);
      } catch {
        /* Helpers have no session authority. */
      }
    }
    this.runtimeLogEnvironments.delete(id);
    for (const key of Object.keys(env)) if (key.startsWith("BYCODA_RUNTIME_LOGS_")) delete env[key];
    if (!this.runtimeLogAccess) return env;
    try {
      const grant = this.runtimeLogAccess.service.issueSessionGrant(id.replace(/#\d+$/, ""));
      const scoped = {
        BYCODA_RUNTIME_LOGS_TOKEN: grant.token,
        BYCODA_RUNTIME_LOGS_ENDPOINT: this.runtimeLogAccess.endpoint,
        BYCODA_RUNTIME_LOGS_ENVIRONMENT: this.runtimeLogAccess.service.environmentId,
      };
      Object.assign(env, scoped);
      this.runtimeLogEnvironments.set(id, scoped);
    } catch {
      /* Isolated title/catalog helpers have no authoritative session. */
    }
    return env;
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

  async close(): Promise<void> {
    this.closing = true;
    for (const id of this.streams.keys()) this.stopStream(id);
    await Promise.all([...this.children.keys()].map((id) => this.kill(id)));
  }
}
