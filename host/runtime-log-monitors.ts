import { randomUUID } from "node:crypto";
import { SharedBrowser, sharedBrowserUrl, type BrowserLoader } from "./shared-browser";
import type { RuntimeLogsService } from "./runtime-logs";

export type RuntimeLogMonitor = { id: string; projectId: string; url: string; sourceId?: string };

/** Explicit, independent browser contexts; never attach to or control the shared browser. */
export class RuntimeLogMonitors {
  private readonly monitors = new Map<
    string,
    { monitor: RuntimeLogMonitor; browser: SharedBrowser; ready: Promise<RuntimeLogMonitor> }
  >();
  constructor(
    private readonly load: BrowserLoader,
    private readonly logs: RuntimeLogsService,
  ) {}

  list(projectId: string): RuntimeLogMonitor[] {
    return [...this.monitors.values()]
      .filter((entry) => entry.monitor.projectId === projectId)
      .map((entry) => ({ ...entry.monitor }));
  }

  async start(projectId: string, input: unknown): Promise<RuntimeLogMonitor> {
    if (typeof input !== "string" || !input.trim() || input.length > 2048)
      throw new Error("Enter a port or HTTP(S) URL.");
    const value = input.trim();
    if (/^\d+$/.test(value) && (+value < 1 || +value > 65535))
      throw new Error("Port must be between 1 and 65535.");
    const url = sharedBrowserUrl(/^\d+$/.test(value) ? `http://localhost:${value}` : value);
    const parsed = new URL(url);
    if (parsed.username || parsed.password)
      throw new Error("URLs containing credentials are not supported.");
    const existing = [...this.monitors.values()].find(
      (entry) => entry.monitor.projectId === projectId && entry.monitor.url === url,
    );
    if (existing) return existing.ready;
    if (this.monitors.size >= 8)
      throw new Error("Stop a browser log monitor before adding another (maximum 8).");
    const id = randomUUID();
    const browser = new SharedBrowser(this.load, Date.now, {
      runtimeLogs: this.logs,
      logLabel: `Log monitor · ${parsed.host}`,
      keepAlive: true,
    });
    const monitor: RuntimeLogMonitor = { id, projectId, url };
    // Reserve capacity before any asynchronous work, including concurrent starts.
    const entry = { monitor, browser, ready: Promise.resolve(monitor) };
    this.monitors.set(id, entry);
    entry.ready = this.launch(monitor, browser);
    return entry.ready;
  }

  private async launch(
    monitor: RuntimeLogMonitor,
    browser: SharedBrowser,
  ): Promise<RuntimeLogMonitor> {
    const { id, projectId, url } = monitor;
    try {
      const lease = await browser.dispatch("browser.claim", {}, id);
      const state = await browser.dispatch(
        "browser.open",
        { projectId, url, leaseId: lease.leaseId },
        id,
      );
      monitor.sourceId = state.logSourceId;
      return { ...monitor };
    } catch (error) {
      this.monitors.delete(id);
      await browser.close().catch(() => {});
      throw error;
    }
  }

  async stop(projectId: string, id: string): Promise<void> {
    const entry = this.monitors.get(id);
    if (!entry || entry.monitor.projectId !== projectId)
      throw new Error("Log monitor not found in this project.");
    await entry.ready.catch(() => {});
    await entry.browser.close();
    this.monitors.delete(id);
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.monitors.values()].map(async (entry) => {
        await entry.ready.catch(() => {});
        await entry.browser.close();
      }),
    );
    this.monitors.clear();
  }
}
