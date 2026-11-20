// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  recordRemoteConnection,
  reportRemoteLoad,
  resetRemoteHealth,
  useRemoteLoadFailure,
} from "./remoteHealth";
import { remotePath } from "./remoteProjects";
import type { RemoteFailure } from "./remoteFailure";

const CWD = remotePath("env", "G:/Projects/repo");
let container: HTMLDivElement;
let root: Root;
let seen: RemoteFailure | undefined;
const Probe = ({ source }: { source: string }) => {
  seen = useRemoteLoadFailure(CWD, source);
  return null;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRemoteHealth();
  seen = undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// Reads are paused while the machine is offline, so no view reports its own failure; the
// view that keeps its data still has to show why it is dimmed.
it("gives a view an unreachable failure while its machine is offline, though it never failed", async () => {
  await act(async () => root.render(createElement(Probe, { source: "files" })));
  expect(seen).toBeUndefined();

  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));
  expect(seen?.kind).toBe("unreachable");

  await act(async () => recordRemoteConnection("env"));
  expect(seen).toBeUndefined();
});

it("prefers the failure a view reported itself", async () => {
  await act(async () => root.render(createElement(Probe, { source: "files" })));
  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));
  await act(async () => reportRemoteLoad(CWD, "files", new Error("Unsupported host method")));

  expect(seen?.kind).toBe("outdated");
});
