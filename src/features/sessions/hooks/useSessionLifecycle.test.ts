// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRemoteSessionLifecycleLists } from "./useSessionLifecycle";

const remoteRequest = vi.hoisted(() => vi.fn());
vi.mock("../../connections/public/connections", () => ({ remoteRequest }));

const owner = [{ userId: null, role: "owner" as const }];
const autoSettle = { afterDays: 7, archiveAfterDays: 30 };
const callsFor = (machineId: string) =>
  remoteRequest.mock.calls.filter(([machine]) => machine === machineId).length;

let container: HTMLDivElement;
let root: Root;

function Probe() {
  useRemoteSessionLifecycleLists(JSON.stringify(["busy", "idle"]));
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  remoteRequest.mockReset();
  remoteRequest.mockImplementation(async (machineId: string) => ({
    records: [
      {
        sessionId: `${machineId}-session`,
        state: machineId === "busy" ? "settling" : "active",
        participants: owner,
      },
    ],
    autoSettle,
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("polls only the Host with a settling session at 3 s and keeps the other subscription", async () => {
  await act(async () => root.render(createElement(Probe)));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  // After the first answer "busy" switched to its fast subscription (one extra initial read).
  const idleAfterMount = callsFor("idle");
  expect(idleAfterMount).toBe(1);

  const busyBefore = callsFor("busy");
  await act(async () => vi.advanceTimersByTimeAsync(9_000));
  expect(callsFor("busy") - busyBefore).toBeGreaterThanOrEqual(3);
  expect(callsFor("idle")).toBe(idleAfterMount);

  await act(async () => vi.advanceTimersByTimeAsync(51_000));
  expect(callsFor("idle")).toBe(idleAfterMount + 1);
});
