// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import * as clock from "../../../shared/lib/time/wallClock";
import * as accountState from "../../account";
import { ACCOUNT_CONTEXT } from "../../account/model/testFixtures";
import * as pairing from "../model/usePhonePairing";
import type { PairedDevice, PairedDeviceList } from "../model/pairedDevices";
import type { PhonePairingApi } from "../model/phonePairingTypes";
import type { RemoteMachine } from "../model/protocol";
import { PairedDevicesPanel } from "./PairedDevicesPanel";

const api = vi.hoisted(() => ({
  access: vi.fn<PhonePairingApi["access"]>(),
  enable: vi.fn<PhonePairingApi["enable"]>(),
  disable: vi.fn<NonNullable<PhonePairingApi["disable"]>>(),
  create: vi.fn<PhonePairingApi["create"]>(),
  status: vi.fn<PhonePairingApi["status"]>(),
  cancel: vi.fn<PhonePairingApi["cancel"]>(),
}));
const devices = vi.hoisted(() => ({
  loadPairedDevices: vi.fn<(machine: RemoteMachine) => Promise<PairedDeviceList>>(),
  canRevokePairedDevices: vi.fn<(machine: RemoteMachine) => Promise<boolean>>(),
  revokePairedDevice: vi.fn<(machine: RemoteMachine, device: PairedDevice) => Promise<void>>(),
}));
const health = vi.hoisted(() => ({
  read: vi.fn<(environmentId: string) => { status: string }>(),
}));
vi.mock("../model/remoteHealth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/remoteHealth")>()),
  readRemoteConnection: health.read,
}));
vi.mock("../model/phonePairingApi", () => ({ phonePairingApi: api }));
vi.mock("../model/pairedDevices", () => devices);
vi.mock("../../../shared/ui/Modal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui/Modal")>()),
  ModalActions: ({ children }: { children?: ReactNode }) =>
    createElement("div", { "data-modal-actions": "" }, children),
  Modal: ({
    children,
    footer,
    onClose,
  }: {
    children: ReactNode;
    footer?: ReactNode;
    onClose: () => void;
  }) =>
    createElement(
      "div",
      { role: "dialog" },
      createElement("button", { "aria-label": "Close", onClick: onClose }, "Close"),
      children,
      footer,
    ),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const local: RemoteMachine = {
  id: "local",
  name: "Local sync",
  localHost: true,
  endpoint: "http://127.0.0.1:3776",
  environmentId: "local-environment",
};
const remote: RemoteMachine = {
  id: "remote",
  name: "Home Mac",
  endpoint: "http://127.0.0.1:49000",
  environmentId: "remote-environment",
  ssh: { target: "owner@home-mac", remotePort: 3776 },
};
const desktop: PairedDevice = { id: "desk", name: "Desktop", isCurrent: true, kind: "desktop" };
const phone: PairedDevice = {
  id: "phone-1",
  name: "Pixel 9",
  isCurrent: false,
  kind: "phone",
  lastSeenAt: Date.now() - 60_000,
};

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await setLanguagePreference("en");
  for (const mock of [...Object.values(api), ...Object.values(devices)]) mock.mockReset();
  health.read.mockReset();
  health.read.mockReturnValue({ status: "connected" });
  api.access.mockImplementation(async (_machine, mode) =>
    mode === "lan"
      ? {
          state: "ready",
          mode: "lan",
          endpoint: "http://192.168.1.20:3777",
          lanKey: "ab".repeat(32),
          addresses: ["192.168.1.20"],
        }
      : { state: "ready", endpoint: "https://home.tail123.ts.net" },
  );
  api.disable.mockResolvedValue({ mode: "lan", state: "setup-required" });
  api.enable.mockResolvedValue({ state: "ready", endpoint: "https://home.tail123.ts.net" });
  api.create.mockImplementation(async (machine) => ({
    pairingId: `pair-${machine.id}`,
    ticket: "a".repeat(43),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    environmentId: machine.environmentId,
  }));
  api.status.mockResolvedValue({ state: "pending" });
  api.cancel.mockResolvedValue(undefined);
  devices.loadPairedDevices.mockImplementation(async (machine) =>
    machine.id === "local"
      ? { state: "ready", devices: [desktop, phone], truncated: false }
      : { state: "unsupported" },
  );
  devices.canRevokePairedDevices.mockResolvedValue(true);
  devices.revokePairedDevice.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const buttons = (within: Element = container) => [
  ...within.querySelectorAll<HTMLButtonElement>("button"),
];
async function click(text: string, within: Element = container) {
  const button =
    buttons(within).find(
      (entry) => entry.textContent?.trim() === text || entry.getAttribute("aria-label") === text,
    ) ??
    [...within.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((entry) =>
      [...(entry.labels ?? [])].some((label) => label.textContent?.trim() === text),
    );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}

async function render(
  props: { active?: boolean; machines?: RemoteMachine[]; onRefresh?: () => void } = {},
) {
  await act(async () =>
    root.render(
      createElement(PairedDevicesPanel, {
        machines: [remote, local],
        loaded: true,
        loading: false,
        onRefresh: vi.fn(),
        ...props,
      }),
    ),
  );
}

it("lists each computer's devices with this desktop marked and revoke only for others", async () => {
  await render();
  expect(devices.loadPairedDevices).toHaveBeenCalledWith(local);
  expect(devices.loadPairedDevices).toHaveBeenCalledWith(remote);
  expect(container.textContent).toContain("Pixel 9");
  expect(container.textContent).toContain("This desktop");
  expect(container.textContent).toContain("Active");
  expect(buttons().filter((entry) => entry.textContent?.trim() === "Revoke")).toHaveLength(1);
  expect(container.textContent).toContain("Update the host on Home Mac to see its devices.");
  // Opening the tab never creates a pairing code or enables networking.
  expect(api.create).not.toHaveBeenCalled();
  expect(api.enable).not.toHaveBeenCalled();
});

it("omits built-in desktop credentials and keeps access between computers visible", async () => {
  const legacySync: PairedDevice = { ...desktop, name: "This computer (local sync)" };
  devices.loadPairedDevices.mockImplementation(async (machine) => ({
    state: "ready",
    devices:
      machine === local
        ? [
            legacySync,
            { id: "mac-client", name: "Home Mac desktop", kind: "desktop", isCurrent: false },
          ]
        : [
            { ...desktop, name: "Windows desktop" },
            { ...legacySync, id: "legacy-mac", isCurrent: false },
            {
              ...desktop,
              id: "local-mac",
              name: "Built-in Mac desktop",
              isCurrent: false,
              isLocalDesktop: true,
            },
          ],
    truncated: false,
  }));

  await render();

  expect(container.textContent).not.toContain(legacySync.name);
  expect(container.textContent).not.toContain("Built-in Mac desktop");
  expect(container.textContent).toContain("Home Mac desktop");
  expect(container.textContent).toContain("Windows desktop");
  expect(container.textContent).toContain("Local sync");
  expect(container.textContent?.match(/This desktop/g)).toHaveLength(1);
  expect(buttons().filter((button) => button.textContent?.trim() === "Revoke")).toHaveLength(2);
});

it("uses quiet text for the last activity timestamp", async () => {
  vi.spyOn(clock, "wallClockNow").mockReturnValue(phone.lastSeenAt!);
  await render();
  expect(container.querySelector('.settings-description[data-tone="muted"]')?.textContent).toBe(
    "Active now",
  );
});

it("handles a burst of refresh clicks with one inventory read and one read per Host, then accepts another refresh", async () => {
  const onRefresh = vi.fn();
  await render({ onRefresh });
  const pairingRender = vi.spyOn(pairing, "usePhonePairing");
  devices.loadPairedDevices.mockClear();
  let finish!: (value: PairedDeviceList) => void;
  const pending = new Promise<PairedDeviceList>((resolve) => {
    finish = resolve;
  });
  devices.loadPairedDevices.mockReturnValue(pending);
  const button = buttons().find((entry) => entry.getAttribute("aria-label") === "Refresh devices")!;
  for (let i = 0; i < 8; i++) await act(async () => button.click());
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(pairingRender).not.toHaveBeenCalled();
  expect(devices.loadPairedDevices.mock.calls.map(([machine]) => machine.id).sort()).toEqual([
    "local",
    "remote",
  ]);
  expect(button.getAttribute("aria-busy")).toBe("true");
  await act(async () => finish({ state: "ready", devices: [desktop, phone], truncated: false }));
  expect(button.disabled).toBe(false);
  await click("Refresh devices");
  expect(onRefresh).toHaveBeenCalledTimes(2);
  expect(devices.loadPairedDevices).toHaveBeenCalledTimes(4);
});

it("joins an unfinished initial Host read without losing the explicit inventory refresh", async () => {
  const onRefresh = vi.fn();
  let finish!: (value: PairedDeviceList) => void;
  devices.loadPairedDevices.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render({ machines: [local], onRefresh });
  await click("Refresh devices");
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(devices.loadPairedDevices).toHaveBeenCalledOnce();
  await act(async () => finish({ state: "ready", devices: [desktop, phone], truncated: false }));
  expect(container.textContent).toContain("Pixel 9");
});

it("reads the same Host again when the account changes and ignores the old account's late refresh", async () => {
  const state = vi.spyOn(accountState, "useAccountState");
  const first = {
    phase: "signed-in" as const,
    context: ACCOUNT_CONTEXT,
    deviceId: null,
    stale: false,
    verifiedAt: 1,
  };
  try {
    state.mockReturnValue(first);
    await render({ machines: [local] });
    let finish!: (value: PairedDeviceList) => void;
    devices.loadPairedDevices.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click("Refresh devices");
    state.mockReturnValue({
      ...first,
      context: { ...ACCOUNT_CONTEXT, user: { ...ACCOUNT_CONTEXT.user, id: "second-user" } },
    });
    devices.loadPairedDevices.mockResolvedValue({
      state: "ready",
      devices: [desktop, { ...phone, name: "Other account phone" }],
      truncated: false,
    });
    await render({ machines: [local] });
    expect(container.textContent).toContain("Other account phone");
    await act(async () => finish({ state: "ready", devices: [desktop, phone], truncated: false }));
    expect(container.textContent).not.toContain("Pixel 9");
    expect(
      buttons().find((entry) => entry.getAttribute("aria-label") === "Refresh devices")?.disabled,
    ).toBe(false);
  } finally {
    state.mockRestore();
  }
});

it("revokes another device after an in-place confirmation and reloads the list", async () => {
  await render({ machines: [local] });
  let finishOldRead!: (value: PairedDeviceList) => void;
  devices.loadPairedDevices.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOldRead = resolve;
      }),
  );
  await click("Refresh devices");
  await click("Revoke");
  expect(devices.revokePairedDevice).not.toHaveBeenCalled();
  // ConfirmMorph ignores an answer within ~280 ms of the question being asked.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 320)));
  devices.loadPairedDevices.mockResolvedValue({
    state: "ready",
    devices: [desktop],
    truncated: false,
  });
  await click("Revoke access", document.body);
  expect(devices.revokePairedDevice).toHaveBeenCalledWith(local, phone);
  expect(devices.loadPairedDevices).toHaveBeenCalledTimes(3);
  expect(container.textContent).not.toContain("Pixel 9");
  await act(async () =>
    finishOldRead({ state: "ready", devices: [desktop, phone], truncated: false }),
  );
  expect(container.textContent).not.toContain("Pixel 9");
});

