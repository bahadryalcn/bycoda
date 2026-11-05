// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ToolsWorkspace } from "./ToolsWorkspace";
import { requestToolsUi } from "./toolsUiControl";

const privacy = vi.hoisted(() => ({
  listener: undefined as (() => void) | undefined,
  pending: false,
}));
vi.mock("../group-lock/model/roomPrivacyProjection", () => ({
  getRoomPrivacyStatus: () => ({ pending: privacy.pending, error: null }),
  subscribeRoomPrivacyStatus: (listener: () => void) => {
    privacy.listener = listener;
    return () => {
      privacy.listener = undefined;
    };
  },
}));
vi.mock("./BrowserPanel", () => ({
  BrowserPanel: ({
    onMounted,
    roomSubject,
  }: {
    onMounted: () => void;
    roomSubject: { threadId: string };
  }) => {
    useEffect(() => {
      onMounted();
    }, [onMounted]);
    return createElement("div", { "data-room": roomSubject.threadId }, "Room browser");
  },
}));

it("mounts the exact Room panel and removes it when privacy becomes pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  privacy.pending = false;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(ToolsWorkspace, null, "workspace")));
  const context = {
    kind: "room" as const,
    cwd: "/project",
    threadId: "room",
    projectId: "project",
    environmentId: "host",
    title: "Room",
    valid: () => true,
  };
  let opened!: Promise<unknown>;
  await act(async () => {
    opened = requestToolsUi(context, "ui.tools.open", { tab: "browser", projectHost: true });
  });
  const state = (await opened) as { panels: { mounted?: boolean }[] };
  expect(state.panels[0].mounted).toBe(true);
  expect(container.querySelector('[data-room="room"]')).not.toBeNull();
  await act(async () => {
    privacy.pending = true;
    privacy.listener?.();
  });
  expect(container.querySelector('[data-room="room"]')).toBeNull();
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
