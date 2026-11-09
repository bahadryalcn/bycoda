import {
  AccountApiError,
  DIAGNOSTIC_GZIP_MAX_BASE64,
  DIAGNOSTIC_MAX_SOURCES,
  DIAGNOSTIC_TEXT_MAX_CHARS,
  DiagnosticReportCreate,
  composeDiagnosticLog,
  redactDiagnosticText,
  type AccountClient,
  type DiagnosticSection,
  type DiagnosticTrigger,
} from "@bycoda/account-contracts";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { isoTimestamp } from "../../../shared/lib/time/timestamps";
import type { DiagnosticsNative, NativeCrash } from "./diagnosticsNative";
import {
  environmentSection,
  performanceSection,
  webviewFacts,
  type EnvironmentFacts,
} from "./diagnosticsEnvironment";
import { collectRemoteHostLogs, limitSections, type RemoteHostLogSource } from "./remoteHostLogs";
import { readRenderError } from "./renderError";
import { uiLogSnapshot } from "./uiLogBuffer";

export type DiagnosticSendStatus = "sent" | "rate-limited" | "not-configured" | "failed" | "empty";

export type DiagnosticsIdentity = {
  /** False in builds without the account platform. */
  available: boolean;
  signedIn: boolean;
  email: string | null;
};

export type DiagnosticsDeps = {
  api: () => Pick<AccountClient, "sendDiagnosticReport" | "sendAnonymousDiagnosticReport">;
  deviceInfo: () => Promise<{
    appVersion: string;
    platform: "windows" | "macos" | "linux";
    osVersion: string;
    channel: "stable" | "preview" | "dev";
  }>;
  identity: () => DiagnosticsIdentity;
  native: DiagnosticsNative;
  /** App-level facts for the `ui-environment` section (theme, density, Host connection). */
  environment?: () => EnvironmentFacts;
  /** Connected remote Hosts whose logs are included (at most three). */
  remoteHosts?: RemoteHostLogSource;
  /** The local Host's `resources.read` answer for the `performance` section. */
  readPerformance?: () => Promise<unknown>;
  now?: () => Date;
  /** Deadline for collecting and uploading together. */
  timeoutMs?: number;
  onFailure?: (error: unknown) => unknown;
};

export type DiagnosticRequest = {
  trigger: DiagnosticTrigger;
  note?: string;
  feedbackId?: string;
  /** The crash this report is about, from the native marker. */
  crash?: NativeCrash | null;
  /** The Host process's crash marker, when that is what happened. */
  hostCrash?: NativeCrash | null;
  /** One-line summary; redacted here. Defaults to the crash message. */
  summary?: string;
};

export const DIAGNOSTIC_DEADLINE_MS = 30_000;
export const PERFORMANCE_DEADLINE_MS = 1_500;

/** Redacted, single-line, at most 500 characters. */
export function oneLine(text: string, redact: { homeDirs?: string[]; values?: string[] }): string {
  return truncateGraphemes(redactDiagnosticText(text, redact).replace(/\s+/g, " ").trim(), 500);
}

/** Base64 of the gzip of `text`, or null when this webview has no `CompressionStream`. */
export async function gzipBase64(text: string): Promise<string | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The webview's `CompressionStream` first, the native `diagnostics_gzip_base64` second. */
async function compress(deps: DiagnosticsDeps, text: string): Promise<string | null> {
  try {
    const data = await gzipBase64(text);
    if (data) return data;
  } catch {
    // -- fall through to the native fallback.
  }
  try {
    return (await deps.native.gzipBase64?.(text)) ?? null;
  } catch {
    return null;
  }
}

function crashSection(crash: NativeCrash): DiagnosticSection {
  const lines = [
    `occurredAt: ${crash.occurredAt}`,
    `appVersion: ${crash.appVersion}`,
    `thread: ${crash.thread ?? "unknown"}`,
    `location: ${crash.location ?? "unknown"}`,
    `message: ${crash.message}`,
    crash.backtrace,
  ];
  return { name: "native-crash", text: lines.join("\n") };
}

