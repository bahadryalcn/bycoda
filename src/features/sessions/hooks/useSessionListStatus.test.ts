// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSessionListStatus } from "./useSessionListStatus";

let root: Root;
let remote: boolean;
let sessions: Parameters<typeof useSessionListStatus>[1];
let busy: Set<string>;
let approval: Set<string>;
let result: ReturnType<typeof useSessionListStatus>;
function Probe() {
  result = useSessionListStatus(remote, sessions, busy, approval);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  remote = true;
  sessions = [
    { id: "running", status: "running" },
    { id: "approval", status: "running", needsInput: true },
    { id: "idle", status: "idle" },
  ];
  busy = new Set(["local-busy"]);
  approval = new Set(["local-approval"]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps remote status sets stable on unrelated renders and updates changed status", async () => {
  await act(async () => root.render(createElement(Probe)));
  expect([...result.listedBusySessionIds]).toEqual(["running"]);
  expect([...result.listedApprovalSessionIds]).toEqual(["approval"]);
  const previous = result;
  await act(async () => root.render(createElement(Probe)));
  expect(result.listedBusySessionIds).toBe(previous.listedBusySessionIds);
  expect(result.listedApprovalSessionIds).toBe(previous.listedApprovalSessionIds);
  sessions = sessions.map((session) => ({ ...session, needsInput: false }));
  await act(async () => root.render(createElement(Probe)));
  expect([...result.listedBusySessionIds]).toEqual(["running", "approval"]);
  expect(result.listedApprovalSessionIds.size).toBe(0);
});

it("preserves local sources when switching away from a remote project", async () => {
  await act(async () => root.render(createElement(Probe)));
  remote = false;
  await act(async () => root.render(createElement(Probe)));
  expect(result.listedBusySessionIds).toBe(busy);
  expect(result.listedApprovalSessionIds).toBe(approval);
});
