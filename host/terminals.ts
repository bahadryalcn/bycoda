import { randomUUID } from "node:crypto";
import type {
  HostTerminal,
  HostTerminalList,
  HostTerminalRead,
} from "../src/features/host-tools/terminalTypes";
import { listShellProfiles, type ShellProfiles } from "./shellProfiles";
import { resolveHostWorktreeAsync } from "./git-worktrees";
import { startTerminalProcess, type OwnedTerminalProcess } from "./terminal-process";

export const TERMINAL_OUTPUT_LIMIT = 256 * 1024;
const MAX_TERMINALS = 32;
const MAX_CREATIONS = 256;
type TerminalEntry = {
  value: HostTerminal;
  process?: OwnedTerminalProcess;
  output: string;
  end: number;
  releaseActivity?: () => Promise<void>;
  releasingActivity?: Promise<void>;
};
type Project = { id: string; cwd: string };

/** In-memory ownership only: persisted PIDs never authorize reads or process signals. */
export class HostTerminals {
  private entries = new Map<string, TerminalEntry>();
  private creations = new Map<string, { fingerprint: string; result: Promise<HostTerminal> }>();
  private closed = false;
  private activityGate?: (cwd: string, terminalId: string) => Promise<() => Promise<void>>;
  setActivityGate(gate: (cwd: string, terminalId: string) => Promise<() => Promise<void>>) {
    this.activityGate = gate;
  }
  constructor(
    private readonly launch = startTerminalProcess,
    private readonly profiles: () => ShellProfiles = listShellProfiles,
    private readonly locate = resolveHostWorktreeAsync,
  ) {}

  list(projectId: string): HostTerminalList {
    return {
      terminals: [...this.entries.values()]
        .filter((entry) => entry.value.projectId === projectId)
        .map((entry) => ({ ...entry.value })),
      writable: true,
      profiles: this.profiles().profiles.map(({ id, name }) => ({ id, name })),
    };
  }