/** Best effort and bounded: a slow or failing Host never delays the report. */
async function readPerformance(deps: DiagnosticsDeps): Promise<string> {
  if (!deps.readPerformance) return "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      deps.readPerformance(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PERFORMANCE_DEADLINE_MS);
      }),
    ]);
    return performanceSection(answer);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function build(deps: DiagnosticsDeps, request: DiagnosticRequest) {
  const now = (deps.now ?? (() => new Date()))();
  const identity = deps.identity();
  const logs = await deps.native.collectLogs();
  const crash = request.crash ?? (request.trigger === "crash" ? logs.crash : null);
  const hostCrash = request.hostCrash ?? (request.trigger === "crash" ? logs.hostCrash : null);
  const renderError = readRenderError();
  const info = await deps.deviceInfo();
  const remote = await collectRemoteHostLogs(deps.remoteHosts);
  const environment = environmentSection(
    {
      appVersion: info.appVersion,
      platform: info.platform,
      os: info.osVersion,
      channel: info.channel,
    },
    webviewFacts(),
    { signedIn: identity.signedIn ? "yes" : "no" },
    deps.environment?.() ?? {},
    { remoteHostVersions: remote.versions.join(", ") },
  );
  const sections: DiagnosticSection[] = [
    ...logs.sections.map((s) => ({ name: s.name, text: s.text, truncated: s.truncated })),
    { name: "ui-environment", text: environment },
    { name: "performance", text: await readPerformance(deps) },
    { name: "ui", text: uiLogSnapshot() },
  ];
  // The native collector already renders its current crash marker as the `native` section.
  if (crash && !logs.sections.some((s) => s.name === "native")) sections.push(crashSection(crash));
  if (renderError) {
    sections.push({
      name: "ui-crash",
      text: `${renderError.at}\n${renderError.message}\n${renderError.componentStack}`,
    });
  }
  sections.push(...remote.sections);
  const redact = {
    homeDirs: logs.homeDir ? [logs.homeDir] : [],
    values: identity.email ? [identity.email] : [],
  };
  // Environment and performance facts alone are not a log: nothing to send.
  const hasLogs = sections.some(
    (s) => s.name !== "ui-environment" && s.name !== "performance" && s.text.trim().length > 0,
  );
  const limited = limitSections(sections, DIAGNOSTIC_MAX_SOURCES);
  let composed = composeDiagnosticLog(limited, redact);
  if (!hasLogs || composed.sources.length === 0) return "empty" as const;
  let compressed = await compress(deps, composed.text);
  if (compressed && compressed.length > DIAGNOSTIC_GZIP_MAX_BASE64) {
    // -- once more with half the text; older lines go first.
    composed = composeDiagnosticLog(limited, {
      ...redact,
      maxChars: DIAGNOSTIC_TEXT_MAX_CHARS / 2,
    });
    compressed = await compress(deps, composed.text);
  }
  if (!compressed) return "failed" as const;
  const dated = crash ?? hostCrash;
  const summary = oneLine(
    request.summary ??
      (request.trigger === "crash"
        ? (crash?.message ?? (hostCrash ? `Host: ${hostCrash.message}` : ""))
        : ""),
    redact,
  );
  const occurredAt = (dated && isoTimestamp(dated.occurredAt)) || now.toISOString();
  const body = DiagnosticReportCreate.safeParse({
    trigger: request.trigger,
    occurredAt,
    context: {
      appVersion: info.appVersion,
      platform: info.platform,
      osVersion: info.osVersion,
      channel: info.channel,
    },
    ...(request.feedbackId ? { feedbackId: request.feedbackId } : {}),
    ...(summary ? { summary } : {}),
    ...(request.note?.trim() ? { note: request.note.trim().slice(0, 2000) } : {}),
    sources: composed.sources,
    content: { encoding: "gzip-base64", data: compressed },
  });
  return body.success ? body.data : ("failed" as const);
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Diagnostic upload timed out.")), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Collects the native, Host and UI logs, redacts them on this computer, compresses and uploads
 * them. Consent is the caller's job (the scheduler, the feedback tick or the manual button);
 * this never reads the consent mode.
 */
export async function sendDiagnosticReport(
  deps: DiagnosticsDeps,
  request: DiagnosticRequest,
): Promise<DiagnosticSendStatus> {
  if (!deps.identity().available) return "not-configured";
  try {
    return await withDeadline(
      (async (): Promise<DiagnosticSendStatus> => {
        const body = await build(deps, request);
        if (typeof body === "string") return body;
        const api = deps.api();
        if (deps.identity().signedIn) await api.sendDiagnosticReport({ body });
        else await api.sendAnonymousDiagnosticReport({ body });
        return "sent";
      })(),
      deps.timeoutMs ?? DIAGNOSTIC_DEADLINE_MS,
    );
  } catch (error) {
    if (error instanceof AccountApiError && error.code === "rate_limited") return "rate-limited";
    try {
      await deps.onFailure?.(error);
    } catch {
      // -- already reported as `failed`.
    }
    return "failed";
  }
}
