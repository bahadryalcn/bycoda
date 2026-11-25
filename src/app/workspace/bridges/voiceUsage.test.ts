// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceWorkspaceActions } from "./useVoiceWorkspaceActions";
import { createVoiceInspectPorts } from "./voiceInspectPorts";
import { registerAppUiControl } from "../../model/appUiControl";
import type { VoiceWorkspaceActionsDeps } from "../../../features/voice/model/voiceWorkspaceActions";
import { voiceUsageReportOf } from "../../../features/voice/model/voiceWorkspaceUsage";
import type { UsageReport } from "../../../features/usage/public/usageReport";
import {
  subscribeUsageViewIntent,
  takeUsageViewIntent,
} from "../../../features/usage/model/usageViewIntent";
import { openUsageDashboard } from "../../../features/usage/data/openUsageDashboard";
import { OPEN_SETTINGS_EVENT } from "../../../features/settings/model/settingsLink";
import { pathKey } from "../../../shared/lib/paths";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// A pass-through spy: one case makes the navigation itself fail.
vi.mock("../../../features/usage/data/openUsageDashboard", async (original) => {
  const actual = await original<typeof import("../../../features/usage/data/openUsageDashboard")>();
  return { openUsageDashboard: vi.fn(actual.openUsageDashboard) };
});
const cleanup: (() => void)[] = [];

const report = (patch: Partial<UsageReport> = {}) =>
  ({
    period: "last-30-days",
    metric: "cost",
    costBasis: "api-equivalent-estimate",
    timeZone: "UTC",
    window: { startMs: 5, endMs: 9, start: "", end: "" },
    filters: { model: "gpt-5" },
    totals: {
      cost: 1,
      tokens: 2,
      input: 2,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      durationMs: 0,
      unpricedTokens: 0,
    },
    providers: [],
    models: [],
    projects: [],
    coverage: {
      partial: false,
      accounts: { read: 1, failed: 0 },
      sessionTurns: "available",
      notes: [],
    },
    ...patch,
  }) as UsageReport;

function setup(inspect: VoiceWorkspaceActionsDeps["inspect"] = {}) {
  return createVoiceWorkspaceActions(() => ({
    getProjects: () => [{ path: "/project" }],
    getSessions: () => [],
    getActiveSessionId: () => "first",
    getProjectPath: () => "/project",
    inspect,
  }));
}
let unregister: (() => void) | undefined;
afterEach(() => {
  unregister?.();
  while (cleanup.length) cleanup.pop()?.();
  takeUsageViewIntent();
});