it("warns when the host's list is cut off at its limit", async () => {
  devices.loadPairedDevices.mockResolvedValue({
    state: "ready",
    devices: [desktop, phone],
    truncated: true,
  });
  await render({ machines: [local] });
  expect(container.textContent).toContain("has more devices than this list shows");
});

it("never shows a previous Host's list after the connection is rebound to another Host", async () => {
  await render({ machines: [local] });
  expect(container.textContent).toContain("Pixel 9");
  devices.loadPairedDevices.mockRejectedValue(new Error("unreachable"));
  await render({ machines: [{ ...local, environmentId: "other-environment" }] });
  expect(container.textContent).not.toContain("Pixel 9");
  expect(buttons().some((entry) => entry.textContent?.trim() === "Revoke")).toBe(false);
});

it("keeps the last good list when a refresh fails, marks it stale and retries on request", async () => {
  const now = vi.spyOn(clock, "wallClockNow").mockReturnValue(1_000_000);
  await render({ machines: [local] });
  now.mockReturnValue(1_600_000);
  await click("Refresh devices");
  now.mockReturnValue(1_660_000);
  devices.loadPairedDevices.mockRejectedValue(new Error("unreachable"));
  await click("Refresh devices");
  expect(container.textContent).toContain("Could not refresh. Showing the list from 1 minute ago.");
  expect(container.textContent).not.toContain("Could not read the devices");
  // The last good list stays, and so does revoking from it.
  expect(container.textContent).toContain("Pixel 9");
  const revoke = buttons().find((entry) => entry.textContent?.trim() === "Revoke")!;
  expect(revoke.disabled).toBe(false);
  devices.loadPairedDevices.mockClear();
  let finish!: (value: PairedDeviceList) => void;
  devices.loadPairedDevices.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await click("Try again");
  await click("Try again");
  expect(devices.loadPairedDevices).toHaveBeenCalledOnce();
  await act(async () => finish({ state: "ready", devices: [desktop, phone], truncated: false }));
  expect(container.textContent).not.toContain("Could not refresh");
  expect(container.textContent).toContain("Pixel 9");
});

