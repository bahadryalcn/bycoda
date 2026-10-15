import { describe, expect, it, vi } from "vitest";
import { APP_UI_VIEWS, APP_UI_SETTINGS, registerAppUiControl, requestAppUi } from "./appUiControl";
const context = { cwd: "G:/project", sessionId: "owner", title: "Owner" };
describe("direct workspace navigation boundary", () => {
  it("rejects protected fields, unknown surfaces and settings on other views before dispatch", async () => {
    const handler = vi.fn(async () => ({}));
    const dispose = registerAppUiControl(handler);
    try {
      for (const input of [
        { view: "unknown" },
        { view: "notes", section: "providers" },
        { view: "settings", section: "unknown" },
        { view: "tasks", cwd: "foreign" },
        { view: "settings", permissions: "full" },
      ])
        await expect(requestAppUi(context, "ui.workspace.open", input)).rejects.toThrow("field");
      await expect(requestAppUi(context, "ui.workspace.status", { view: "notes" })).rejects.toThrow(
        "field",
      );
      expect(handler).not.toHaveBeenCalled();
      expect(APP_UI_VIEWS).toContain("tasks");
      expect(APP_UI_SETTINGS).toContain("connections");
    } finally {
      dispose();
    }
  });
  it("serializes navigation through acknowledgement and preserves owner context", async () => {
    let acknowledge!: () => void;
    const gate = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const calls: string[] = [];
    const dispose = registerAppUiControl(async (owner, action, input) => {
      expect(owner).toEqual(context);
      calls.push(`${action}:${input.view}`);
      if (input.view === "tasks") await gate;
      return { view: input.view, mounted: true };
    });
    try {
      const first = requestAppUi(context, "ui.workspace.open", { view: "tasks" });
      const second = requestAppUi(context, "ui.workspace.open", {
        view: "settings",
        section: "connections",
      });
      await vi.waitFor(() => expect(calls).toEqual(["ui.workspace.open:tasks"]));
      acknowledge();
      await expect(first).resolves.toEqual({ view: "tasks", mounted: true });
      await expect(second).resolves.toEqual({ view: "settings", mounted: true });
    } finally {
      acknowledge();
      dispose();
    }
    await expect(requestAppUi(context, "ui.workspace.open", { view: "notes" })).rejects.toThrow(
      "not mounted",
    );
  });
});
