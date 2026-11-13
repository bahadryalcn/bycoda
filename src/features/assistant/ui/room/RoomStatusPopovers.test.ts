// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RoomStatusPopovers } from "./RoomStatusPopovers";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";

const room = vi.hoisted(() => ({
  healthAnchor: {} as HTMLElement,
  presenceAnchor: null,
  readError: "Host disconnected",
  roomPrivacy: { pending: false },
}));
vi.mock("./assistantRoomContext", () => ({ useAssistantRoom: () => room }));
vi.mock("../../../../shared/ui/Popover", () => ({ Popover: ({ children }: any) => children }));
vi.mock("../AssistantKeepAwakeStatus", () => ({ AssistantKeepAwakeStatus: () => null }));
vi.mock("../AssistantPresenceStatus", () => ({
  AssistantPresenceStatus: ({ offline }: any) =>
    createElement("span", null, offline ? "Offline" : "Here"),
}));

it("shows read failure as offline inside the health popover, then recovers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const snapshot = { lastHeartbeatAt: 1, usage: { total: 0 } } as AssistantSnapshot;
  try {
    await act(async () => root.render(createElement(RoomStatusPopovers, { snapshot })));
    expect(container.textContent).toContain("Offline");
    room.readError = "";
    await act(async () => root.render(createElement(RoomStatusPopovers, { snapshot })));
    expect(container.textContent).toContain("Here");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
