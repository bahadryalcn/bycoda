import { afterEach, expect, it, vi } from "vitest";
import { registerToolsUiControl, requestToolsUi } from "./toolsUiControl";
let dispose = () => {};
afterEach(() => dispose());
const context = { cwd: "/project", sessionId: "session", title: "Conversation" };
it("validates the narrow UI contract and passes explicit targets to the registered executor", async () => {
  const executor = vi.fn(async () => ({ open: true, placement: "right" as const, panels: [] }));
  dispose = registerToolsUiControl(executor);
  await requestToolsUi(context, "ui.tools.open", {
    tab: "devices",
    placement: "right",
    machineId: "mac",
  });
  expect(executor).toHaveBeenCalledWith(context, "ui.tools.open", {
    tab: "devices",
    placement: "right",
    machineId: "mac",
  });
  for (const [action, input] of [
    ["ui.tools.open", { cwd: "/foreign" }],
    ["ui.tools.place", {}],
    ["ui.tools.close", { sessionId: "foreign" }],
    ["ui.tools.open", { placement: "diagonal" }],
    ["ui.tools.open", { tab: "tasks" }],
    ["ui.tools.eval", { code: "anything" }],
  ])
    await expect(
      requestToolsUi(context, action as string, input as Record<string, unknown>),
    ).rejects.toThrow();
  expect(executor).toHaveBeenCalledTimes(1);
});
it("does not retain a closed workspace handler or claim an unavailable panel is open", async () => {
  const first = registerToolsUiControl(async () => ({
    open: false,
    placement: "left",
    panels: [],
  }));
  dispose = registerToolsUiControl(async () => ({ open: false, placement: "right", panels: [] }));
  first();
  expect((await requestToolsUi(context, "ui.tools.status", {})).placement).toBe("right");
  dispose();
  await expect(requestToolsUi(context, "ui.tools.open", {})).rejects.toThrow("not mounted");
});
