// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sendDiagnosticReport } from "./diagnosticsReport";
import { environmentSection, performanceSection, webviewFacts } from "./diagnosticsEnvironment";
import { gunzipSync } from "node:zlib";
import { makeDeps } from "./testKit";
import { recordUiLog } from "./uiLogBuffer";

describe("environment section", () => {
  it("lists display and app facts as key: value lines", () => {
    const text = environmentSection(webviewFacts(), { theme: "dark", skipped: undefined });
    expect(text).toMatch(/^language: /m);
    expect(text).toMatch(/^locale: /m);
    expect(text).toMatch(/^timezone: /m);
    expect(text).toMatch(/^window: \d+x\d+$/m);
    expect(text).toContain("theme: dark");
    expect(text).not.toContain("skipped");
  });

  it("never contains the account e-mail or paths in a built report", async () => {
    const kit = makeDeps();
    kit.deps.environment = () => ({ theme: "light", hostConnection: "local", remoteHosts: 1 });
    await sendDiagnosticReport(kit.deps, { trigger: "manual" });
    const body = kit.sendDiagnosticReport.mock.calls[0]![0].body as {
      content: { data: string };
      sources: { name: string }[];
    };
    const text = gunzipSync(Buffer.from(body.content.data, "base64")).toString("utf8");
    const section = text.split("===== ").find((part) => part.startsWith("ui-environment"))!;
    expect(section).toContain("signedIn: yes");
    expect(section).toContain("remoteHosts: 1");
    expect(section).not.toContain("ada@example.com");
    expect(section).not.toMatch(/[A-Za-z]:\\|\/Users\//);
  });
});

describe("performance section", () => {
  it("formats the latest sample and the slowest RPC methods", () => {
    const text = performanceSection({
      samples: [
        {
          process: {
            rssBytes: 209_715_200,
            heapUsedBytes: 104_857_600,
            cpuPercent: 12.4,
            uptimeSeconds: 90,
          },
          host: { totalMemoryBytes: 8_589_934_592, freeMemoryBytes: 4_294_967_296, logicalCpus: 8 },
        },
      ],
      performance: {
        metrics: [
          { name: "a.fast", count: 5, p95: 2, max: 3 },
          { name: "b.slow", count: 4, p95: 900, max: 1200 },
        ],
      },
    });
    expect(text).toContain("hostRss: 200 MB");
    expect(text).toContain("hostCpuPercent: 12");
    expect(text.indexOf("b.slow")).toBeLessThan(text.indexOf("a.fast"));
    expect(performanceSection(null)).toBe("");
    expect(performanceSection({ unexpected: true })).toBe("");
  });

  it("is skipped silently when the Host fails or is slow", async () => {
    const failing = makeDeps();
    failing.deps.readPerformance = async () => {
      throw new Error("down");
    };
    expect(await sendDiagnosticReport(failing.deps, { trigger: "manual" })).toBe("sent");

    const slow = makeDeps();
    slow.deps.readPerformance = () => new Promise(() => undefined);
    slow.deps.timeoutMs = 10_000;
    const started = performance.now();
    expect(await sendDiagnosticReport(slow.deps, { trigger: "manual" })).toBe("sent");
    expect(performance.now() - started).toBeLessThan(4000);
  });

  it("keeps at most sixteen sections even with every source present", async () => {
    const kit = makeDeps();
    kit.setLogs({
      sections: [
        "environment",
        "native",
        "host-crash",
        "app",
        "app-previous",
        "host",
        "host-previous",
        "host-stdout",
      ].map((name) => ({ name, text: `line of ${name}`, truncated: false })),
    });
    recordUiLog("warn", "ui.console", "something");
    kit.deps.readPerformance = async () => ({ samples: [{ process: { rssBytes: 1_048_576 } }] });
    localStorage.setItem(
      "bycoda.diagnostics.lastRenderError",
      JSON.stringify({ message: "m", componentStack: "s", at: "2026-11-09T11:00:00.000Z" }),
    );
    await sendDiagnosticReport(kit.deps, { trigger: "manual" });
    const body = kit.sendDiagnosticReport.mock.calls[0]![0].body as { sources: { name: string }[] };
    expect(body.sources.length).toBeLessThanOrEqual(16);
    expect(body.sources.map((s) => s.name)).toEqual(
      expect.arrayContaining(["ui-environment", "performance", "ui", "ui-crash", "host-crash"]),
    );
  });
});
