import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const BUCKETS = 768;
const RATIO = 1.05;
const MIN_MS = 0.001;
const LOG_RATIO = Math.log(RATIO);
export const MAX_METRICS = 256;
type Distribution = { buckets: Float64Array; count: number; max: number };

/** Fixed-size, cumulative histograms. Percentiles use upper bucket bounds
 * (at most 5% error above 1us, except the final overflow bucket); max is exact.
 * No samples, arguments, results, errors, credentials or request IDs are kept.
 */
export class PerfMetrics {
  private readonly series = new Map<string, Distribution>();
  private loop?: ReturnType<typeof monitorEventLoopDelay>;
  private users = 0;

  constructor(names: readonly string[] = []) {
    this.register("other");
    for (const name of names) this.register(name);
  }

  /** Only register static code-owned labels, NEVER request-derived strings.
   * Unknown runtime labels are aggregated into `other`, without retaining them.
   */
  register(name: string) {
    if (this.series.size >= MAX_METRICS || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(name)) return;
    if (!this.series.has(name))
      this.series.set(name, { buckets: new Float64Array(BUCKETS), count: 0, max: 0 });
  }

  recordDuration(name: unknown, milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    const entry = (typeof name === "string" && this.series.get(name)) || this.series.get("other")!;
    const bucket =
      milliseconds === 0
        ? 0
        : Math.min(
            BUCKETS - 1,
            Math.max(1, Math.ceil(Math.log(milliseconds / MIN_MS) / LOG_RATIO) + 1),
          );
    entry.buckets[bucket]++;
    entry.count++;
    entry.max = Math.max(entry.max, milliseconds);
  }

  measure<T>(name: string, fn: () => Promise<T>): Promise<T>;
  measure<T>(name: string, fn: () => T): T;
  measure<T>(name: string, fn: () => T | Promise<T>): T | Promise<T> {
    const start = performance.now();
    const done = () => this.recordDuration(name, performance.now() - start);
    let value: T | Promise<T>;
    try {
      value = fn();
    } catch (error) {
      done();
      throw error;
    }
    if (value && typeof (value as Promise<T>).then === "function")
      return Promise.resolve(value).finally(done);
    done();
    return value;
  }

  /** Shared process monitor, enabled only while a host server owns it. */
  start() {
    if (this.users++ === 0) {
      this.loop = monitorEventLoopDelay({ resolution: 20 });
      this.loop.enable();
    }
  }

  close() {
    if (this.users > 0 && --this.users === 0) {
      this.loop?.disable();
      this.loop = undefined;
    }
  }

  snapshot() {
    const metrics = [...this.series]
      .filter(([, entry]) => entry.count)
      .map(([name, entry]) => {
        const percentile = (p: number) => {
          const rank = Math.ceil(entry.count * p);
          let count = 0;
          for (let i = 0; i < BUCKETS; i++) {
            count += entry.buckets[i];
            if (count >= rank)
              return i === 0
                ? 0
                : i === BUCKETS - 1
                  ? entry.max
                  : Math.min(entry.max, MIN_MS * RATIO ** (i - 1));
          }
          return entry.max;
        };
        return {
          name,
          count: entry.count,
          p50: percentile(0.5),
          p95: percentile(0.95),
          p99: percentile(0.99),
          max: entry.max,
        };
      });
    const loop = this.loop;
    return {
      unit: "milliseconds",
      scope: "node-process",
      window: "cumulative",
      histogram: {
        relativeError: 0.05,
        minimumMs: MIN_MS,
        overflowAboveMs: MIN_MS * RATIO ** (BUCKETS - 3),
      },
      limits: {
        maxMetrics: MAX_METRICS,
        registeredMetrics: this.series.size,
        histogramBytes: this.series.size * BUCKETS * Float64Array.BYTES_PER_ELEMENT,
      },
      metrics,
      eventLoop: {
        resolutionMs: 20,
        count: loop?.count ?? 0,
        p50: loop?.count ? loop.percentile(50) / 1e6 : 0,
        p95: loop?.count ? loop.percentile(95) / 1e6 : 0,
        p99: loop?.count ? loop.percentile(99) / 1e6 : 0,
        max: loop?.count ? loop.max / 1e6 : 0,
      },
    };
  }
}

