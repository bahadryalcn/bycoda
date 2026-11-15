// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listOtherComputers } from "../../account";
import { DiscoveredMachines } from "./DiscoveredMachines";
import type { MachineCandidate } from "../model/machineCandidates";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
const account = vi.hoisted(() => ({
  state: { phase: "signed-out" } as { phase: string; deviceId?: string },
  request: (async () => undefined) as (...args: unknown[]) => Promise<unknown>,
}));
vi.mock("../../account", () => ({
  useAccountState: () => account.state,
  useAccount: () => ({ signIn: async () => undefined }),
  isSignedIn: (state: { phase: string }) => state.phase === "signed-in",
  listOtherComputers: vi.fn(async () => []),
  accountApi: () => ({}),
  accountDeviceInfo: async () => ({ name: "Laptop" }),
  reportAccountFailure: async () => undefined,
  requestDesktopPair: (...args: unknown[]) => account.request(...args),
}));

let container: HTMLDivElement;
let root: Root;
const native: MachineCandidate = {
  key: "ssh:box",
  name: "box",
  sources: ["ssh-config"],
  routes: [{ address: "box", kind: "name" }],
  sshUser: "me",
  alreadyAdded: false,
};
const onAdd = vi.fn();
const onPaired = vi.fn();

async function render(candidates: MachineCandidate[] | "missing") {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "discover_machine_candidates" && candidates !== "missing") return candidates;
    throw new Error("unknown command");
  });
  await act(async () => {
    root.render(
      createElement(DiscoveredMachines, { saved: [], active: true, busy: false, onAdd, onPaired }),
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onAdd.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("lists a native candidate and adds it with its address prefilled", async () => {
  await render([native]);
  expect(container.textContent).toContain("box");
  expect(container.textContent).toContain("SSH config");
  const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add")!;
  await act(async () => add.click());
  expect(onAdd).toHaveBeenCalledWith({ target: "me@box", alternate: null, name: "box" });
});

it("shows the sign-in prompt and an empty state when nothing is found or the command is missing", async () => {
  await render("missing");
  expect(container.textContent).toContain("Sign in to also find computers on your account.");
  expect(container.textContent).not.toContain("Add");
});

it("hides machines that are already added", async () => {
  await render([{ ...native, alreadyAdded: true }]);
  expect(container.textContent).not.toContain("SSH config");
});

const studio = {
  deviceId: "dev-1",
  name: "Studio",
  platform: "windows",
  environmentId: "env-1",
  routes: [{ endpoint: "https://studio.tailnet.ts.net" }],
  lastSeenAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const addButton = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Add")!;
const dialogText = () => document.body.textContent ?? "";

it("adds an account-only computer through the account: shows the code, then the connected state", async () => {
  account.state = { phase: "signed-in", deviceId: "me-1" };
  vi.mocked(listOtherComputers).mockResolvedValue([studio] as never);
  let finish!: (value: unknown) => void;
  account.request = async () => ({
    code: "482913",
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    outcome: new Promise((resolve) => (finish = resolve)),
    cancel: vi.fn(),
  });
  await render([]);
  expect(addButton().disabled).toBe(false);
  expect(container.textContent).not.toContain("no SSH address");
  await act(async () => addButton().click());
  expect(dialogText()).toContain("482913");
  expect(dialogText()).toContain("Allow it on {name}");
  expect(onAdd).not.toHaveBeenCalled();

  // The other computer says no: the dialog says so and offers another try.
  await act(async () => finish({ state: "denied" }));
  expect(dialogText()).toContain("The other computer said no.");
  expect(dialogText()).toContain("Try again");
});

it("keeps Add disabled for an account computer without a published https route", async () => {
  account.state = { phase: "signed-in", deviceId: "me-1" };
  vi.mocked(listOtherComputers).mockResolvedValue([{ ...studio, routes: [] }] as never);
  await render([]);
  expect(addButton().disabled).toBe(true);
});
