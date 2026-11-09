// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AccountState } from "../model/accountState";
import { ACCOUNT_CONTEXT } from "../model/testFixtures";

const mocks = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: mocks.openExternal }));
import { AccountMenu, type AccountMenuPresence } from "./AccountMenu";

const signedIn: AccountState = {
  phase: "signed-in",
  context: ACCOUNT_CONTEXT,
  deviceId: null,
  verifiedAt: 0,
  stale: false,
};
const guest: AccountState = { phase: "signed-out", notice: null, message: null };
let container: HTMLDivElement;
let root: Root;
const actions = { onSignIn: vi.fn(), onSignOut: vi.fn(), onOpenAccountSettings: vi.fn() };
const presence = (hidden = false): AccountMenuPresence => ({
  hidden,
  items: [
    {
      kind: "group",
      id: "presence",
      label: "Availability",
      items: [{ kind: "item", id: "away", label: "Away" }],
    },
  ],
  begin: vi.fn(),
  end: vi.fn(),
  pick: vi.fn((id: string) => id === "away"),
  badge: createElement("i", { "data-dot": true }),
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.openExternal.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  vi.unstubAllEnvs();
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(state: AccountState, p?: AccountMenuPresence) {
  await act(async () =>
    root.render(createElement(AccountMenu, { state, presence: p, ...actions })),
  );
}
const trigger = () => container.querySelector<HTMLButtonElement>("[data-account-menu-trigger]")!;
const row = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(
    (el) => el.getAttribute("aria-label") === label || el.textContent === label,
  )!;

it("shows the initial for a signed-in user and the guest glyph when signed out", async () => {
  await render(signedIn);
  expect(container.querySelector("[data-account-avatar]")!.textContent).toBe("A");
  await render(guest);
  expect(container.querySelector("[data-account-avatar]")!.textContent).toBe("");
  expect(container.querySelector("[data-account-avatar] svg")).not.toBeNull();
});

it("draws the presence badge and opens the presence session with the menu", async () => {
  const p = presence();
  await render(signedIn, p);
  expect(container.querySelector("[data-dot]")).not.toBeNull();
  await act(async () => trigger().click());
  expect(p.begin).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain("ada@example.com");
  await act(async () => row("Away").click());
  expect(p.pick).toHaveBeenCalledWith("away");
  expect(p.end).toHaveBeenCalled();
});

it("omits availability when the assistant is not set up", async () => {
  await render(guest, presence(true));
  expect(container.querySelector("[data-dot]")).toBeNull();
  await act(async () => trigger().click());
  expect(document.body.textContent).toContain("Guest");
  expect(row("Away")).toBeUndefined();
});

it("routes account settings, the web link and sign out for a signed-in user", async () => {
  vi.stubEnv("VITE_BYCODA_ACCOUNT_PORTAL_URL", "https://portal.example.test");
  await render(signedIn);
  await act(async () => trigger().click());
  await act(async () => row("Account settings").click());
  expect(actions.onOpenAccountSettings).toHaveBeenCalledOnce();
  await act(async () => trigger().click());
  await act(async () => row("Manage account on the web").click());
  expect(mocks.openExternal).toHaveBeenCalledWith("https://portal.example.test/");
  await act(async () => trigger().click());
  expect(row("Sign in")).toBeUndefined();
  await act(async () => row("Sign out").click());
  expect(actions.onSignOut).toHaveBeenCalledOnce();
});

it("hides the web link when no portal is configured", async () => {
  await render(signedIn);
  await act(async () => trigger().click());
  expect(row("Manage account on the web")).toBeUndefined();
});

it("offers Sign in to a guest", async () => {
  await render(guest);
  await act(async () => trigger().click());
  await act(async () => row("Sign in").click());
  expect(actions.onSignIn).toHaveBeenCalledOnce();
});

it("renders nothing without an account service and without availability", async () => {
  await render({ phase: "unavailable" }, presence(true));
  expect(container.innerHTML).toBe("");
});
