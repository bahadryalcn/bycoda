// @vitest-environment happy-dom
import type { AccountContext } from "@bycoda/account-contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountState } from "../model/accountState";
import { ACCOUNT_CONTEXT } from "../model/testFixtures";
import { AccountRailRow } from "./AccountRailRow";
import { AccountScreen } from "./AccountScreen";

const mocks = vi.hoisted(() => ({
  state: { phase: "signed-out", notice: null, message: null } as unknown,
  openExternal: vi.fn(async (_url: string) => undefined),
  deactivate: vi.fn(async (_reason?: string) => undefined),
  reactivate: vi.fn(async () => undefined),
  scheduleDeletion: vi.fn(async (_reason?: string) => undefined),
}));

vi.mock("../hooks/useAccountData", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDeletion: () => ({
    schedule: { isPending: false, mutateAsync: mocks.scheduleDeletion },
    cancel: { isPending: false, mutateAsync: vi.fn() },
  }),
}));

vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: mocks.openExternal }));
vi.mock("../../today", () => ({
  TodayView: () => {
    const [text, setText] = useState("");
    return createElement("input", {
      "aria-label": "Summary fixture",
      value: text,
      onChange: (event: { target: { value: string } }) => setText(event.target.value),
    });
  },
}));
vi.mock("./AccountData", () => ({
  AccountData: () => {
    const [text, setText] = useState("");
    return createElement("input", {
      "aria-label": "Diagnostics fixture",
      value: text,
      onChange: (event: { target: { value: string } }) => setText(event.target.value),
    });
  },
}));
vi.mock("../hooks/useAccount", () => ({
  useAccountState: () => mocks.state,
  useAccount: () => ({
    state: mocks.state,
    signIn: vi.fn(async () => undefined),
    cancelSignIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    deactivate: mocks.deactivate,
    reactivate: mocks.reactivate,
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;

const signedIn = (context: AccountContext = ACCOUNT_CONTEXT): AccountState => ({
  phase: "signed-in",
  context,
  deviceId: "dev_1",
  verifiedAt: 1,
  stale: false,
});
const deactivatedContext: AccountContext = {
  ...ACCOUNT_CONTEXT,
  user: { ...ACCOUNT_CONTEXT.user, status: "deactivated", deactivatedAt: "2026-11-08T10:00:00Z" },
};

async function render(node: Parameters<typeof createElement>[0], props: object = {}) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(node as never, props),
      ),
    );
  });
}
const tabs = () => [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
const button = (name: string | RegExp) =>
  [...document.querySelectorAll("button")].find((candidate) =>
    typeof name === "string"
      ? candidate.textContent === name
      : name.test(candidate.textContent ?? ""),
  ) as HTMLButtonElement;
async function click(element: Element | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  act(() => root.unmount());
  container.remove();
});

describe("account center", () => {
  it("lazily retains privacy and summary panel instances across tab changes", async () => {
    mocks.state = signedIn();
    await render(AccountScreen);
    const select = async (name: string) =>
      click(
        [...container.querySelectorAll('[role="tab"]')].find((node) => node.textContent === name),
      );
    expect(container.querySelector('[aria-label="Summary fixture"]')).toBeNull();
    for (const [tab, label] of [
      ["Active time", "Summary fixture"],
      ["Privacy & data", "Diagnostics fixture"],
    ]) {
      await select(tab!);
      const original = container.querySelector(`[aria-label="${label}"]`);
      expect(original).not.toBeNull();
      await select("Profile");
      expect(original?.isConnected).toBe(true);
      await select(tab!);
      expect(container.querySelector(`[aria-label="${label}"]`)).toBe(original);
    }
  });
  it("shows one sign-in panel and no tabs to a guest", async () => {
    mocks.state = { phase: "signed-out", notice: null, message: null };
    await render(AccountScreen);
    expect(tabs()).toEqual([]);
    expect(button("Sign in with browser")).toBeTruthy();
    expect(container.textContent).toContain("stay on this computer");
  });

  it("explains a rejected sign-in configuration and a browser cancel", async () => {
    mocks.state = {
      phase: "signed-out",
      notice: "sign-in-failed",
      message:
        "This build's sign-in configuration was rejected by the account server (invalid_scope).",
    };
    await render(AccountScreen);
    expect(container.textContent).toContain("rejected by the account server (invalid_scope).");
    mocks.state = { phase: "signed-out", notice: "declined", message: null };
    await render(AccountScreen);
    expect(container.textContent).toContain("Sign-in was cancelled in the browser.");
  });

  it("renders every tab for a signed-in account", async () => {
    mocks.state = signedIn();
    await render(AccountScreen);
    expect(tabs()).toEqual([
      "Profile",
      "Security",
      "Devices",
      "Active time",
      "Notifications",
      "Privacy & data",
      "Support",
      "Account status",
    ]);
    expect(container.textContent).toContain("ada@example.com");
  });

  it("opens the web security page from the Security tab", async () => {
    vi.stubEnv("VITE_BYCODA_ACCOUNT_PORTAL_URL", "https://portal.example.test");
    mocks.state = signedIn();
    await render(AccountScreen);
    await click(
      [...container.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Security"),
    );
    await click(button("Open account page"));
    expect(mocks.openExternal).toHaveBeenCalledWith("https://portal.example.test/security");
  });

  it("deactivates after a confirmation, with the optional reason", async () => {
    mocks.state = signedIn();
    await render(AccountScreen);
    await click(
      [...container.querySelectorAll('[role="tab"]')].find(
        (t) => t.textContent === "Account status",
      ),
    );
    await click(button("Deactivate…"));
    expect(mocks.deactivate).not.toHaveBeenCalled();
    await click(button("Deactivate"));
    expect(mocks.deactivate).toHaveBeenCalledWith(undefined);
  });

  it("schedules deletion in the app only after a confirmation", async () => {
    mocks.state = signedIn();
    await render(AccountScreen);
    await click(
      [...container.querySelectorAll('[role="tab"]')].find(
        (t) => t.textContent === "Account status",
      ),
    );
    await click(button("Delete account…"));
    expect(mocks.scheduleDeletion).not.toHaveBeenCalled();
    await click(button("Delete account"));
    expect(mocks.scheduleDeletion).toHaveBeenCalledWith(undefined);
  });

  it("limits a deactivated account to three tabs and offers reactivation", async () => {
    mocks.state = signedIn(deactivatedContext);
    await render(AccountScreen);
    expect(tabs()).toEqual(["Profile", "Privacy & data", "Account status"]);
    await click(
      [...container.querySelectorAll('[role="tab"]')].find(
        (t) => t.textContent === "Account status",
      ),
    );
    await click(button("Reactivate account"));
    expect(mocks.reactivate).toHaveBeenCalledTimes(1);
  });
});

describe("account rail row", () => {
  it("says Sign in for a guest and selects the account section", async () => {
    mocks.state = { phase: "signed-out", notice: null, message: null };
    const onSelect = vi.fn();
    await render(AccountRailRow, { active: false, onSelect });
    expect(container.textContent).toContain("Sign in");
    await click(container.querySelector("button") ?? undefined);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows the avatar initial and name when signed in", async () => {
    mocks.state = signedIn();
    await render(AccountRailRow, { active: true, onSelect: vi.fn() });
    expect(container.textContent).toContain("Ada");
    expect(container.querySelector("[data-account-avatar]")?.textContent).toBe("A");
    expect(container.querySelector("button")?.getAttribute("aria-current")).toBe("true");
  });
});
