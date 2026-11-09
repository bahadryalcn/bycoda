// @vitest-environment happy-dom
import { AccountApiError } from "@bycoda/account-contracts";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendDiagnosticReport } from "./diagnosticsReport";
import { CRASH, makeDeps } from "./testKit";

beforeEach(() => localStorage.clear());

type Body = {
  trigger: string;
  summary?: string;
  note?: string;
  feedbackId?: string;
  sources: { name: string }[];
  content: { encoding: string; data: string };
};
const bodyOf = (call: { body: unknown }) => call.body as Body;
const textOf = (body: Body) =>
  gunzipSync(Buffer.from(body.content.data, "base64")).toString("utf8");

describe("sendDiagnosticReport", () => {
  it("redacts, compresses and uses the account route when signed in", async () => {
    const kit = makeDeps();
    const status = await sendDiagnosticReport(kit.deps, { trigger: "manual", note: " help " });
    expect(status).toBe("sent");
    expect(kit.sendAnonymousDiagnosticReport).not.toHaveBeenCalled();
    const body = bodyOf(kit.sendDiagnosticReport.mock.calls[0]![0]);
    expect(body.note).toBe("help");
    expect(body.content.encoding).toBe("gzip-base64");
    const text = textOf(body);
    expect(text).toContain("===== host =====");
    expect(text).not.toContain("ada");
    expect(text).not.toContain("abc12345");
  });

  it("uses the anonymous route for guests and a one-line crash summary", async () => {
    const kit = makeDeps({ signedIn: false, logs: { crash: CRASH } });
    expect(await sendDiagnosticReport(kit.deps, { trigger: "crash" })).toBe("sent");
    const body = bodyOf(kit.sendAnonymousDiagnosticReport.mock.calls[0]![0]);
    expect(body.summary).toBe("boom at ~\\app");
    expect(body.sources.map((s) => s.name)).toContain("native-crash");
  });

  it("links feedback and reports empty, rate-limited and failed results", async () => {
    const kit = makeDeps();
    await sendDiagnosticReport(kit.deps, { trigger: "feedback", feedbackId: "fb_1" });
    expect(bodyOf(kit.sendDiagnosticReport.mock.calls[0]![0]).feedbackId).toBe("fb_1");

    const empty = makeDeps({ logs: { sections: [] } });
    expect(await sendDiagnosticReport(empty.deps, { trigger: "manual" })).toBe("empty");

    const limited = makeDeps();
    limited.sendDiagnosticReport.mockRejectedValueOnce(
      new AccountApiError(429, "rate_limited", "slow down"),
    );
    expect(await sendDiagnosticReport(limited.deps, { trigger: "manual" })).toBe("rate-limited");

    const broken = makeDeps();
    broken.sendDiagnosticReport.mockRejectedValueOnce(new Error("offline"));
    expect(await sendDiagnosticReport(broken.deps, { trigger: "manual" })).toBe("failed");
  });

  it("gives up at the deadline and without an account platform", async () => {
    const slow = makeDeps();
    slow.deps.timeoutMs = 20;
    slow.sendDiagnosticReport.mockImplementationOnce(() => new Promise(() => undefined));
    expect(await sendDiagnosticReport(slow.deps, { trigger: "manual" })).toBe("failed");

    const none = makeDeps();
    none.deps.identity = () => ({ available: false, signedIn: false, email: null });
    expect(await sendDiagnosticReport(none.deps, { trigger: "manual" })).toBe("not-configured");
  });
});

describe("compression", () => {
  const withoutCompressionStream = () => vi.stubGlobal("CompressionStream", undefined);
  afterEach(() => vi.unstubAllGlobals());

  it("uses the native gzip when the webview has no CompressionStream", async () => {
    withoutCompressionStream();
    const kit = makeDeps();
    const gzipBase64 = vi.fn(async (text: string) => gzipSync(text).toString("base64"));
    (kit.native as { gzipBase64?: typeof gzipBase64 }).gzipBase64 = gzipBase64;
    expect(await sendDiagnosticReport(kit.deps, { trigger: "manual" })).toBe("sent");
    const body = bodyOf(kit.sendDiagnosticReport.mock.calls[0]![0]);
    expect(body.content.encoding).toBe("gzip-base64");
    expect(textOf(body)).toContain("===== host =====");
  });

  it("fails when neither the webview nor the native side can compress", async () => {
    withoutCompressionStream();
    const none = makeDeps();
    expect(await sendDiagnosticReport(none.deps, { trigger: "manual" })).toBe("failed");
    const broken = makeDeps();
    (broken.native as { gzipBase64?: () => Promise<string> }).gzipBase64 = async () => {
      throw new Error("no");
    };
    expect(await sendDiagnosticReport(broken.deps, { trigger: "manual" })).toBe("failed");
    expect(none.sendDiagnosticReport).not.toHaveBeenCalled();
  });

  it("composes again with half the text when the first upload is too large", async () => {
    withoutCompressionStream();
    const kit = makeDeps();
    kit.setLogs({
      sections: [{ name: "host", text: "line of host\n".repeat(100), truncated: false }],
    });
    const sizes: number[] = [];
    (kit.native as { gzipBase64?: (t: string) => Promise<string> }).gzipBase64 = async (text) => {
      sizes.push(text.length);
      return sizes.length === 1 ? "A".repeat(1_400_001) : gzipSync(text).toString("base64");
    };
    expect(await sendDiagnosticReport(kit.deps, { trigger: "manual" })).toBe("sent");
    expect(sizes).toHaveLength(2);
  });
});
