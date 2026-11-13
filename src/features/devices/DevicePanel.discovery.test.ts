// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DevicePanel } from "./DevicePanel";
import type { DeviceHostStatus, DevicePanelApi } from "./types";
import {
  readToolsDraftTransfer,
  restoreToolsDraftTransfer,
} from "../host-tools/toolsDraftTransfer";

const status: DeviceHostStatus = {
  running: true,
  installed: true,
  agentInstalled: true,
  controlProtocol: 1,
  platform: "win32",
  platforms: [{ platform: "android", available: true }],
};
const first = {
  id: "first",
  name: "First phone",
  platform: "android" as const,
  version: "16",
  booted: true,
  physical: true,
};
const second = { ...first, id: "second", name: "Second phone", physical: false };
const frame = {
  mime: "image/png" as const,
  base64: "retained-second",
  capturedAt: "2026-11-13T00:00:00Z",
};
const makeApi = (): DevicePanelApi => ({
  status: vi.fn().mockResolvedValue(status),
  setup: vi.fn().mockResolvedValue(status),
  start: vi.fn().mockResolvedValue(status),
  stop: vi.fn().mockResolvedValue({ ...status, running: false }),
  list: vi.fn().mockResolvedValue({ devices: [first, second], errors: [] }),
  boot: vi.fn().mockResolvedValue(second),
  capture: vi.fn().mockResolvedValue(frame),
  action: vi.fn().mockResolvedValue("Done"),
  claimControl: vi.fn(),
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find(
    (element) => (element.getAttribute("aria-label") ?? element.textContent) === label,
  )!;
const click = (label: string) => act(async () => button(label).click());
function restore() {
  const scope = { cwd: "/repo", sessionId: crypto.randomUUID(), targetValue: "project" };
  restoreToolsDraftTransfer(scope.cwd, scope.sessionId, scope.targetValue, {
    device: {
      selected: second.id,
      app: "saved.app",
      text: "Unsent Turkish taslak 🧭",
      zoom: 1,
      annotating: true,
      annotationTool: "pin",
      annotations: {
        [second.id]: {
          frame,
          document: { marks: [] },
          undo: [],
          redo: [],
          comment: "Retained note",
        },
      },
    },
  });
  return scope;
}

it("retains the restored target and frame through pending and failed status, then discovers that target", async () => {
  const scope = restore();
  const api = makeApi();
  let reject!: (error: Error) => void;
  vi.mocked(api.status).mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  await act(async () => root.render(createElement(DevicePanel, { api, transferScope: scope })));
  const retained = () =>
    readToolsDraftTransfer(scope.cwd, scope.sessionId, scope.targetValue)!.device;
  expect(retained()).toMatchObject({ selected: second.id, text: "Unsent Turkish taslak 🧭" });
  expect(retained()!.annotations[second.id].frame).toEqual(frame);
  await act(async () => reject(new Error("Status unavailable")));
  expect(retained()!.selected).toBe(second.id);
  expect(api.list).not.toHaveBeenCalled();
  await click("Retry");
  expect(retained()!.selected).toBe(second.id);
  expect(container.textContent).toContain("Second phone");
  expect(api.claimControl).not.toHaveBeenCalled();
});

it("keeps confirmed stopped-runtime cleanup without discarding the annotation draft", async () => {
  const scope = restore();
  const api = makeApi();
  vi.mocked(api.status).mockResolvedValue({ ...status, running: false });
  await act(async () => root.render(createElement(DevicePanel, { api, transferScope: scope })));
  const retained = readToolsDraftTransfer(scope.cwd, scope.sessionId, scope.targetValue)!.device!;
  expect(retained.selected).toBe("");
  expect(retained.annotations[second.id].frame).toEqual(frame);
  expect(api.list).not.toHaveBeenCalled();
  expect(api.claimControl).not.toHaveBeenCalled();
});

it("shows an unknown discovery count while pending or failed, and zero only after a successful empty list", async () => {
  const api = makeApi();
  let reject!: (error: Error) => void;
  vi.mocked(api.list).mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await click("Device options");
  await click("Setup and access");
  const summary = () => document.querySelector(".device-panel-setup-summary")!.textContent;
  expect(summary()).not.toContain("0 devices found");
  expect(summary()).toContain("Devices · Unknown");
  await act(async () => reject(new Error("Discovery unavailable")));
  if (!document.querySelector(".device-panel-setup-summary")) {
    await click("Device options");
    await click("Setup and access");
  }
  expect(summary()).not.toContain("0 devices found");
  expect(summary()).toContain("Devices · Unknown");
  vi.mocked(api.list).mockResolvedValue({ devices: [], errors: [] });
  await click("Refresh devices");
  if (!document.querySelector(".device-panel-setup-summary")) {
    await click("Device options");
    await click("Setup and access");
  }
  expect(summary()).toContain("0 devices found");
});
