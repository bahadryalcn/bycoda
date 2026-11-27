import { describe, expect, it, vi } from "vitest";
import { SETTINGS_SECTIONS } from "../../features/settings/model/settings";
import {
  APP_UI_GLOBAL_VIEWS,
  APP_UI_SETTINGS,
  APP_UI_VIEWS,
  registerAppUiControl,
  requestAppUi,
} from "./appUiControl";
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
      expect(APP_UI_VIEWS).toContain("servers");
      await expect(
        requestAppUi(context, "ui.workspace.open", { view: "servers" }),
      ).resolves.toEqual({});
      await expect(
        requestAppUi(context, "ui.workspace.close", { view: "servers" }),
      ).resolves.toEqual({});
      expect(APP_UI_SETTINGS).toContain("connections");
    } finally {
      dispose();
    }
  });
  it("allows session-owned terminal lifecycle without commands, identity or approval overrides", async () => {
    const handler = vi.fn(async () => ({}));
    const dispose = registerAppUiControl(handler);
    try {
      for (const input of [
        {},
        { requestId: "bad/id" },
        { requestId: "request", cwd: "/foreign" },
        { requestId: "request", command: "run" },
      ])
        await expect(requestAppUi(context, "terminals.create", input)).rejects.toThrow("field");
      for (const input of [
        {},
        { terminalId: "own", force: true },
        { terminalId: "own", approved: true },
      ])
        await expect(requestAppUi(context, "terminals.close", input)).rejects.toThrow("field");
      expect(handler).not.toHaveBeenCalled();
      await expect(
        requestAppUi(context, "terminals.create", { requestId: "request" }),
      ).resolves.toEqual({});
      await expect(
        requestAppUi(context, "terminals.close", { terminalId: "own" }),
      ).resolves.toEqual({});
    } finally {
      dispose();
    }
  });
  it("lets a window without a conversation open and close views but never act on sessions", async () => {
    const handler = vi.fn(async (..._args: unknown[]) => ({}));
    const dispose = registerAppUiControl(handler);
    const room = { cwd: "G:/project", window: true as const, title: "Room" };
    try {
      await expect(
        requestAppUi(room, "ui.workspace.open", { view: "settings", section: "voice" }),
      ).resolves.toEqual({});
      await expect(requestAppUi(room, "ui.workspace.close", { view: "settings" })).resolves.toEqual(
        {},
      );
      await expect(requestAppUi(room, "ui.workspace.status", {})).resolves.toEqual({});
      expect(handler).toHaveBeenCalledTimes(3);
      expect(handler.mock.calls[0]?.[0]).toEqual(room);
      for (const action of ["terminals.create", "terminals.close", "terminals.pty.guard"]) {
        await expect(
          requestAppUi(room, action, { terminalId: "own", requestId: "r" }),
        ).rejects.toThrow("Unsupported workspace UI request.");
      }
      expect(handler).toHaveBeenCalledTimes(3);
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

describe("navigation registry", () => {
  it("declares every real settings section and nothing retired", () => {
    expect([...APP_UI_SETTINGS].sort()).toEqual(
      SETTINGS_SECTIONS.map((section) => section.id).sort(),
    );
    expect(APP_UI_SETTINGS).not.toContain("inbox");
    expect(APP_UI_SETTINGS).not.toContain("models");
    expect(APP_UI_SETTINGS).not.toContain("work");
  });

  it("declares the crews, assistant and conversation-tools views the status already reports", () => {
    for (const view of ["crews", "assistant", "conversation-tools"])
      expect(APP_UI_VIEWS).toContain(view);
    for (const view of APP_UI_GLOBAL_VIEWS) expect(APP_UI_VIEWS).toContain(view);
    expect([...APP_UI_GLOBAL_VIEWS]).toEqual(["settings", "search", "inbox", "assistant"]);
  });

  it("accepts the projectless global Room for global views only, without any identity", async () => {
    const handler = vi.fn(async () => ({}));
    const dispose = registerAppUiControl(handler);
    const room = { global: true as const, title: "Room" };
    try {
      await expect(
        requestAppUi(room, "ui.workspace.open", { view: "settings", section: "permissions" }),
      ).resolves.toEqual({});
      await expect(requestAppUi(room, "ui.workspace.status", {})).resolves.toEqual({});
      for (const input of [{ view: "settings", section: "inbox" }, { view: "tasks" }])
        await expect(requestAppUi(room, "ui.workspace.open", input)).rejects.toThrow("field");
      for (const action of ["terminals.create", "terminals.close", "terminals.pty.guard"])
        await expect(
          requestAppUi(room, action, { requestId: "r", terminalId: "t" }),
        ).rejects.toThrow("Unsupported workspace UI request.");
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith(room, "ui.workspace.status", {});
    } finally {
      dispose();
    }
  });
});
