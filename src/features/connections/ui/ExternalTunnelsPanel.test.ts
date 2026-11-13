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
// The shared Alert completes its dismissal on an exit animation that happy-dom does not run;
// its own tests cover that. Here the panel only needs the notice text and its dismiss wiring.
vi.mock("../../../shared/ui/Alert", () => ({
  Alert: ({
    children,
    onDismiss,
    role,
  }: {
    children: ReactNode;
    onDismiss?: () => void;
    role?: string;
  }) =>
    createElement(
      "div",
      { role },
      children,
      onDismiss
        ? createElement("button", { type: "button", "aria-label": "Dismiss", onClick: onDismiss })
        : null,
    ),
}));
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
  const value = [...container.querySelectorAll("button")].find(
    (b) => !b.closest("[hidden]") && b.textContent === text,
  );
  if (!value) throw new Error(`Missing ${text}`);
  return value;
}
async function choose(label: string, value: string) {
  const group = [...container.querySelectorAll("fieldset")].find(
    (fieldset) =>
      !fieldset.closest("[hidden]") && fieldset.querySelector("legend")?.textContent === label,
  );
  const radio = group?.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (radio) {
    await act(async () => radio.click());
    return;
  }
  const field = container.querySelector<HTMLButtonElement>(`[aria-label^="${label}:"]`);
  if (!field) throw new Error(`Missing ${label}`);
  await act(async () => field.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((entry) =>
    entry.textContent?.includes(value),
  );
  if (!option) throw new Error(`Missing option ${value}`);
  await act(async () => option.click());
}

it("keeps a rejected token for retry and clears it only after acknowledged save", async () => {
  let reject = true;
  const original = vi.mocked(remoteRequest).getMockImplementation()!;
  vi.mocked(remoteRequest).mockImplementation(async (...args) => {
    if (args[1] === "tunnels.credential" && reject) throw new Error("credential-store-unavailable");
    return original(...args);
  });
  await render();
  await choose("Tunnel provider", "ngrok");
  const field = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      field,
      "fixture-token",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = () =>
    act(async () =>
      field
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  await save();
  expect(field.value).toBe("fixture-token");
  expect(container.textContent).toContain("secure");
  reject = false;
  // Failed mutations remain retryable without a separate status refresh.
  await save();
  expect(field.value).toBe("");
});

it("retains separate machine drafts and binds delayed token completion to its owner", async () => {
  let finish!: (value: unknown) => void;
  const original = vi.mocked(remoteRequest).getMockImplementation()!;
  vi.mocked(remoteRequest).mockImplementation(async (...args) =>
    args[1] === "tunnels.credential"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(...args),
  );
  await render();
  await choose("Tunnel provider", "ngrok");
  const field = () =>
    [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')].find(
      (item) => !item.closest("[hidden]"),
    )!;
  const fill = (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        field(),
        value,
      );
      field().dispatchEvent(new Event("input", { bubbles: true }));
    });
  await fill("local-token");
  await act(async () =>
    field()
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(field().disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('input[value="host"]')!.disabled).toBe(true);
  expect(button("Save token securely").getAttribute("aria-busy")).toBe("true");
  await choose("Computer", "Home Mac");
  await choose("Tunnel provider", "ngrok");
  await fill("remote-token");
  await act(async () => finish({}));
  expect(field().value).toBe("remote-token");
  await choose("Computer", "This computer");
  expect(field().value).toBe("");
  await choose("Computer", "Home Mac");
  expect(field().value).toBe("remote-token");
  await act(async () =>
    root.render(
      createElement(ExternalTunnelsPanel, {
        machines: [remote, local],
        loaded: true,
        loading: true,
      }),
    ),
  );
  expect(field().value).toBe("remote-token");
});

it("separates dev and host targets and routes host start to the selected computer", async () => {
  await render();
  await choose("Computer", "Home Mac");
  await choose("Tunnel target", "host");
  const field = [...container.querySelectorAll("input")].find(
    (input) => !input.closest("[hidden]") && input.readOnly,
  )!;
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
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Check again"]')!.click(),
  );
  expect(container.textContent).not.toContain("private-token");
  expect(container.textContent).not.toContain("Copy URL");
  expect(container.textContent).toContain("selected computer could not be reached");
});

it("uses the existing owner-issued pairing ticket with the host tunnel endpoint", async () => {
  current.tunnels[0] = { ...info, target: "host", localUrl: "http://127.0.0.1:3776" };
  await render();
  await act(async () => button("Connect your phone").click());
  // The tunnel row already asked to connect a phone, so the dialog goes straight to the QR.
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
  await choose("Computer", "Home Mac");
  await act(async () =>
    resolve({ ...overview(), tunnels: [{ ...info, publicUrl: "https://old.trycloudflare.com" }] }),
  );
  expect(container.textContent).not.toContain("old.trycloudflare.com");
  expect(container.textContent).toContain("Home Mac");
});

it("shows a dismissible notice after the Host repaired damaged tunnel state", async () => {
  current = { ...overview(), repair: { repaired: true, dropped: 2 } };
  await render();
  const text = "Tunnel settings were damaged and repaired; 2 entries could not be recovered.";
  expect(container.textContent).toContain(text);
  const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
  expect(dismiss).not.toBeNull();
  await act(async () => dismiss!.click());
  expect(container.textContent).not.toContain(text);
});

it("does not show the repair notice when the Host reports no repair", async () => {
  await render();
  expect(container.textContent).not.toContain("could not be recovered");
});

it("lists no empty-state line and one setup popover in the Sharing form", async () => {
  current = { ...overview(), tunnels: [] };
  await render();
  expect(container.textContent).not.toContain("No tunnels on this computer.");
  expect(container.querySelector('[aria-label="Tunnel status"]')).toBeNull();
  expect(container.querySelector('[aria-label="Tunnel setup"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Cloudflare"]')).toBeNull();
  expect(
    container.querySelectorAll("button[aria-label$=' setup'], button[aria-label='Tunnel setup']"),
  ).toHaveLength(1);
  expect(container.querySelector('button[aria-label="Check again"]')).not.toBeNull();
});

it.each([false, true])(
  "does not assert missing setup before a successful status read (failed=%s)",
  async (failed) => {
    vi.mocked(remoteRequest).mockImplementation(() =>
      failed ? Promise.reject(new Error("Host disconnected")) : new Promise(() => {}),
    );
    await render();
    expect(container.textContent).not.toContain("CLI needed");
    await choose("Tunnel provider", "ngrok");
    expect(container.textContent).not.toContain("needs a valid authtoken");
    expect(button("Start tunnel").disabled).toBe(true);
    if (failed) expect(container.textContent).toContain("could not be reached");
  },
);
