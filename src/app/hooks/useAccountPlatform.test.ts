// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteMachine } from "../../features/connections/model/protocol";

const { machines, tracker, sync, approval, summary } = vi.hoisted(() => ({
  machines: { current: [] as RemoteMachine[] },
  tracker: vi.fn(),
  sync: vi.fn(),
  approval: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("../../features/connections/public/connections", () => ({
  useRemoteMachines: () => ({ machines: machines.current }),
}));
vi.mock("../../features/account", () => ({
  accountApi: () => ({}),
  accountDeviceInfo: () => ({}),
  accountIdentity: () => ({}),
  accountNotificationsPort: () => ({}),
  reportAccountFailure: () => undefined,
  startAccount: () => Promise.resolve(),
  useAnonymousStats: () => undefined,
  accountSharingDestination: async () => null,
  useAccountState: () => ({ phase: "signed-out" }),
}));
vi.mock("../../features/diagnostics", () => ({ useDiagnostics: () => undefined }));
vi.mock("../../features/activity", () => ({
  useActivityTracker: tracker,
  useActivitySync: sync,
}));
vi.mock("../../features/notifications", () => ({
  bindNotificationsServer: () => undefined,
  useOwnerApprovalMirror: approval,
  useServerNotifications: () => undefined,
}));
vi.mock("../../features/notifications/hooks/useDailySummary", () => ({
  useDailySummary: summary,
}));
vi.mock("../model/diagnosticsFacts", () => ({
  appDiagnosticsFacts: () => ({}),
  readLocalHostPerformance: () => undefined,
  remoteHostLogSource: () => undefined,
}));

import { useAccountPlatform } from "./useAccountPlatform";

const local: RemoteMachine = {
  id: "local-host",
  name: "This computer",
  endpoint: "http://127.0.0.1:4100",
  localHost: true,
} as RemoteMachine;
const remote: RemoteMachine = {
  id: "remote-host",
  name: "Build server",
  endpoint: "https://server.example.com",
} as RemoteMachine;

let root: Root;

function Harness() {
  useAccountPlatform();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("never targets a remote machine for activity or the owner mirror without a local Host", async () => {
  machines.current = [remote];
  await act(async () => root.render(createElement(Harness)));
  expect(tracker).toHaveBeenLastCalledWith(undefined);
  expect(sync).toHaveBeenLastCalledWith(undefined, expect.any(Function), expect.anything());
  expect(approval).toHaveBeenLastCalledWith(undefined);
  expect(summary).toHaveBeenLastCalledWith(undefined);
});

it("targets the local Host even when a remote machine sorts first", async () => {
  machines.current = [remote, local];
  await act(async () => root.render(createElement(Harness)));
  expect(tracker).toHaveBeenLastCalledWith("local-host");
  expect(sync).toHaveBeenLastCalledWith("local-host", expect.any(Function), expect.anything());
  expect(approval).toHaveBeenLastCalledWith("local-host");
  expect(summary).toHaveBeenLastCalledWith("local-host");
});
