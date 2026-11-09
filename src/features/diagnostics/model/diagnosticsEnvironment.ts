import { dateTimeFormat, getLanguagePreference, getLocale } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";

export type EnvironmentFacts = Record<string, string | number | boolean | null | undefined>;

const oneLine = (value: string) => truncateGraphemes(value.replace(/\s+/g, " ").trim(), 120);

function query(text: string): boolean | null {
  try {
    return typeof matchMedia === "function" ? matchMedia(text).matches : null;
  } catch {
    return null;
  }
}

/** Facts the UI knows by itself; the app layer adds theme, density and the Host connection. */
export function webviewFacts(): EnvironmentFacts {
  const hasWindow = typeof window !== "undefined";
  let timeZone: string | undefined;
  try {
    timeZone = dateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return {
    language: getLanguagePreference(),
    locale: getLocale(),
    timezone: timeZone,
    screen: hasWindow && screen ? `${screen.width}x${screen.height}` : undefined,
    devicePixelRatio: hasWindow ? window.devicePixelRatio : undefined,
    window: hasWindow ? `${window.innerWidth}x${window.innerHeight}` : undefined,
    reducedMotion: query("(prefers-reduced-motion: reduce)"),
    systemColorScheme: query("(prefers-color-scheme: dark)") ? "dark" : "light",
  };
}

/**
 * The `ui-environment` section: one `key: value` per line. Only facts about the app and the
 * display: never an e-mail address, a path, a name, a project or a session title.
 */
export function environmentSection(...groups: EnvironmentFacts[]): string {
  const facts = Object.assign({}, ...groups) as EnvironmentFacts;
  return Object.entries(facts)
    .filter(([key, value]) => /^[A-Za-z][A-Za-z0-9]*$/.test(key) && value != null && value !== "")
    .map(([key, value]) => `${key}: ${oneLine(String(value))}`)
    .join("\n");
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const mb = (bytes: unknown) => {
  const value = num(bytes);
  return value === null ? null : `${Math.round(value / 1_048_576)} MB`;
};

/**
 * The `performance` section from a Host `resources.read` answer: the latest process and system
 * sample and the slowest RPC methods. Unknown shapes produce nothing.
 */
export function performanceSection(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  const { samples, performance } = result as { samples?: unknown; performance?: unknown };
  const lines: string[] = [];
  const last = Array.isArray(samples) ? (samples[samples.length - 1] as unknown) : null;
  if (typeof last === "object" && last !== null) {
    const { process: proc, host } = last as {
      process?: Record<string, unknown>;
      host?: Record<string, unknown>;
    };
    const facts: EnvironmentFacts = {
      hostRss: mb(proc?.rssBytes),
      hostHeapUsed: mb(proc?.heapUsedBytes),
      hostCpuPercent: num(proc?.cpuPercent) === null ? null : Math.round(num(proc?.cpuPercent)!),
      hostUptimeSeconds:
        num(proc?.uptimeSeconds) === null ? null : Math.round(num(proc?.uptimeSeconds)!),
      systemMemoryTotal: mb(host?.totalMemoryBytes),
      systemMemoryFree: mb(host?.freeMemoryBytes),
      logicalCpus: num(host?.logicalCpus),
    };
    lines.push(environmentSection(facts));
  }
  const metrics = (performance as { metrics?: unknown } | undefined)?.metrics;
  if (Array.isArray(metrics)) {
    const slow = metrics
      .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
      .filter((m) => typeof m.name === "string" && num(m.p95) !== null && (num(m.count) ?? 0) > 0)
      .sort((a, b) => num(b.p95)! - num(a.p95)!)
      .slice(0, 5);
    for (const m of slow) {
      lines.push(
        `slowRpc: ${m.name} count=${num(m.count)} p95=${Math.round(num(m.p95)!)}ms max=${Math.round(num(m.max) ?? 0)}ms`,
      );
    }
  }
  return lines.filter(Boolean).join("\n");
}
