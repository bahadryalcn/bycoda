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
vi.mock("../../account", async () => ({
  watchPairingView: (await import("../../account/model/phoneConnectInbox")).watchPairingView,
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
      createElement(DiscoveredMachines, {
        saved: [],
        active: true,
        busy: false,
        onAdd,
        onPaired,
      }),
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onAdd.mockClear();
  account.state = { phase: "signed-out" };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
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

it("keeps confirmed native candidates through failed refreshes and skips overlapping ticks", async () => {
  vi.useFakeTimers();
  await render([native]);
  let rejectRefresh!: (reason: Error) => void;
  const read = vi.mocked(invoke);
  read.mockClear().mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectRefresh = reject;
      }),
  );
  const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
  await advance(30_000);
  expect(read).toHaveBeenCalledExactlyOnceWith("discover_machine_candidates");
  await act(async () => rejectRefresh(new Error("Discovery temporarily unavailable")));
  expect(container.textContent).toContain("SSH config");
  read.mockResolvedValueOnce([]);
  await advance(10_000);
  expect(read).toHaveBeenCalledTimes(2);
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
  expect(dialogText()).toContain("Allow it there");
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
  // A disabled control that explains why stays focusable, so it is aria-disabled.
  expect(addButton().getAttribute("aria-disabled")).toBe("true");
  await act(async () => addButton().click());
  expect(onAdd).not.toHaveBeenCalled();
  expect(dialogText()).not.toContain("Allow it there");
});

it("adds a home-network account computer over SSH when an SSH entry has its address", async () => {
  account.state = { phase: "signed-in", deviceId: "me-1" };
  vi.mocked(listOtherComputers).mockResolvedValue([
    {
      ...studio,
      routes: [{ endpoint: "http://192.168.2.108:61882", lanKey: "a".repeat(64) }],
    },
  ] as never);
  await render([
    {
      ...native,
      key: "known:192.168.2.108",
      name: "192.168.2.108",
      sources: ["known-hosts"],
      sshUser: "kraba",
      routes: [{ address: "192.168.2.108", kind: "lan" }],
    },
  ]);
  expect(container.querySelectorAll("button")).toHaveLength(1);
  await act(async () => addButton().click());
  expect(onAdd).toHaveBeenCalledWith({
    target: "kraba@192.168.2.108",
    alternate: null,
    name: "Studio",
    environmentId: "env-1",
  });
});

it("keeps machines that did not answer in a closed section until it is opened", async () => {
  await render([
    native,
    {
      ...native,
      key: "known:10.0.0.9",
      name: "10.0.0.9",
      sources: ["known-hosts"],
      routes: [{ address: "10.0.0.9", kind: "lan" }],
      online: false,
    },
  ]);
  expect(container.textContent).toContain("box");
  expect(container.textContent).toContain("Not reachable now");
  expect(container.textContent).not.toContain("10.0.0.9");
  const toggle = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Not reachable now"),
  )!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await act(async () => toggle.click());
  expect(container.textContent).toContain("10.0.0.9");
});

const many = Array.from({ length: 7 }, (_, index) => ({
  ...native,
  key: `ssh:box-${index}`,
  name: `box-${index}`,
  routes: [{ address: `box-${index}.lan`, kind: "name" as const }],
}));

it("shows every found machine, and a search field only for a long list", async () => {
  account.state = { phase: "signed-out" };
  vi.mocked(listOtherComputers).mockResolvedValue([]);
  await render(many.slice(0, 3));
  expect(container.querySelector("input")).toBeNull();
  // Remount: the list reads its candidates once per mount and then on a timer.
  await act(async () => root.render(null));
  await render(many);
  expect(container.textContent).toContain("box-0");
  expect(container.textContent).toContain("box-6");
  const search = container.querySelector<HTMLInputElement>("input")!;
  const type = async (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        value,
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

  await type("BOX-6.LAN");
  expect(container.textContent).toContain("box-6");
  expect(container.textContent).not.toContain("box-0");

  await type("nothing-like-this");
  expect(container.textContent).toContain("No matches");
});
