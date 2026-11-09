import { vi } from "vitest";
import type { DiagnosticsDeps } from "./diagnosticsReport";
import type { NativeCrash, NativeLogs } from "./diagnosticsNative";

export const CRASH: NativeCrash = {
  message: "boom at C:\\Users\\ada\\app",
  location: "src/lib.rs:1",
  thread: "main",
  backtrace: "frame 0",
  occurredAt: "2026-11-09T10:00:00.000Z",
  appVersion: "1.0.0",
};

export function makeDeps(overrides: { logs?: Partial<NativeLogs>; signedIn?: boolean } = {}) {
  let logs: NativeLogs = {
    sections: [{ name: "host", text: "line C:\\Users\\ada\\x token=abc12345", truncated: false }],
    homeDir: "C:\\Users\\ada",
    crash: null,
    hostCrash: null,
    ...overrides.logs,
  };
  const sendDiagnosticReport = vi.fn<
    (input: { body: unknown }) => Promise<{ id: string; createdAt: string }>
  >(async () => ({
    id: "r1",
    createdAt: "x",
  }));
  const sendAnonymousDiagnosticReport = vi.fn<
    (input: { body: unknown }) => Promise<{ id: string; createdAt: string }>
  >(async () => ({
    id: "r2",
    createdAt: "x",
  }));
  const native = {
    available: true,
    collectLogs: vi.fn(async () => logs),
    clearCrash: vi.fn(async () => {
      logs = { ...logs, crash: null };
    }),
  };
  const deps: DiagnosticsDeps = {
    api: () => ({ sendDiagnosticReport, sendAnonymousDiagnosticReport }) as never,
    deviceInfo: async () => ({
      appVersion: "1.0.0",
      platform: "windows",
      osVersion: "11",
      channel: "stable",
    }),
    identity: () => ({
      available: true,
      signedIn: overrides.signedIn ?? true,
      email: "ada@example.com",
    }),
    native,
    timeoutMs: 1000,
  };
  return {
    deps,
    native,
    sendDiagnosticReport,
    sendAnonymousDiagnosticReport,
    setLogs: (next: Partial<NativeLogs>) => {
      logs = { ...logs, ...next };
    },
  };
}
