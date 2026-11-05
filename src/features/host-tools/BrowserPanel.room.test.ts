// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BrowserPanel } from "./BrowserPanel";
const native = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: native, isTauri: () => true }));
vi.mock("../connections/model/hostFeatureClient", () => ({
  hostFeatureRequest: vi.fn(),
  hostToolRequest: vi.fn(),
}));

it("uses the exact Room identity without a fabricated session and drops a late private reply", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let valid = true,
    finish!: (value: unknown) => void;
  native.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const room = {
    kind: "room" as const,
    cwd: "/project",
    threadId: "room",
    projectId: "project",
    environmentId: "host",
    title: "Room",
    valid: () => valid,
  };
  await act(async () =>
    root.render(
      createElement(BrowserPanel, { cwd: room.cwd, roomSubject: room, annotationsAllowed: false }),
    ),
  );
  expect(native).toHaveBeenCalledWith(
    "control_room_browser_panel_request",
    expect.objectContaining({
      environmentId: "host",
      projectId: "project",
      threadId: "room",
      projectCwd: "/project",
      action: "browser.status",
    }),
  );
  expect(native.mock.calls[0][1]).not.toHaveProperty("sessionId");
  valid = false;
  await act(async () => finish({ open: true, url: "https://private.invalid", controlling: false }));
  expect(container.textContent).not.toContain("private.invalid");
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
