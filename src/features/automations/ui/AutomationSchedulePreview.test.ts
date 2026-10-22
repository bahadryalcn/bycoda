// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { createAutomationTrigger } from "../model/automations";
import { TriggerRow } from "./AutomationsView";

it("uses host time and timezone for unsaved schedules and rejects a stale machine response", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  const schedule = createAutomationTrigger("time", "daily", { time: "09:00" });
  let stale!: (value: unknown) => void;
  invoke.mockImplementation((_command, args) =>
    args.machineId === "old"
      ? new Promise((resolve) => {
          stale = resolve;
        })
      : Promise.resolve({ timeZone: "UTC", nextRunAt: Date.parse("2026-10-20T09:00:00Z") }),
  );
  const render = async (machineId: string) =>
    act(async () =>
      root.render(
        createElement(TriggerRow, {
          trigger: schedule,
          cwd: "/project",
          background: true,
          machineId,
          onChange: vi.fn(),
          onRemove: vi.fn(),
        }),
      ),
    );
  try {
    await render("old");
    expect(host.textContent).toContain("Execution host timezone unavailable");
    await render("current");
    expect(host.textContent).toContain("UTC");
    expect(host.textContent).toContain("9:00");
    expect(invoke).toHaveBeenLastCalledWith(
      "remote_request",
      expect.objectContaining({
        machineId: "current",
        method: "automations.preview",
        params: { schedule },
      }),
    );
    await act(async () => stale({ timeZone: "Europe/Istanbul", nextRunAt: 1 }));
    expect(host.textContent).not.toContain("Europe/Istanbul");
    invoke.mockRejectedValue(new Error("Old host"));
    await render("outdated");
    expect(host.textContent).toContain("Host schedule preview unavailable");
    expect(host.textContent).not.toContain("Next run");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
