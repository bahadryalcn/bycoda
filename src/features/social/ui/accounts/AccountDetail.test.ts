// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialAccount, SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { AccountDetail } from "./AccountDetail";

vi.mock("../../../../platform/tauri/openExternal", () => ({
  openExternal: vi.fn(async () => undefined),
}));
vi.mock("./AccountPermissions", () => ({ AccountPermissions: () => null }));
vi.mock("./AutonomySettings", () => ({ AutonomySettings: () => null }));
vi.mock("./BrowserSettings", () => ({ BrowserSettings: () => null }));
vi.mock("./ReplyRules", () => ({ ReplyRules: () => null }));

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

const account = {
  id: "a1",
  platform: "instagram",
  name: "Studio",
  accountType: "member",
  connection: "browser",
  connected: true,
  paused: false,
  grants: {},
  executorId: "e1",
} as unknown as SocialAccount;

function snapshot(status: "expired" | "available"): SocialSnapshot {
  return {
    executorId: "e1",
    hostOnline: true,
    capabilities: {
      a1: [
        {
          operation: "publish",
          status,
          reason: "",
          reasonCode: status === "expired" ? "browser.reconnect" : "browser.ready",
          scopes: [],
          source: "browser",
        },
      ],
    },
  } as unknown as SocialSnapshot;
}

function render(
  status: "expired" | "available",
  browserBegin = vi.fn(async () => ({ status: "waiting", expiresAt: 1 })),
) {
  const client = {
    browserBegin,
    browserStatus: vi.fn(async () => ({ status: "connected" })),
    request: vi.fn(async () => ({})),
  } as unknown as SocialClient;
  act(() =>
    root.render(
      createElement(AccountDetail, {
        client,
        account,
        snapshot: snapshot(status),
        projects: [],
        needsHuman: false,
        hostOnline: true,
        onChanged: vi.fn(),
      }),
    ),
  );
  return browserBegin;
}

it("shows Connection needed for an expired browser session and starts the sign-in from its row", async () => {
  const browserBegin = render("expired");
  expect(element.textContent).toContain("Connection needed");
  expect(element.textContent).not.toContain("Awaiting access");
  const connect = [...element.querySelectorAll("button")].find(
    (button) => button.textContent === "Connect",
  );
  expect(connect).toBeTruthy();
  await act(async () => connect?.click());
  expect(browserBegin).toHaveBeenCalledWith("a1", undefined);
});

it("hides the Connect action when the capability is available", () => {
  render("available");
  expect(element.querySelector('[aria-label="Available"]')).not.toBeNull();
  expect(
    [...element.querySelectorAll("button")].some((button) => button.textContent === "Connect"),
  ).toBe(false);
});

it("disables the account actions and says why while the Host is offline", () => {
  const client = { browserBegin: vi.fn(), request: vi.fn() } as unknown as SocialClient;
  act(() =>
    root.render(
      createElement(AccountDetail, {
        client,
        account,
        snapshot: snapshot("available"),
        projects: [],
        needsHuman: false,
        hostOnline: false,
        onChanged: vi.fn(),
      }),
    ),
  );
  expect(element.textContent).toContain("Connect to this computer to change this account.");
});