it("leaves computers known to be down out of the periodic refresh", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    await render();
    health.read.mockImplementation((environmentId) => ({
      status: environmentId === remote.environmentId ? "unreachable" : "connected",
    }));
    devices.loadPairedDevices.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(devices.loadPairedDevices).toHaveBeenCalledWith(local);
    expect(devices.loadPairedDevices).not.toHaveBeenCalledWith(remote);
    // Refresh asked for by the owner still reaches it.
    await click("Refresh devices");
    expect(devices.loadPairedDevices).toHaveBeenCalledWith(remote);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps revoke disabled with a reason on a host that cannot revoke from here", async () => {
  devices.canRevokePairedDevices.mockResolvedValue(false);
  await render({ machines: [local] });
  const revoke = buttons().find((entry) => entry.textContent?.trim() === "Revoke")!;
  expect(revoke.disabled).toBe(true);
  expect(container.textContent).toContain("revoke devices from here");
});

it("pairs a phone in a dialog on the chosen computer and releases the code when the tab is left", async () => {
  await render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await click("Connect a phone");
  const dialog = container.querySelector('[role="dialog"]')!;
  expect(api.access).toHaveBeenCalledWith(local, "lan");
  await click("Show QR code", dialog);
  expect(api.create).toHaveBeenCalledWith(local);
  expect(dialog.querySelector("svg title")?.textContent).toBe(
    "Scan this code in bycoda on your phone",
  );
  expect(dialog.textContent).not.toContain("a".repeat(43));
  await render({ active: false });
  expect(api.cancel).toHaveBeenCalledWith(local, "pair-local");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("requires the explicit secure connection button before creating a Tailscale QR", async () => {
  api.access.mockResolvedValue({ state: "setup-required" });
  await render();
  await click("Connect a phone");
  const dialog = container.querySelector('[role="dialog"]')!;
  await click("Anywhere (Tailscale)", dialog);
  expect(api.enable).not.toHaveBeenCalled();
  await click("Enable secure connection", dialog);
  expect(api.enable).toHaveBeenCalledWith(local, "tailscale", undefined);
  expect(api.create).toHaveBeenCalledWith(local);
});

it("refreshes the devices when the paired dialog is closed", async () => {
  api.status.mockResolvedValue({ state: "paired" });
  await render();
  await click("Connect a phone");
  await click("Show QR code", container.querySelector('[role="dialog"]')!);
  expect(container.textContent).toContain("Your phone is connected");
  const before = devices.loadPairedDevices.mock.calls.length;
  await click("Done");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(devices.loadPairedDevices.mock.calls.length).toBeGreaterThan(before);
});

it("turns local network access off only after confirmation and shows the network hint", async () => {
  api.access.mockResolvedValue({
    mode: "lan",
    state: "ready",
    endpoint: "http://192.168.1.20:3777",
    networkHint: "Windows treats this network as Public.",
  });
  await render();
  expect(container.textContent).toContain("Windows treats this network as Public.");
  const toggle = container.querySelector<HTMLElement>(
    '[role="switch"][aria-label="Local network access"]',
  )!;
  await act(async () => toggle.click());
  expect(api.disable).not.toHaveBeenCalled();
  await click("Turn off local network access", document.body);
  expect(api.disable).toHaveBeenCalledWith(local);
});
