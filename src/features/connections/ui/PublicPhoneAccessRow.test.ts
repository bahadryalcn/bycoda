// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguagePreference } from "../../../shared/i18n";
import { remoteRequest } from "../model/connections";
import type { RemoteMachine } from "../model/protocol";
import type { TunnelOverview } from "../../../integrations/external-tunnels";
import { PublicPhoneAccessRow } from "./PublicPhoneAccessRow";

vi.mock("../model/connections", () => ({ remoteRequest: vi.fn() }));
const local: RemoteMachine = {
  id: "local",
  name: "Local host",
  localHost: true,
  environmentId: "local-env",
  endpoint: "http://127.0.0.1:3776",
};
let phones = false;
const overview = (): TunnelOverview => ({
  phonesOverPublic: phones,
  environmentId: local.environmentId,
  hostLocalUrl: "http://127.0.0.1:3776",
  publicReachability: "unverified",
  providers: [
    { provider: "cloudflare", installed: true, credential: "not-required" },
    { provider: "ngrok", installed: true, credential: "missing" },
    { provider: "tailscale", installed: true, credential: "not-required" },
  ],
  tunnels: [],
});
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await setLanguagePreference("en");
  phones = false;
  vi.mocked(remoteRequest).mockReset();
  vi.mocked(remoteRequest).mockImplementation(async (_id, method, params) => {
    if (method === "tunnels.status") return overview();
    if (method === "tunnels.phones") {
      phones = (params as { enabled: boolean }).enabled;
      return { phonesOverPublic: phones };
    }
    throw new Error("unexpected method");
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(PublicPhoneAccessRow, { machine: local, active: true })),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const toggle = () =>
  container.querySelector<HTMLElement>(
    '[role="switch"][aria-label="Allow phones over the public internet"]',
  )!;
const confirmButton = () =>
  [...document.querySelectorAll("button")].find(
    (entry) => entry.textContent?.trim() === "Allow public phone access",
  );

it("is off by default and sends nothing until the owner confirms the public consequence", async () => {
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  await act(async () => toggle().click());
  expect(document.body.textContent).toContain("Anyone on the internet can reach");
  expect(remoteRequest).not.toHaveBeenCalledWith(
    "local",
    "tunnels.phones",
    expect.anything(),
    false,
    true,
  );
  await act(async () => confirmButton()!.click());
  expect(remoteRequest).toHaveBeenCalledWith(
    "local",
    "tunnels.phones",
    { enabled: true },
    false,
    true,
  );
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});

it("turns off without a confirmation", async () => {
  await act(async () => toggle().click());
  await act(async () => confirmButton()!.click());
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle().click());
  expect(remoteRequest).toHaveBeenCalledWith(
    "local",
    "tunnels.phones",
    { enabled: false },
    false,
    true,
  );
  expect(toggle().getAttribute("aria-checked")).toBe("false");
});