/** HTTP group scope only; unscoped/multi-group MCP requests are `mcp.all`.
 * The body is never inspected or consumed by metrics instrumentation.
 */
export function mcpMetricName(route: string): string | undefined {
  if (!/^\/mcp(?:[/?]|$)/.test(route)) return undefined;
  try {
    const url = new URL(route, "http://localhost");
    const group = url.pathname === "/mcp" ? url.searchParams.get("scope") : url.pathname.slice(5);
    return group === null
      ? "mcp.all"
      : ["conversation", "runtime-logs", "social"].includes(group)
        ? `mcp.${group}`
        : "mcp.other";
  } catch {
    return "mcp.other";
  }
}

// RPC_METHOD_NAMES is a code-owned allowlist, never learned from requests.
const RPC_METHOD_NAMES: readonly string[] = [
  "attachments.claim",
  "attachments.claims",
  "attachments.read",
  "attachments.release",
  "attachments.status",
  "attachments.upload",
  "automations.delete",
  "automations.list",
  "automations.preview",
  "automations.runNow",
  "automations.runs",
  "automations.save",
  "browser.annotation.cancel",
  "browser.annotation.clear",
  "browser.annotation.hover",
  "browser.annotation.read",
  "browser.annotation.select",
  "browser.annotation.start",
  "browser.claim",
  "browser.close",
  "browser.frame",
  "browser.input",
  "browser.open",
  "browser.release",
  "browser.setup",
  "browser.status",
  "commands.dispatch",
  "commands.status",
  "conversation.access.issue",
  "conversation.bridge.describe",
  "conversation.desktop.authorize",
  "conversation.desktop.finish",
  "conversation.desktop.take",
  "conversation.tools.call",
  "devices.preview.impact",
  "devices.preview.mobile.start",
  "devices.preview.mobile.status",
  "devices.revokeOther",
  "history.import.cancel",
  "history.import.commit",
  "history.import.preview",
  "history.import.status",
  "host.access.read",
  "preferences.desktop.patch",
  "preferences.desktop.read",
  "preferences.desktop.status",
  "preferences.desktop.template.read",
  "projects.organization.patch",
  "projects.organization.read",
  "projects.organization.status",
  "providers.acp.patchMetadata",
  "providers.center.read",
  "providers.desktop.patch",
  "providers.desktop.quota.refresh",
  "providers.desktop.read",
  "providers.desktop.status",
  "sessions.contextual.preview",
  "shell.setProfileReviewed",
  "ssh.workspace.approve",
  "ssh.workspace.catalog.read",
  "ssh.workspace.close.approve",
  "ssh.workspace.close.review",
  "ssh.workspace.review",
  "ssh.workspace.status",
  "terminals.pty.desktop.attach",
  "terminals.pty.desktop.close",
  "terminals.pty.desktop.create",
  "terminals.pty.desktop.detach",
  "terminals.pty.desktop.list",
  "terminals.pty.desktop.read",
  "terminals.pty.desktop.resize",
  "terminals.pty.desktop.status",
  "terminals.pty.desktop.write",
  "usage.sessions.read",
  "worktrees.removal.approve",
  "worktrees.removal.review",
  "worktrees.removal.status",
  "crews.accept",
  "crews.agent.delete",
  "crews.agent.save",
  "crews.answer",
  "crews.assign",
  "crews.delete",
  "crews.finish",
  "crews.get",
  "crews.inspect",
  "crews.list",
  "crews.pause",
  "crews.request",
  "crews.resolve",
  "crews.respond",
  "crews.resume",
  "crews.save",
  "crews.schema",
  "crews.start",
  "crews.stop",
  "devServers.bridgeCheck",
  "devServers.bridgeClose",
  "devServers.bridgeOpen",
  "devServers.bridgeRead",
  "devServers.bridgeWrite",
  "devServers.details",
  "devServers.kill",
  "devServers.list",
  "devServers.logs",
  "devServers.openExternal",
  "devServers.restart",
  "devServers.start",
  "devServers.stop",
  "devices.action",
  "devices.boot",
  "devices.capture",
  "devices.list",
  "devices.preflight",
  "devices.preview",
  "devices.preview.status",
  "devices.revokeSelf",
  "devices.setup",
  "devices.start",
  "devices.status",
  "devices.stop",
  "environment.describe",
  "events.read",
  "files.create",
  "files.index",
  "files.list",
  "files.read",
  "files.search",
  "files.searchContent",
  "files.write",
  "generic_acp_cancel_install",
  "generic_acp_install",
  "generic_acp_list",
  "generic_acp_registry",
  "generic_acp_remove",
  "generic_acp_save",
  "git.action",
  "git.branches",
  "git.createBranch",
  "git.diff",
  "git.fileDiff",
  "git.index",
  "git.switch",
  "git.worktreeCreate",
  "git.worktrees",
  "goals.approve",
  "goals.cancel",
  "goals.create",
  "goals.delete",
  "goals.list",
  "goals.replan",
  "goals.update",
  "handoff_history_read",
  "handoff_history_save",
  "host.settings.get",
  "host.settings.save",
  "inbox.list",
  "inbox.provider.request",
  "inbox.provider.result",
  "inbox.provider.status",
  "machine.changes",
  "mcp.tokens.create",
  "mcp.tokens.list",
  "mcp.tokens.revoke",
  "mobile.access.disable",
  "mobile.access.enable",
  "mobile.access.status",
  "mobile.pairing.cancel",
  "mobile.pairing.create",
  "mobile.pairing.status",
  "models.list",
  "notes.delete",
  "notes.get",
  "notes.list",
  "notes.upsert",
  "projects.browse",
  "projects.createDirectory",
  "projects.directory",
  "projects.list",
  "projects.open",
  "resources.read",
  "runtimeLogs.access.issue",
  "runtimeLogs.bridge.describe",
  "runtimeLogs.monitors.list",
  "runtimeLogs.monitors.start",
  "runtimeLogs.monitors.stop",
  "runtimeLogs.read",
  "runtimeLogs.sources",
  "runtimeLogs.terminals.append",
  "runtimeLogs.tools.call",
  "sessions.adopted",
  "sessions.block",
  "sessions.delete",
  "sessions.desktopLive",
  "sessions.get",
  "sessions.list",
  "sessions.page",
  "sessions.queue.change",
  "sessions.queue.claim",
  "sessions.queue.finish",
  "sessions.queue.get",
  "sessions.sync",
  "sessions.syncChunk",
  "sessions.update",
  "shell.profiles",
  "shell.setProfile",
  "social.access.issue",
  "social.bridge.describe",
  "social.native.authority",
  "social.native.enroll",
  "social.native.register",
  "social.native.reset",
  "social.native.status",
  "social.tools.call",
  "stewards.decline",
  "stewards.delete",
  "stewards.list",
  "stewards.runNow",
  "stewards.save",
  "string",
  "sync.pull",
  "sync.push",
  "tasks.delete",
  "tasks.list",
  "tasks.move",
  "tasks.notes.read",
  "tasks.notes.resolve",
  "tasks.reorder",
  "tasks.retarget",
  "tasks.review.recheck",
  "tasks.save",
  "tasks.start",
  "terminals.close",
  "terminals.create",
  "terminals.interrupt",
  "terminals.list",
  "terminals.read",
  "terminals.write",
  "tunnels.credential",
  "tunnels.start",
  "tunnels.status",
  "tunnels.stop",
  "workspace.run",
];
export const perfMetrics = new PerfMetrics([
  ...RPC_METHOD_NAMES,
  "mcp.all",
  "mcp.conversation",
  "mcp.runtime-logs",
  "mcp.social",
  "mcp.other",
]);
export const measure = perfMetrics.measure.bind(perfMetrics);
export const recordDuration = perfMetrics.recordDuration.bind(perfMetrics);
