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
vi.mock("../../../shared/ui/Modal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui/Modal")>()),
  Modal: ({
    children,
    title,
    footer,
  }: {
    children: ReactNode;
    title: string;
    footer?: ReactNode;
  }) => createElement("div", { role: "dialog", "aria-label": title }, children, footer),
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
  automaticHostAccess: false,
  environmentId: machine.environmentId,
  hostLocalUrl: machine === local ? "http://127.0.0.1:3776" : "http://127.0.0.1:3777",
  publicReachability: "unverified",
  providers: [
    { provider: "cloudflare", installed: true, credential: "not-required" },
    { provider: "ngrok", installed: true, credential: "missing" },
    { provider: "tailscale", installed: true, credential: "not-required" },
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
  vi.mocked(remoteRequest).mockImplementation(async (machineId, method, params) => {
    if (method === "tunnels.status") return machineId === "local" ? current : overview(remote);
    if (method === "tunnels.stop") {
      current = {
        ...current,
        automaticHostAccess: false,
        tunnels: [{ ...info, state: "stopped", canStop: false, publicUrl: undefined }],
      };
      return {};
    }
    if (method === "tunnels.start") {
      if ((params as { automatic?: boolean }).automatic)
        current = { ...current, automaticHostAccess: true };
      return {};
    }
    if (method === "tunnels.credential") return {};
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
/** Opens the share dialog of the first computer (This computer) from the header action. */
async function openShare() {
  await act(async () => button("Create link").click());
}
async function choose(label: string, value: string) {
  const radio = container.querySelector<HTMLButtonElement>(
    `[role="radiogroup"][aria-label="${label}"] [role="radio"][aria-label="${value}"]`,
  );
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

it("only enables automatic Host access when Start sharing is submitted", async () => {
  await render();
  await openShare();
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  await choose("Tunnel target", "bycoda host");
  const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(toggle.checked).toBe(false);
  await act(async () => toggle.click());
  expect(toggle.checked).toBe(true);
  expect(vi.mocked(remoteRequest).mock.calls.some(([, method]) => method === "tunnels.start")).toBe(
    false,
  );
  await act(async () => button("Cancel").click());
  await openShare();
  const reopened = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(reopened.checked).toBe(false);
  await act(async () => reopened.click());
  await act(async () => button("Start sharing").click());
  expect(remoteRequest).toHaveBeenCalledWith(
    "local",
    "tunnels.start",
    {
      provider: "cloudflare",
      target: "host",
      automatic: true,
    },
    false,
    true,
  );
  expect(
    vi.mocked(remoteRequest).mock.calls.filter(([, method]) => method === "tunnels.start"),
  ).toHaveLength(1);
});

it("hides automatic access for an older Host that cannot persist the setting", async () => {
  delete current.automaticHostAccess;
  await render();
  await openShare();
  await choose("Tunnel target", "bycoda host");
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  expect(remoteRequest).not.toHaveBeenCalledWith(
    "local",
    "tunnels.start",
    expect.anything(),
    false,
    true,
  );
});

it("starts a one-time Cloudflare Host tunnel when automatic restart is unchecked", async () => {
  await render();
  await openShare();
  await choose("Tunnel target", "bycoda host");
  await act(async () => button("Start sharing").click());
  expect(remoteRequest).toHaveBeenCalledWith(
    "local",
    "tunnels.start",
    { provider: "cloudflare", target: "host" },
    false,
    true,
  );
});

it("can explicitly stop automatic Host access even without an active link", async () => {
  current = { ...current, automaticHostAccess: true, tunnels: [] };
  await render();
  await openShare();
  await choose("Tunnel target", "bycoda host");
  await act(async () => button("Stop automatic Host access").click());
  expect(remoteRequest).toHaveBeenCalledWith(
    "local",
    "tunnels.stop",
    { automatic: true },
    false,
    true,
  );
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
});

it("keeps a rejected token for retry and clears it only after acknowledged save", async () => {
  let reject = true;
  const original = vi.mocked(remoteRequest).getMockImplementation()!;
  vi.mocked(remoteRequest).mockImplementation(async (...args) => {
    if (args[1] === "tunnels.credential" && reject) throw new Error("credential-store-unavailable");
    return original(...args);
  });
  await render();
  await openShare();
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
  await openShare();
  await choose("Tunnel provider", "ngrok");
  // Only the dialog of the computer being shared from is mounted.
  const field = () => container.querySelector<HTMLInputElement>('input[type="password"]')!;
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
  await openShare();
  expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(
    "Create link",
  );
  await choose("Computer", "Home Mac");
  await choose("Tunnel target", "bycoda host");
  const field = [...container.querySelectorAll("input")].find((input) => input.readOnly)!;
  expect(field.value).toBe("http://127.0.0.1:3777");
  // Public access guidance is visible alongside the target before starting the tunnel.
  expect(container.textContent).toContain("Devices still need to pair.");
  await act(async () => button("Start sharing").click());
  expect(remoteRequest).toHaveBeenCalledWith(
    "remote",
    "tunnels.start",
    { provider: "cloudflare", target: "host" },
    false,
    true,
  );
  // A started tunnel closes the dialog; its link shows in the list.
  expect(container.querySelector('[role="dialog"][aria-label="Create link"]')).toBeNull();
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
  // The first group is This computer; Home Mac's own link stays connected.
  const groups = container.querySelectorAll('[aria-label="Tunnel status"]');
  expect(groups[0].textContent).not.toContain("Copy URL");
  expect(groups[0].textContent).toContain("Stopped");
  expect(groups[1].textContent).toContain("Copy URL");
});

it("shows missing dependencies and locked credentials and never renders secret diagnostic text", async () => {
  current.providers[0].installed = false;
  current.providers[1].credential = "unavailable";
  await render();
  await openShare();
  expect(container.textContent).not.toContain("Install cloudflared on This computer");
  expect(button("Start sharing").disabled).toBe(false);
  await choose("Tunnel provider", "ngrok");
  expect(container.textContent).toContain("secure credential store is unavailable");
  expect(container.querySelector('input[type="password"]')).not.toBeNull();
  vi.mocked(remoteRequest).mockRejectedValueOnce(new Error("private-token-in-cli-error"));
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Check again"]')!.click(),
  );
  expect(container.textContent).not.toContain("private-token");
  // This computer's link loses its sharing actions while its status cannot be read.
  expect(container.querySelector('[aria-label="Tunnel status"]')!.textContent).not.toContain(
    "Copy URL",
  );
  expect(container.textContent).toContain("selected computer could not be reached");
});

it("says a host tunnel is for other computers and never offers phone pairing", async () => {
  current.tunnels[0] = { ...info, target: "host", localUrl: "http://127.0.0.1:3776" };
  await render();
  expect(container.textContent).toContain("Public internet");
  expect(container.textContent).toContain("Phones use a tunnel only when you allow it");
  expect(container.textContent).not.toContain("Connect your phone");
});

it("groups links under a heading per computer, This computer first", async () => {
  await render();
  const headings = [...container.querySelectorAll("h3")].map((heading) => heading.textContent);
  expect(headings).toHaveLength(2);
  expect(headings[0]).toContain("This computer");
  expect(headings[1]).toContain("Home Mac");
  expect(container.querySelectorAll('[aria-label="Tunnel status"]')).toHaveLength(2);
  expect(container.querySelector("h2")?.textContent).toContain("Shared links");
});

it("keeps each computer's late status under its own group", async () => {
  let resolve!: (value: TunnelOverview) => void;
  vi.mocked(remoteRequest).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await render();
  expect(container.querySelectorAll('[aria-label="Tunnel status"]')).toHaveLength(1);
  await act(async () =>
    resolve({ ...overview(), tunnels: [{ ...info, publicUrl: "https://late.trycloudflare.com" }] }),
  );
  const groups = container.querySelectorAll('[aria-label="Tunnel status"]');
  expect(groups).toHaveLength(2);
  expect(groups[0].textContent).toContain("late.trycloudflare.com");
  expect(groups[1].textContent).not.toContain("late.trycloudflare.com");
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

it("shows the empty state with a Share action and one setup popover in the dialog", async () => {
  current = { ...overview(), tunnels: [] };
  vi.mocked(remoteRequest).mockImplementation(async (machineId, method) => {
    if (method === "tunnels.status")
      return machineId === "local" ? current : { ...overview(remote), tunnels: [] };
    throw new Error("unexpected method");
  });
  await render();
  expect(container.textContent).toContain("No shared links");
  expect(container.querySelector('[aria-label="Tunnel status"]')).toBeNull();
  expect(container.querySelector('[aria-label="Tunnel setup"]')).toBeNull();
  await openShare();
  expect(container.querySelector('[aria-label="Tunnel setup"]')).not.toBeNull();
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
    await openShare();
    expect(container.textContent).not.toContain("CLI needed");
    await choose("Tunnel provider", "ngrok");
    expect(container.textContent).not.toContain("needs a valid authtoken");
    expect(button("Start sharing").disabled).toBe(true);
    if (failed) expect(container.textContent).toContain("could not be reached");
  },
);

it("offers Tailscale Funnel as a public host-only provider and warns about public reach", async () => {
  await render();
  await openShare();
  expect(container.textContent).toContain("Anyone on the internet can reach the address");
  await choose("Tunnel provider", "Tailscale Funnel (public)");
  await act(async () => button("Start sharing").click());
  expect(remoteRequest).toHaveBeenCalledWith(
    "local",
    "tunnels.start",
    { provider: "tailscale", target: "host" },
    false,
    true,
  );
});

it("shows the approval page action only for a validated Tailscale approval URL", async () => {
  const funnel = {
    ...info,
    provider: "tailscale" as const,
    target: "host" as const,
    localUrl: "http://127.0.0.1:3776",
    state: "error" as const,
    issue: "approval-required" as const,
    publicUrl: undefined,
    canStop: false,
  };
  current.tunnels[0] = { ...funnel, approvalUrl: "https://login.tailscale.com/f/funnel?node=n1" };
  await render();
  expect(container.textContent).toContain("Funnel is not enabled");
  expect(container.textContent).toContain("Open approval page");
  current.tunnels[0] = { ...funnel, approvalUrl: "https://evil.example/f/funnel" };
  await act(async () => vi.advanceTimersByTimeAsync(3_100));
  expect(container.textContent).not.toContain("Open approval page");
});
