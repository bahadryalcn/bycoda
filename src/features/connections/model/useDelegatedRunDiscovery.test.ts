// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { delegatedDiscoveryFailure, useDelegatedRunDiscovery } from "./useDelegatedRunDiscovery";
import { resetSessionsStore } from "../../sessions/model/sessionsStore";
import type { Session } from "../../sessions/model/session";

const discover = vi.hoisted(() => vi.fn(async (_parent: { id: string }) => []));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./delegatedRunDiscovery", () => ({ discoverDelegatedRuns: discover }));
function Probe({ id }: { id: string }) {
  useDelegatedRunDiscovery(id, true);
  return null;
}
it("discovers historical children after delegation settings are removed, without querying a child as a parent", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const marker = JSON.stringify({
    parentSessionId: "p",
    runId: "r",
    kind: "advisor",
    model: "m",
    startedAt: 1,
  });
  resetSessionsStore([
    { id: "p", cwd: "/p", modelSettings: {} } as Session,
    { id: "c", cwd: "/p", modelSettings: { delegationParent: marker } } as Session,
  ]);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe, { id: "p" })));
    expect(discover).toHaveBeenCalledOnce();
    expect(discover.mock.calls[0][0].id).toBe("p");
    discover.mockClear();
    await act(async () => root.render(createElement(Probe, { id: "c" })));
    expect(discover).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    resetSessionsStore([]);
    vi.unstubAllGlobals();
  }
});

it.each([
  "Host rejected request: Host read capacity is busy; retry later.",
  "RPC_WS_OVERLOAD: Host read capacity is busy; retry later.",
  "RPC_WS_INTERRUPTED: Host connection ended before the result was known",
  "Machine is unreachable. Check that it is on.",
])("leaves a busy or unreachable machine to the next poll: %s", (text) => {
  expect(delegatedDiscoveryFailure(new Error(text))).toBeUndefined();
});

it("reports a failure of the check itself without the Host prefix", () => {
  expect(delegatedDiscoveryFailure("Host rejected request: Project is not registered")).toBe(
    "Project is not registered",
  );
});
