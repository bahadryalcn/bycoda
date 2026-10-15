import { cpus, freemem, loadavg, totalmem } from "node:os";
import { createHash } from "node:crypto";

export type ResourceSample = {
  at: number;
  host: {
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    logicalCpus: number;
    loadAverage: number[] | null;
  };
  process: {
    pid: number;
    rssBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    cpuPercent: number | null;
    uptimeSeconds: number;
  };
};

/** No timer, child process, process scan or retained device credentials. Reads
 * sample on demand; CPU is this Node process, not its provider descendants. */
export class ResourceDiagnostics {
  private samples: ResourceSample[] = [];
  private previous?: { at: number; cpu: NodeJS.CpuUsage };
  private readonly readers = new Map<string, number>();
  constructor(private readonly now = Date.now) {}

  read(reader: string) {
    reader = createHash("sha256").update(reader).digest("hex");
    const at = this.now();
    for (const [id, seen] of this.readers) if (at - seen > 60_000) this.readers.delete(id);
    if (!this.readers.has(reader) && this.readers.size >= 32)
      throw new Error("Diagnostics reader limit reached");
    this.readers.set(reader, at);
    if (!this.samples.length || at - this.samples[this.samples.length - 1].at >= 1_000) {
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage();
      const elapsed = this.previous ? at - this.previous.at : 0;
      const cpuPercent =
        this.previous && elapsed > 0
          ? Math.max(
              0,
              (cpu.user + cpu.system - this.previous.cpu.user - this.previous.cpu.system) /
                (elapsed * 10),
            )
          : null;
      this.previous = { at, cpu };
      this.samples.push({
        at,
        host: {
          totalMemoryBytes: totalmem(),
          freeMemoryBytes: freemem(),
          logicalCpus: cpus().length,
          loadAverage: process.platform === "win32" ? null : loadavg(),
        },
        process: {
          pid: process.pid,
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          externalBytes: memory.external,
          cpuPercent,
          uptimeSeconds: process.uptime(),
        },
      });
      while (
        this.samples.length > 60 ||
        Buffer.byteLength(JSON.stringify(this.samples)) > 64 * 1024
      )
        this.samples.shift();
    }
    return {
      scope: "host-os-and-node-process",
      sampling: "on-demand",
      childProcessesIncluded: false,
      samples: this.samples.map((sample) => ({
        ...sample,
        host: { ...sample.host, loadAverage: sample.host.loadAverage?.slice() ?? null },
        process: { ...sample.process },
      })),
    };
  }
  revoke(credential: string) {
    this.readers.delete(createHash("sha256").update(credential).digest("hex"));
  }
  close() {
    this.samples = [];
    this.readers.clear();
    this.previous = undefined;
  }
}