  create(
    project: Project,
    params: Record<string, unknown>,
    owner: string,
    authorized: () => boolean | Promise<boolean>,
  ): Promise<HostTerminal> {
    const { requestId, name, profileId } = params;
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId))
      throw new Error("A unique terminal requestId is required");
    if (
      name !== undefined &&
      (typeof name !== "string" ||
        !name.trim() ||
        name.length > 80 ||
        /[\u0000-\u001f\u007f]/.test(name))
    )
      throw new Error("Invalid terminal name");
    if (profileId !== undefined && typeof profileId !== "string")
      throw new Error("Invalid shell profile");
    const key = `${owner}:${project.id}:${requestId}`;
    const fingerprint = JSON.stringify([params.cwd ?? null, name ?? null, profileId ?? null]);
    const existing = this.creations.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error("Terminal requestId was already used for different options");
      return existing.result.then((value) => ({ ...value }));
    }
    if (this.closed) throw new Error("Host terminals are stopping");
    // Retain creation receipts for the host lifetime: eviction could replay an old mutation.
    if (this.creations.size >= MAX_CREATIONS)
      throw new Error("Terminal creation limit reached for this host runtime");
    const result = this.open(project, params, authorized);
    this.creations.set(key, { fingerprint, result });
    return result.then((value) => ({ ...value }));
  }

  private async open(
    project: Project,
    params: Record<string, unknown>,
    authorized: () => boolean | Promise<boolean>,
  ): Promise<HostTerminal> {
    const cwd = await this.locate(project.cwd, params.cwd);
    if (!(await authorized())) throw new Error("Device credential is invalid or revoked");
    if (this.closed) throw new Error("Host terminals are stopping");
    if (this.entries.size >= MAX_TERMINALS)
      throw new Error("Close a terminal before creating another");
    const profiles = this.profiles();
    const profile =
      params.profileId !== undefined
        ? profiles.profiles.find((item) => item.id === params.profileId)
        : (profiles.profiles.find((item) => item.id === profiles.chosenId) ??
          profiles.profiles.find((item) => item.id === profiles.defaultId) ??
          profiles.profiles[0]);
    if (!profile) throw new Error("That shell is not installed on this machine");
    const entry: TerminalEntry = {
      value: {
        id: randomUUID(),
        projectId: project.id,
        name: typeof params.name === "string" ? params.name.trim() : profile.name,
        cwd,
        shell: profile.name,
        transport: "pipe",
        state: "running",
        createdAt: Date.now(),
        exitCode: null,
      },
      output: "",
      end: 0,
    };
    entry.releaseActivity = await this.activityGate?.(cwd, entry.value.id);
    this.entries.set(entry.value.id, entry);
    try {
      if (!(await authorized())) throw new Error("Device credential is invalid or revoked");
      if (this.closed) throw new Error("Host terminals are stopping");
    } catch (error) {
      entry.value.state = "exited";
      await this.releaseActivity(entry);
      throw error;
    }
    try {
      entry.process = this.launch(
        profile,
        cwd,
        (data) => {
          entry.end += data.length;
          entry.output = (entry.output + data).slice(-TERMINAL_OUTPUT_LIMIT);
        },
        (code) => {
          entry.value.state = "exited";
          entry.value.exitCode = code;
          void this.releaseActivity(entry).catch(() => {});
        },
      );
    } catch {
      entry.value.state = "exited";
      await this.releaseActivity(entry);
      throw new Error("Could not start terminal shell");
    }
    return entry.value;
  }

  read(projectId: string, params: Record<string, unknown>): HostTerminalRead {
    const entry = this.owned(projectId, params.id);
    const after = params.after ?? 0;
    const limit = params.limit ?? 32768;
    if (
      typeof after !== "number" ||
      !Number.isSafeInteger(after) ||
      after < 0 ||
      after > entry.end ||
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 65536
    )
      throw new Error("Invalid terminal output range");
    const start = entry.end - entry.output.length;
    const offset = Math.max(start, after);
    const output = entry.output.slice(offset - start, offset - start + limit);
    const cursor = offset + output.length;
    return {
      terminal: { ...entry.value },
      output,
      cursor,
      truncated: after < start,
      hasMore: cursor < entry.end,
    };
  }

  async write(projectId: string, params: Record<string, unknown>) {
    const entry = this.owned(projectId, params.id);
    if (
      typeof params.data !== "string" ||
      !params.data.length ||
      Buffer.byteLength(params.data, "utf8") > 16384
    )
      throw new Error("Terminal input must contain 1 to 16384 UTF-8 bytes");
    if (entry.value.state !== "running" || !entry.process) throw new Error("Terminal has exited");
    await entry.process.write(params.data);
    return { accepted: true as const };
  }

  async interrupt(projectId: string, id: unknown) {
    const entry = this.owned(projectId, id);
    // Anonymous pipes cannot deliver console Ctrl+C reliably on Windows. Stop the owned tree.
    await entry.process?.stop();
    entry.value.state = "exited";
    await this.releaseActivity(entry);
    return { accepted: true as const };
  }

  async remove(projectId: string, id: unknown) {
    const entry = this.owned(projectId, id);
    await entry.process?.stop();
    entry.value.state = "exited";
    await this.releaseActivity(entry);
    this.entries.delete(entry.value.id);
    return { closed: true as const };
  }

  private owned(projectId: string, id: unknown): TerminalEntry {
    const entry = typeof id === "string" ? this.entries.get(id) : undefined;
    if (!entry || entry.value.projectId !== projectId)
      throw new Error("Terminal is unavailable in this project");
    return entry;
  }

  private async releaseActivity(entry: TerminalEntry) {
    if (entry.releasingActivity) return entry.releasingActivity;
    const release = entry.releaseActivity;
    if (!release) return;
    const pending = release().then(() => {
      if (entry.releaseActivity === release) entry.releaseActivity = undefined;
    });
    entry.releasingActivity = pending;
    try {
      await pending;
    } finally {
      if (entry.releasingActivity === pending) entry.releasingActivity = undefined;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(
      [...this.entries.values()].map(async (entry) => {
        await entry.process?.stop();
        await this.releaseActivity(entry);
      }),
    );
    this.entries.clear();
  }
}
