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
  Modal: ({ children, onClose }: { children: ReactNode; onClose: () => void }) =>
    createElement(
      "div",
      { role: "dialog" },
      createElement("button", { "aria-label": "Close", onClick: onClose }, "Close"),
      children,
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
  const button = [...within.querySelectorAll("button")].find((entry) => entry.textContent === text);
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}

async function render() {
  await act(async () =>
    root.render(
      createElement(PhoneConnectionPanel, {
        machines: [remote, local],
        loaded: true,
        loading: false,
        onRefresh: vi.fn(),
      }),
    ),
  );
}

it("opens on the local computer without enabling networking and supports the saved SSH target", async () => {
  await render();
  expect(api.access).not.toHaveBeenCalled();
  expect(api.enable).not.toHaveBeenCalled();
  await click("Connect your phone");
  expect(api.access).toHaveBeenCalledWith(local, "lan");
  expect(api.enable).not.toHaveBeenCalled();
  const select = container.querySelector<HTMLSelectElement>("select")!;
  expect(select.value).toBe(local.id);
  await act(async () => {
    select.value = remote.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(api.access).toHaveBeenLastCalledWith(remote, "lan");
  await click("Connect your phone", container.querySelector('[role="dialog"]')!);
  expect(api.create).toHaveBeenCalledWith(remote);
  expect(container.querySelector("svg title")?.textContent).toBe(
    "Scan this code in bycoda on your phone",
  );
  expect(container.textContent).not.toContain("a".repeat(43));
  expect(container.textContent).not.toContain("127.0.0.1");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(),
  );
  expect(api.cancel).toHaveBeenCalledWith(remote, "pair-remote");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it("requires the explicit secure connection button before creating the QR", async () => {
  api.access.mockResolvedValue({ state: "setup-required" });
  await render();
  await click("Connect your phone");
  await click("Tailscale");
  expect(api.enable).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  await click("Enable secure connection");
  expect(api.enable).toHaveBeenCalledWith(local, "tailscale", undefined);
  expect(api.create).toHaveBeenCalledWith(local);
  expect(container.textContent).toContain("Code expires in");
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
  await click("Connect your phone");
  expect(container.textContent).not.toContain("Install Tailscale");
  expect(container.textContent).toContain("Tailscale is not required");
  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Local network address"]',
  )!;
  await act(async () => {
    select.value = "10.0.0.5";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("Enable local network access");
  expect(api.enable).toHaveBeenCalledWith(local, "lan", "10.0.0.5");
  expect(container.textContent).toContain("same local network");
  await click("Turn off local network access");
  expect(api.disable).toHaveBeenCalledWith(local);
  expect(api.cancel).toHaveBeenCalledWith(local, "pair-local");
  expect(container.querySelector("svg title")).toBeNull();
});
