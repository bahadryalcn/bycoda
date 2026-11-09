// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import type { PhonePairingApi } from "../model/phonePairingTypes";
import type { RemoteMachine } from "../model/protocol";
import { PhoneConnectionPanel } from "./PhoneConnectionPanel";

const api = vi.hoisted(() => ({
  access: vi.fn<PhonePairingApi["access"]>(),
  enable: vi.fn<PhonePairingApi["enable"]>(),
  disable: vi.fn<NonNullable<PhonePairingApi["disable"]>>(),
  create: vi.fn<PhonePairingApi["create"]>(),
  status: vi.fn<PhonePairingApi["status"]>(),
  cancel: vi.fn<PhonePairingApi["cancel"]>(),
}));
vi.mock("../model/phonePairingApi", () => ({ phonePairingApi: api }));
vi.mock("../../../shared/ui/Modal", () => ({
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

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await setLanguagePreference("en");
  for (const mock of Object.values(api)) mock.mockReset();
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
  api.disable.mockResolvedValue({
    mode: "lan",
    state: "setup-required",
    addresses: ["192.168.1.20"],
  });
  api.enable.mockResolvedValue({
    state: "ready",
    endpoint: "https://home.tail123.ts.net",
  });
  api.create.mockImplementation(async (machine) => ({
    pairingId: `pair-${machine.id}`,
    ticket: "a".repeat(43),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    environmentId: machine.environmentId,
  }));
  api.status.mockResolvedValue({ state: "pending" });
  api.cancel.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(text: string, within: Element = container) {
  const button =
    [...within.querySelectorAll<HTMLElement>("button")].find(
      (entry) =>
        entry.textContent === text ||
        (entry.getAttribute("role") === "switch" && entry.getAttribute("aria-label") === text),
    ) ??
    [...within.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((entry) =>
      [...(entry.labels ?? [])].some((label) => label.textContent?.trim() === text),
    );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}

async function pickOption(trigger: HTMLButtonElement, label: string) {
  await act(async () => trigger.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((element) =>
    element.textContent?.includes(label),
  )!;
  await act(async () => option.click());
}

async function render(props: { active?: boolean } = {}) {
  await act(async () =>
    root.render(
      createElement(PhoneConnectionPanel, {
        machines: [remote, local],
        loaded: true,
        loading: false,
        onRefresh: vi.fn(),
        ...props,
      }),
    ),
  );
}

it("checks access on the local computer when shown, never enabling networking, and supports the saved SSH target", async () => {
  await render();
  expect(api.access).toHaveBeenCalledTimes(1);
  expect(api.access).toHaveBeenCalledWith(local, "lan");
  expect(api.enable).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label^="Computer:"]')!;
  expect(trigger.textContent).toContain("This computer");
  await pickOption(trigger, remote.name);
  expect(api.access).toHaveBeenLastCalledWith(remote, "lan");
  await click("Show QR code");
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.create).toHaveBeenCalledWith(remote);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector("svg title")?.textContent).toBe(
    "Scan this code in bycoda on your phone",
  );
  expect(container.textContent).not.toContain("a".repeat(43));
  expect(container.textContent).not.toContain("127.0.0.1");
});

it("releases a live code when the tab is left and opens again when it returns", async () => {
  await render();
  await click("Show QR code");
  expect(api.create).toHaveBeenCalledWith(local);
  await render({ active: false });
  expect(api.cancel).toHaveBeenCalledWith(local, "pair-local");
  expect(container.querySelector("svg title")).toBeNull();
  expect(api.access).toHaveBeenCalledTimes(1);
  await render({ active: true });
  expect(api.access).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Show QR code");
});

it("does not check access while the tab is inactive", async () => {
  await render({ active: false });
  expect(api.access).not.toHaveBeenCalled();
});

it("requires the explicit secure connection button before creating the QR", async () => {
  api.access.mockResolvedValue({ state: "setup-required" });
  await render();
  await click("Anywhere (Tailscale)");
  expect(api.enable).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  await click("Enable secure connection");
  expect(api.enable).toHaveBeenCalledWith(local, "tailscale", undefined);
  expect(api.create).toHaveBeenCalledWith(local);
  expect(container.textContent).toContain("s left");
});

it("enables LAN without Tailscale, selects an interface and closes the QR when disabled", async () => {
  api.access.mockResolvedValue({
    mode: "lan",
    state: "setup-required",
    addresses: ["192.168.1.20", "10.0.0.5"],
  });
  api.enable.mockResolvedValue({
    mode: "lan",
    state: "ready",
    endpoint: "http://10.0.0.5:3777",
    lanKey: "ab".repeat(32),
  });
  await render();
  expect(container.textContent).not.toContain("Install Tailscale");
  expect(container.textContent).toContain("same Wi-Fi or local network");
  await pickOption(
    container.querySelector<HTMLButtonElement>('[aria-label^="Local network address:"]')!,
    "10.0.0.5",
  );
  await click("Local network access");
  expect(api.enable).toHaveBeenCalledWith(local, "lan", "10.0.0.5");
  // The local-network hint now lives in the connection help popover.
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Connection help"]')!.click(),
  );
  expect(document.body.textContent).toContain("same local network");
  await click("Local network access");
  await click("Turn off local network access");
  expect(api.disable).toHaveBeenCalledWith(local);
  expect(api.cancel).toHaveBeenCalledWith(local, "pair-local");
  expect(container.querySelector("svg title")).toBeNull();
});

it("offers to pair another phone inline once a phone is connected", async () => {
  api.status.mockResolvedValue({ state: "paired" });
  await render();
  await click("Show QR code");
  expect(container.textContent).toContain("Your phone is connected");
  expect(container.textContent).not.toContain("Done");
  await click("Pair another phone");
  expect(api.access).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Show QR code");
});
