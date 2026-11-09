import { open } from "node:fs/promises";
import { cpus, arch, freemem, homedir, platform, release, totalmem, uptime } from "node:os";
import { join, resolve } from "node:path";
import { redactDiagnosticText } from "@bycoda/account-contracts";
import type { HostLogReport } from "../../src/shared/model/host-contracts/diagnostics-logs";
import { createLogger, parseLogLevel } from "./logger";

type Section = HostLogReport["sections"][number];

const KIB = 1024;
const LIMITS = { host: 400 * KIB, hostPrevious: 100 * KIB, stdout: 50 * KIB, crash: 20 * KIB };
const DEADLINE_MS = 5_000;
const log = createLogger("host.diagnostics");

/** Last `limit` bytes of a file, never the whole file; the first partial line is dropped. */
export async function readTail(
  path: string,
  limit: number,
): Promise<{ text: string; truncated: boolean } | undefined> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return undefined;
  }
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, limit);
    const buffer = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await handle.read(
        buffer,
        filled,
        length - filled,
        size - length + filled,
      );
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    // Lossy decode: a cut multibyte character or Windows code-page byte becomes U+FFFD.
    let text = new TextDecoder("utf-8").decode(buffer.subarray(0, filled));
    const truncated = size > limit;
    if (truncated) {
      const newline = text.indexOf("\n");
      text = newline >= 0 ? text.slice(newline + 1) : "";
    }
    return { text, truncated };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function renderCrash(raw: string): string {
  try {
    const marker = JSON.parse(raw) as Record<string, unknown>;
    return [
      `message: ${String(marker.message ?? "")}`,
      `thread: ${String(marker.thread ?? "")}`,
      `occurredAt: ${String(marker.occurredAt ?? "")}`,
      `appVersion: ${String(marker.appVersion ?? "")}`,
      `backtrace:\n${String(marker.backtrace ?? "")}`,
    ].join("\n");
  } catch {
    return raw;
  }
}

function environmentText(version: string, dataDir: string): string {
  const defaultDir = resolve(join(homedir(), ".bycoda-host"));
  const mb = (bytes: number) => Math.round(bytes / 1_048_576);
  return Object.entries({
    hostVersion: version,
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    node: process.version,
    cpuCount: cpus().length,
    totalMemoryMb: mb(totalmem()),
    freeMemoryMb: mb(freemem()),
    uptimeSec: Math.round(uptime()),
    logLevel: parseLogLevel(process.env.BYCODA_HOST_LOG_LEVEL),
    dataDirKind: resolve(dataDir) === defaultDir ? "default" : "override",
  })
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

/** Reads the Host's own log files as redacted, size-bounded sections; missing files are skipped. */
export async function readHostLogReport(options: {
  dataDir: string;
  version: string;
}): Promise<HostLogReport> {
  const work = async (): Promise<Section[]> => {
    const files: [Section["name"], string, number, (text: string) => string][] = [
      ["host", join(options.dataDir, "logs", "host.log"), LIMITS.host, (t) => t],
      ["host-previous", join(options.dataDir, "logs", "host.1.log"), LIMITS.hostPrevious, (t) => t],
      ["host-stdout", join(options.dataDir, "host.log"), LIMITS.stdout, (t) => t],
      ["host-crash", join(options.dataDir, "logs", "last-crash.json"), LIMITS.crash, renderCrash],
    ];
    const sections: Section[] = [];
    for (const [name, path, limit, render] of files) {
      const tail = await readTail(path, limit);
      if (tail) sections.push({ name, text: render(tail.text), truncated: tail.truncated });
    }
    sections.push({
      name: "host-environment",
      text: environmentText(options.version, options.dataDir),
      truncated: false,
    });
    return sections;
  };
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Reading Host logs timed out.")), DEADLINE_MS);
  });
  try {
    const sections = await Promise.race([work(), deadline]);
    const homeDirs = [homedir()];
    return {
      hostVersion: options.version,
      sections: sections.map((section) => ({
        ...section,
        text: redactDiagnosticText(section.text, { homeDirs }),
      })),
    };
  } catch (error) {
    log.warn("log report failed", { error: error instanceof Error ? error.name : "UnknownError" });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