describe("voice usage tools", () => {
  it("lists the read and open tools with closed enums", () => {
    const tools = setup().tools.filter((tool) => tool.name.startsWith("workspace.usage."));
    expect(tools.map((tool) => tool.name)).toEqual([
      "workspace.usage.report",
      "workspace.usage.open",
    ]);
    expect(tools[0].parameters.properties.period).toMatchObject({
      enum: ["month-to-date", "last-30-days", "monthly-history"],
    });
    expect(tools[0].parameters.required).toEqual(["period"]);
  });

  it("returns the real report, the dashboard request and a report the call can draw", async () => {
    const read = vi.fn(async () => report());
    const result = await setup({ usage: { read } }).execute("workspace.usage.report", {
      period: "last-30-days",
      provider: "codex",
    });
    expect(read).toHaveBeenCalledWith({
      period: "last-30-days",
      metric: "cost",
      provider: "codex",
    });
    expect(result).toMatchObject({
      status: "completed",
      partial: false,
      dashboard: {
        action: "workspace.usage.open",
        input: { period: "last-30-days", metric: "cost", provider: "codex" },
      },
    });
    expect(voiceUsageReportOf(result)?.totals.tokens).toBe(2);
    // A lookalike from another action or a failed call is never drawn.
    expect(voiceUsageReportOf({ ...result, action: "workspace.today.read" })).toBeUndefined();
    expect(voiceUsageReportOf({ ...result, status: "rejected" })).toBeUndefined();
  });

  it("refuses locked or hidden projects, bad periods and unknown filters without reading", async () => {
    const read = vi.fn(async () => report());
    const { execute } = setup({ usage: { read } });
    const hidden = await execute("workspace.usage.report", {
      period: "month-to-date",
      projectPath: "/locked",
    });
    expect(hidden).toMatchObject({ status: "rejected", error: expect.stringContaining("locked") });
    expect((await execute("workspace.usage.report", { period: "forever" })).status).toBe(
      "rejected",
    );
    expect(
      (await execute("workspace.usage.report", { period: "month-to-date", months: 3 })).status,
    ).toBe("rejected");
    expect(read).not.toHaveBeenCalled();
    const unknown = await setup({
      usage: {
        read: async () => ({
          error: "unknown-filter",
          dimension: "model",
          value: "x",
          available: ["GPT-5"],
        }),
      },
    }).execute("workspace.usage.report", { period: "month-to-date", model: "x" });
    expect(unknown).toMatchObject({ status: "rejected", error: expect.stringContaining("GPT-5") });
  });

  describe("opening the dashboard", () => {
    /** Stands in for the workspace settings opener and for the dashboard taking its intent. */
    function dashboard() {
      const opened: unknown[] = [];
      const taken: unknown[] = [];
      const open = (event: Event) => {
        opened.push((event as CustomEvent).detail);
        const page = document.createElement("div");
        page.dataset.settingsSection = "usage";
        page.getClientRects = () => [{}] as unknown as DOMRectList;
        document.body.append(page);
      };
      window.addEventListener(OPEN_SETTINGS_EVENT, open);
      const stop = subscribeUsageViewIntent(() => taken.push(takeUsageViewIntent()));
      cleanup.push(() => {
        window.removeEventListener(OPEN_SETTINGS_EVENT, open);
        stop();
        document.body.replaceChildren();
      });
      return { opened, taken };
    }
    const noSession = () =>
      createVoiceInspectPorts(() => ({
        projects: [{ path: "/project" }],
        sessions: [],
        projectPath: "/project",
        activeId: undefined,
      }));

    it("opens from Global with no active conversation, borrowing no session", async () => {
      const navigator = vi.fn(async () => ({}));
      unregister = registerAppUiControl(navigator);
      const { opened, taken } = dashboard();
      const ports = noSession();
      const result = await setup({
        ...ports,
        usage: { ...ports.usage, read: async () => report() },
      }).execute("workspace.usage.open", { period: "last-30-days", model: "gpt-5" });
      expect(result).toMatchObject({
        status: "completed",
        view: "settings",
        section: "usage",
        filtersApplied: true,
        filters: { model: "gpt-5" },
      });
      expect(opened).toEqual(["usage"]);
      expect(navigator).not.toHaveBeenCalled();
      expect(taken).toEqual([
        {
          preset: "30d",
          window: { start: 5, end: 9 },
          filters: { provider: [], account: [], model: ["gpt-5"], project: [], group: [] },
          metric: "cost",
          resolution: "day",
        },
      ]);
    });

    it("still opens with the window, metric and project when the summary cannot be read", async () => {
      const { taken } = dashboard();
      const ports = noSession();
      const result = await setup({
        ...ports,
        usage: {
          ...ports.usage,
          read: async () => {
            throw new Error("log scan failed");
          },
        },
      }).execute("workspace.usage.open", {
        period: "month-to-date",
        metric: "tokens",
        model: "gpt-5",
        projectPath: "/project",
      });
      expect(result).toMatchObject({
        status: "completed",
        summaryRead: false,
        filtersApplied: true,
        filtersSkipped: ["model"],
      });
      expect(taken).toHaveLength(1);
      expect(taken[0]).toMatchObject({
        preset: "custom",
        metric: "tokens",
        filters: { model: [], project: [pathKey("/project")] },
      });
    });

    it("keeps a failed navigation from leaving filters behind", async () => {
      vi.mocked(openUsageDashboard).mockRejectedValueOnce(
        new Error("The Usage dashboard did not open."),
      );
      const ports = noSession();
      const result = await setup({
        ...ports,
        usage: { ...ports.usage, read: async () => report() },
      }).execute("workspace.usage.open", { period: "last-30-days" });
      expect(result).toMatchObject({
        status: "rejected",
        error: expect.stringContaining("did not open"),
      });
      expect(takeUsageViewIntent()).toBeNull();
    });

    it("sends a failed report read to the dashboard path instead of the same read", async () => {
      const result = await setup({
        usage: {
          read: async () => {
            throw new Error("log scan failed");
          },
        },
      }).execute("workspace.usage.report", { period: "month-to-date" });
      expect(result).toMatchObject({
        status: "rejected",
        error: expect.stringContaining("workspace.usage.open"),
      });
    });
  });
});
