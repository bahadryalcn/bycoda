// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { remoteRequest } from "../model/connections";
import { copyText } from "../../../platform/tauri/clipboard";
import { ExternalTunnelsPanel } from "./ExternalTunnelsPanel";
import type { RemoteMachine } from "../model/protocol";
import type { TunnelOverview } from "../../../integrations/external-tunnels";

vi.mock("../model/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: vi.fn(async () => {}) }));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children, title }: { children: ReactNode; title: string }) =>
    createElement("div", { role: "dialog", "aria-label": title }, children),
}));
const local: RemoteMachine = {
  id: "local",
  name: "Local host",
  localHost: true,
  environmentId: "local-env",
  endpoint: "http://127.0.0.1:3776",
};
const remote: RemoteMachine = {
  id: "remote",
  name: "Home Mac",
  environmentId: "remote-env",
  endpoint: "http://127.0.0.1:49000",
  ssh: { target: "owner@mac", remotePort: 3777 },
};
const info = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "cloudflare" as const,
  target: "dev-server" as const,
  localUrl: "http://127.0.0.1:3000",
  state: "ready" as const,
  canStop: true,
  startedAt: 1,
  publicUrl: "https://owned.trycloudflare.com",
};
const overview = (machine = local): TunnelOverview => ({
  environmentId: machine.environmentId,
  hostLocalUrl: machine === local ? "http://127.0.0.1:3776" : "http://127.0.0.1:3777",
  publicReachability: "unverified",
  providers: [
    { provider: "cloudflare", installed: true, credential: "not-required" },
    { provider: "ngrok", installed: true, credential: "missing" },
  ],
  tunnels: [info],
});
let root: Root, container: HTMLDivElement, current: TunnelOverview;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  await setLanguagePreference("en");
  current = overview();
  vi.mocked(remoteRequest).mockReset();
  vi.mocked(copyText).mockClear();
  vi.mocked(remoteRequest).mockImplementation(async (machineId, method) => {
    if (method === "tunnels.status") return machineId === "local" ? current : overview(remote);
    if (method === "tunnels.stop") {
      current = {
        ...current,
        tunnels: [{ ...info, state: "stopped", canStop: false, publicUrl: undefined }],
      };
      return {};
    }
    if (method === "tunnels.start" || method === "tunnels.credential") return {};
    if (method === "mobile.pairing.create")
      return {
        pairingId: "pairing-id",
        ticket: "A".repeat(43),
        expiresAt: new Date(Date.now() + 120000).toISOString(),
        environmentId: local.environmentId,
      };
    if (method === "mobile.pairing.status") return { state: "pending" };
    if (method === "mobile.pairing.cancel") return { state: "cancelled" };
    throw new Error("unexpected method");
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      createElement(ExternalTunnelsPanel, {
        machines: [remote, local],
        loaded: true,
        loading: false,
      }),
    ),
  );
}
function button(text: string) {
  const value = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!value) throw new Error(`Missing ${text}`);
  return value;
}
async function choose(label: string, value: string) {
  const field = [...container.querySelectorAll("label")]
    .find((entry) => entry.textContent?.startsWith(label))
    ?.querySelector("select");
  if (!field) throw new Error(`Missing ${label}`);
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("separates dev and host targets and routes host start to the selected computer", async () => {
  await render();
  await choose("Computer", "remote");
  await choose("Tunnel target", "host");
  const field = [...container.querySelectorAll("input")].find((input) => input.readOnly)!;
  expect(field.value).toBe("http://127.0.0.1:3777");
  await act(async () => button("Start tunnel").click());
  expect(remoteRequest).toHaveBeenCalledWith(
    "remote",
    "tunnels.start",
    { provider: "cloudflare", target: "host" },
    false,
    true,
  );
  expect(container.textContent).toContain("Host access keeps device authentication and pairing.");
});

it("copies the public URL, shows a QR and removes sharing actions after stop", async () => {
  await render();
  await act(async () => button("Copy URL").click());
  expect(copyText).toHaveBeenCalledWith("https://owned.trycloudflare.com");
  expect(container.textContent).toContain("URL copied");
  await act(async () => button("Show QR code").click());
  expect(container.querySelector('[role="dialog"] svg title')?.textContent).toBe("Tunnel URL");
  await act(async () => button("Stop tunnel").click());
  expect(remoteRequest).toHaveBeenCalledWith("local", "tunnels.stop", { id: info.id }, false, true);
  expect(container.textContent).not.toContain("Copy URL");
  expect(container.textContent).toContain("Stopped");
});

it("shows missing dependencies and locked credentials and never renders secret diagnostic text", async () => {
  current.providers[0].installed = false;
  current.providers[1].credential = "unavailable";
  await render();
  expect(container.textContent).toContain("Install cloudflared on This computer");
  expect(button("Start tunnel").disabled).toBe(true);
  await choose("Tunnel provider", "ngrok");
  expect(container.textContent).toContain("secure credential store is unavailable");
  expect(container.querySelector('input[type="password"]')).not.toBeNull();
  vi.mocked(remoteRequest).mockRejectedValueOnce(new Error("private-token-in-cli-error"));
  await act(async () => button("Check again").click());
  expect(container.textContent).not.toContain("private-token");
  expect(container.textContent).not.toContain("Copy URL");
  expect(container.textContent).toContain("selected computer could not be reached");
});

it("uses the existing owner-issued pairing ticket with the host tunnel endpoint", async () => {
  current.tunnels[0] = { ...info, target: "host", localUrl: "http://127.0.0.1:3776" };
  await render();
  await act(async () => button("Connect your phone").click());
  const create = [...container.querySelectorAll('[role="dialog"] button')].find(
    (entry) => entry.textContent === "Connect your phone",
  ) as HTMLButtonElement;
  await act(async () => create.click());
  expect(remoteRequest).toHaveBeenCalledWith("local", "mobile.pairing.create", {}, false, true);
  expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain("Local network");
  expect(container.querySelector('[role="dialog"] svg title')?.textContent).toBe(
    "Scan this code in bycoda on your phone",
  );
  // The encoded ticket binds this URL and environment; no reusable device credential is generated in the renderer.
  expect(container.textContent).not.toContain("A".repeat(43));
});

it("ignores a previous computer's late status after the selection changes", async () => {
  let resolve!: (value: TunnelOverview) => void;
  vi.mocked(remoteRequest).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await render();
  await choose("Computer", "remote");
  await act(async () =>
    resolve({ ...overview(), tunnels: [{ ...info, publicUrl: "https://old.trycloudflare.com" }] }),
  );
  expect(container.textContent).not.toContain("old.trycloudflare.com");
  expect(container.textContent).toContain("Home Mac");
});
