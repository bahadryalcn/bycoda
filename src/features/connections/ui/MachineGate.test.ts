// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));

import { adoptRemoteMachineInventory } from "../model/connections";
import { resetMachineAvailability } from "../model/machineAvailability";
import { recordRemoteConnection, resetRemoteHealth } from "../model/remoteHealth";
import { remotePath } from "../model/remoteProjects";
import { MachineGate } from "./MachineUnavailable";

const CWD = remotePath("env", "G:/Projects/repo");
const MACHINE = { id: "m1", name: "Desk", endpoint: "http://desk", environmentId: "env" };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetRemoteHealth();
  resetMachineAvailability();
  adoptRemoteMachineInventory([MACHINE]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  adoptRemoteMachineInventory([]);
  vi.unstubAllGlobals();
});

const content = () => container.querySelector("[data-content]");
const notice = () => container.querySelector("[data-machine-unavailable]");
const mount = (hasData: boolean) =>
  act(async () =>
    root.render(
      createElement(
        MachineGate,
        { cwd: CWD, hasData: () => hasData, children: null },
        createElement("div", { "data-content": "" }),
      ),
    ),
  );

it("keeps a pane that has data while the machine is offline", async () => {
  await mount(true);
  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));

  expect(content()).not.toBeNull();
  expect(notice()).toBeNull();
});

it("shows the notice for an offline machine when the pane has nothing loaded", async () => {
  await mount(false);
  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));

  expect(content()).toBeNull();
  expect(notice()?.getAttribute("data-machine-unavailable")).toBe("offline");
});

it("shows the notice over cached data when the machine refuses this computer", async () => {
  await mount(true);
  await act(async () =>
    recordRemoteConnection("env", "Host rejected request [RPC_AUTHORIZATION] (401)"),
  );

  expect(content()).toBeNull();
  expect(notice()?.getAttribute("data-machine-unavailable")).toBe("pairing-refused");
});

it("shows the notice over cached data for a machine that is not added", async () => {
  await mount(true);
  await act(async () => adoptRemoteMachineInventory([]));

  expect(content()).toBeNull();
  expect(notice()?.getAttribute("data-machine-unavailable")).toBe("not-added");
});

it("shows the content again once the machine answers", async () => {
  await mount(false);
  await act(async () => recordRemoteConnection("env", "Machine is unreachable"));
  expect(notice()).not.toBeNull();

  await act(async () => recordRemoteConnection("env"));

  expect(content()).not.toBeNull();
  expect(notice()).toBeNull();
});

it("shows a side panel as one line and the page with its explanation", async () => {
  await act(async () => adoptRemoteMachineInventory([]));
  const render = (size: "page" | "panel") =>
    act(async () =>
      root.render(
        createElement(MachineGate, {
          cwd: CWD,
          hasData: () => false,
          size,
          children: createElement("div"),
        }),
      ),
    );

  await render("panel");
  expect(notice()?.querySelector("button, img")).toBeNull();
  expect(notice()?.textContent).not.toContain("Add it in Connections");

  await render("page");
  expect(notice()?.querySelector("img")).not.toBeNull();
  expect(notice()?.querySelector("button")).not.toBeNull();
  expect(notice()?.textContent).toContain("Add it in Connections");
});
