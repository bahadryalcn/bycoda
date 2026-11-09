// @vitest-environment happy-dom
import { DiagnosticSourceName } from "@bycoda/account-contracts";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { sendDiagnosticReport } from "./diagnosticsReport";
import { limitSections, remoteSectionName } from "./remoteHostLogs";
import { makeDeps } from "./testKit";
import { clearUiLog, uiLogSnapshot } from "./uiLogBuffer";

const answer = (version: string, names = ["host", "host-previous", "host-stdout"]) => ({
  hostVersion: version,
  sections: names.map((name) => ({ name, text: `${name} of ${version}`, truncated: false })),
});
const reportOf = (kit: ReturnType<typeof makeDeps>) => {
  const body = kit.sendDiagnosticReport.mock.calls[0]![0].body as {
    content: { data: string };
    sources: { name: string }[];
  };
  const text = gunzipSync(Buffer.from(body.content.data, "base64")).toString("utf8");
  return { names: body.sources.map((s) => s.name), text };
};

describe("remote Host logs", () => {
  it("names sections per Host and keeps every name valid", () => {
    expect(remoteSectionName("host", 0)).toBe("remote-host");
    expect(remoteSectionName("host-environment", 0)).toBe("remote-host-env");
    expect(remoteSectionName("host-crash", 2)).toBe("remote-host-crash-3");
    expect(remoteSectionName("host-previous", 0)).toBeNull();
    expect(remoteSectionName("host-stdout", 0)).toBeNull();
    expect(remoteSectionName("other", 0)).toBeNull();
    for (const name of ["host", "host-crash", "host-environment"]) {
      for (const index of [0, 1, 2]) {
        expect(DiagnosticSourceName.safeParse(remoteSectionName(name, index)).success).toBe(true);
      }
    }
  });

  it("reads two remote Hosts, skips the failing one and adds versions to the environment", async () => {
    clearUiLog();
    const kit = makeDeps();
    const request = vi.fn(async (id: string) => {
      if (id === "r2") throw Object.assign(new Error("old"), { code: "UNSUPPORTED" });
      return answer("2.1.0", ["host", "host-crash"]);
    });
    kit.deps.remoteHosts = { hosts: () => ["r1", "r2", "r3", "r4"], request };
    expect(await sendDiagnosticReport(kit.deps, { trigger: "periodic" })).toBe("sent");
    expect(request).toHaveBeenCalledTimes(3); // at most three Hosts
    expect(request.mock.calls.map((c) => c[1])).toEqual(Array(3).fill("diagnostics.logs.read"));
    const { names, text } = reportOf(kit);
    expect(names).toEqual(expect.arrayContaining(["remote-host", "remote-host-crash"]));
    expect(
      names.some((n) => n.startsWith("remote-host-previous") || n.startsWith("remote-host-stdout")),
    ).toBe(false);
    expect(names).toContain("remote-host-3");
    expect(names.indexOf("host")).toBeLessThan(names.indexOf("remote-host"));
    expect(text).toContain("remoteHostVersions: 2.1.0, 2.1.0");
    expect(uiLogSnapshot()).toMatch(/\[ui\.diagnostics\] remote host logs unavailable host=2/);
  });

  it("makes no remote call without remote Hosts", async () => {
    const kit = makeDeps();
    const request = vi.fn();
    kit.deps.remoteHosts = { hosts: () => [], request };
    await sendDiagnosticReport(kit.deps, { trigger: "manual" });
    expect(request).not.toHaveBeenCalled();
  });

  it("drops previous and stdout sections before main logs at the 16-section cap", () => {
    const names = [
      ...["host", "host-crash", "host-environment"].flatMap((n) =>
        [0, 1, 2].map((i) => remoteSectionName(n, i)!),
      ),
      "native",
      "app",
      "app-previous",
      "host-previous",
      "host",
      "host-stdout",
      "host-crash",
      "ui-crash",
      "ui",
      "ui-environment",
    ];
    const sections = names.map((name) => ({ name, text: name }));
    const kept = limitSections(sections, 16).map((s) => s.name);
    expect(kept).toHaveLength(16);
    expect(kept).toEqual(
      expect.arrayContaining(["native", "app", "ui", "remote-host-3", "remote-host-crash-3"]),
    );
    expect(kept.filter((n) => /previous|stdout/.test(n))).toEqual([]);
    expect(kept).toContain("remote-host-3");
  });
});
