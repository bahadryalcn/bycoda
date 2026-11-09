/**
 * Idle teardown for host-launched provider children.
 *
 * A provider process (and every MCP server it spawned) stays alive after its
 * session goes idle. The reaper stops such a child once it has been quiet for
 * `PROVIDER_CHILD_IDLE_MS` and the Host confirms the session has nothing in
 * flight. The next turn relaunches through the adapters' missing-child path,
 * which resumes the provider conversation from the stored provider session id.
 */

export const PROVIDER_CHILD_IDLE_MS = 10 * 60_000;
export const PROVIDER_CHILD_IDLE_SWEEP_MS = 60_000;

/**
 * Harnesses whose adapter keeps resume state across a child exit and reloads
 * the provider conversation on the next turn (claude `--resume`, codex thread
 * resume, ACP `session/load`/`session/resume`). Generic ACP (`acp`) is left
 * out: it resumes only when the agent advertises `loadSession`, which the Host
 * cannot see, and otherwise silently starts a new provider session.
 */
const RESUMABLE_HARNESSES: ReadonlySet<string> = new Set([
  "claude",
  "codex",
  "cursor",
  "grok",
  "opencode",
  "pi",
  "omp",
  "fx",
  "hermes",
  "antigravity",
]);

export type ProviderChildIdleGate = {
  /** True while a turn, dispatch or startup is in progress for the session. */
  isBusy(sessionId: string): boolean;
  /** True when stored state shows nothing pending and the session can resume. */
  canRetire(sessionId: string): Promise<boolean>;
};

type StoredSession = {
  status?: string;
  session: {
    harness: string;
    providerSessionId?: string;
    busy?: boolean;
    pendingQuestion?: unknown;
    pendingSwitch?: unknown;
    backgroundTasks?: readonly unknown[];
    queuedMessages?: readonly unknown[];
    blocks: readonly {
      approval?: { decided?: unknown };
      followUpDelivery?: string;
      tool?: { status?: string };
      agentRun?: { endedAt?: unknown };
      shell?: { running?: unknown; terminationFailed?: unknown };
    }[];
  };
};

/** Children of one logical session share its ID plus an optional `#<n>` suffix. */
export function logicalSessionId(childId: string): string {
  return childId.replace(/#\d+$/, "");
}

export function createSessionIdleGate(
  engine: { hasActiveRun(sessionId: string): boolean },
  store: { session(sessionId: string): Promise<StoredSession> },
): ProviderChildIdleGate {
  return {
    isBusy: (sessionId) => engine.hasActiveRun(sessionId),
    async canRetire(sessionId) {
      // Utility and unknown children have no stored session: leave them alone.
      const value = await store.session(sessionId).catch(() => undefined);
      if (!value) return false;
      const { session } = value;
      if (value.status !== "idle" || session.busy) return false;
      // Without a stored provider conversation the next turn could not resume.
      if (!session.providerSessionId || !RESUMABLE_HARNESSES.has(session.harness)) return false;
      if (
        session.pendingQuestion ||
        session.pendingSwitch ||
        session.backgroundTasks?.length ||
        session.queuedMessages?.length
      )
        return false;
      return !session.blocks.some(
        (block) =>
          (!!block.approval && !block.approval.decided) ||
          block.followUpDelivery === "uncertain" ||
          block.followUpDelivery === "pending" ||
          (block.tool?.status !== undefined &&
            ["running", "in_progress", "pending"].includes(block.tool.status)) ||
          (block.agentRun !== undefined && block.agentRun.endedAt === undefined) ||
          block.shell?.running ||
          block.shell?.terminationFailed,
      );
    },
  };
}

export type ProviderChildIdleOptions<C extends object> = {
  children(): Iterable<readonly [string, C]>;
  /** Stops exactly this child (graceful first); never a newer one under the same ID. */
  retire(id: string, child: C): Promise<void>;
  /** True while a replacement for this session is being started. */
  isStarting(id: string): boolean;
  gate(): ProviderChildIdleGate | undefined;
  idleMs?: number;
  sweepMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
};

export class ProviderChildIdleReaper<C extends object> {
  private readonly lastActivity = new WeakMap<C, number>();
  /** After a refusal the stored session is not re-read until this time. */
  private readonly recheckAt = new WeakMap<C, number>();
  private readonly idleMs: number;
  private readonly now: () => number;
  private timer?: ReturnType<typeof setInterval>;
  private sweeping?: Promise<number>;
  private stopped = false;

  constructor(private readonly options: ProviderChildIdleOptions<C>) {
    this.idleMs = options.idleMs ?? PROVIDER_CHILD_IDLE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Records process or protocol activity (spawn, a frame in either direction). */
  touch(child: C): void {
    this.lastActivity.set(child, this.now());
    this.recheckAt.delete(child);
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => {
      this.sweep().catch((error) => (this.options.onError ?? console.error)(error));
    }, this.options.sweepMs ?? PROVIDER_CHILD_IDLE_SWEEP_MS);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass over the live children; returns how many were stopped. */
  sweep(): Promise<number> {
    this.sweeping ??= this.sweepOnce().finally(() => {
      this.sweeping = undefined;
    });
    return this.sweeping;
  }

  private async sweepOnce(): Promise<number> {
    const gate = this.options.gate();
    if (!gate) return 0;
    let stopped = 0;
    for (const [id, child] of [...this.options.children()]) {
      if (this.stopped) break;
      const since = this.lastActivity.get(child);
      if (since === undefined) {
        // First sight of a child nobody touched: start its window now.
        this.touch(child);
        continue;
      }
      const now = this.now();
      if (now - since < this.idleMs || now < (this.recheckAt.get(child) ?? 0)) continue;
      const sessionId = logicalSessionId(id);
      try {
        if (this.options.isStarting(id) || gate.isBusy(sessionId)) continue;
        if (!(await gate.canRetire(sessionId))) {
          this.recheckAt.set(child, this.now() + this.idleMs);
          continue;
        }
        // A turn may have begun while the stored state was read.
        if (
          this.stopped ||
          this.lastActivity.get(child) !== since ||
          this.options.isStarting(id) ||
          gate.isBusy(sessionId) ||
          ![...this.options.children()].some(([, current]) => current === child)
        )
          continue;
        await this.options.retire(id, child);
        stopped += 1;
      } catch (error) {
        (this.options.onError ?? console.error)(error);
      }
    }
    return stopped;
  }
}
