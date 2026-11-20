// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, it, vi } from "vitest";
import type { UsageTurn } from "../../usage/public/usageAnalytics";
import { setStatsChoice } from "./accountPrivacy";
import { setAnonymousUsageEnabled, startAnonymousUsage } from "./anonymousUsage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const midnight = Date.parse("2026-11-08T00:00:00Z");
const sample: UsageTurn = {
  sessionId: "private-session",
  title: "private-title",
  project: "private-folder",
  provider: "codex",
  accountId: "private-account",
  model: "test-model",
  startedAt: midnight - 600,
  durationMs: 500,
  inputTokens: 100,
  outputTokens: 25,
  cacheReadTokens: 40,
  cacheWriteTokens: 0,
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("requires separate consent and sends only measured post-consent daily aggregates", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(midnight - 1_000);
  setStatsChoice("on");
  const status = vi
    .fn()
    .mockResolvedValue({ configured: true, apiBaseUrl: "https://example.test" });
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "session_usage_report"
      ? {
          truncated: false,
          turns: [
            { ...sample, startedAt: midnight - 1_500 },
            sample,
            { ...sample, model: "unknown-model" },
            { ...sample, startedAt: midnight - 100 },
          ],
        }
      : {
          models: [
            { id: "openai/test-model", input: 0.000001, output: 0.000002, cacheRead: 0.0000005 },
          ],
        },
  );
  const stop = startAnonymousUsage({ status });
  try {
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status).not.toHaveBeenCalled();
    vi.setSystemTime(midnight - 1_000);
    setAnonymousUsageEnabled(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0]![1].body as string);
    expect(body).toEqual({
      installId: expect.any(String),
      days: [
        {
          date: "2026-11-07",
          tokens: 250,
          estimatedUsdMicros: 130,
          pricedTurns: 1,
          unpricedTurns: 1,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("private-");
    setAnonymousUsageEnabled(false);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});
