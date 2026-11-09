// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Capability, SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { AccountConnection } from "./AccountConnection";

const openExternal = vi.hoisted(() => vi.fn(async (_url: string) => undefined));
vi.mock("../../../../platform/tauri/openExternal", () => ({ openExternal }));
vi.mock("./platform/TelegramChannelConnect", () => ({
  TelegramChannelConnect: () => createElement("div", { "data-testid": "telegram-connect" }),
}));
vi.mock("./platform/XProfileEditor", () => ({
  XProfileEditor: () => createElement("div", { "data-testid": "x-profile" }),
}));

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  openExternal.mockClear();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

const account = (patch: Partial<SocialAccount> = {}): SocialAccount =>
  ({
    id: "a1",
    platform: "x",
    name: "Studio",
    accountType: "member",
    connection: "oauth",
    connected: false,
    paused: false,
    grants: {},
    executorId: "e1",
    ...patch,
  }) as unknown as SocialAccount;

const expiredPublish: Capability = {
  operation: "publish",
  status: "expired",
  reason: "",
  reasonCode: "api.token_expired",
  scopes: [],
  source: "api",
} as unknown as Capability;

function fakeClient(patch: Record<string, unknown> = {}) {
  return {
    browserBegin: vi.fn(async () => ({ status: "waiting", expiresAt: 1 })),
    browserStatus: vi.fn(async () => ({ status: "connected" })),
    oauthBegin: vi.fn(async () => ({ url: "https://example.test/authorize", expiresAt: 1 })),
    oauthStatus: vi.fn(async () => ({ status: "waiting", candidates: [] })),
    oauthSelect: vi.fn(async () => ({})),
    tokenConnect: vi.fn(async () => ({})),
    request: vi.fn(async () => ({})),
    ...patch,
  };
}

function render(
  client: ReturnType<typeof fakeClient>,
  props: {
    account?: SocialAccount;
    capabilities?: Capability[];
    disabled?: boolean;
    onThisComputer?: boolean;
    onChanged?: () => void;
  } = {},
) {
  const onChanged = props.onChanged ?? vi.fn();
  act(() =>
    root.render(
      createElement(AccountConnection, {
        client: client as unknown as SocialClient,
        account: props.account ?? account(),
        capabilities: props.capabilities ?? [],
        onThisComputer: props.onThisComputer ?? true,
        disabled: props.disabled ?? false,
        onChanged,
      }),
    ),
  );
  return onChanged;
}

function button(text: string) {
  return [...element.querySelectorAll("button")].find((node) => node.textContent === text);
}

function typeInto(input: HTMLInputElement | null | undefined, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("opens the platform consent page in the browser and does not treat the connection as made", async () => {
  const client = fakeClient();
  const onChanged = render(client);
  await act(async () => button("Connect in browser")?.click());
  expect(client.oauthBegin).toHaveBeenCalledWith("a1", undefined, ["publish"]);
  expect(openExternal).toHaveBeenCalledWith("https://example.test/authorize");
  // Opening the consent page is not a connection: nothing is refreshed and no grant is written.
  expect(onChanged).not.toHaveBeenCalled();
  expect(client.request).not.toHaveBeenCalled();
  expect(client.oauthSelect).not.toHaveBeenCalled();
});

it("offers the account the platform returned only as an explicit choice and refreshes after it", async () => {
  const client = fakeClient({
    oauthStatus: vi.fn(async () => ({
      status: "selection",
      candidates: [
        { id: "c1", name: "First candidate" },
        { id: "c2", name: "Second candidate" },
      ],
    })),
  });
  const onChanged = render(client);
  await act(async () => button("Check connection")?.click());
  expect(client.oauthStatus).toHaveBeenCalledWith("a1");
  expect(element.querySelector('[aria-label="Choose the account to connect"]')).not.toBeNull();
  // Nothing is selected for the owner.
  expect(client.oauthSelect).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
  await act(async () => button("Second candidate")?.click());
  expect(client.oauthSelect).toHaveBeenCalledExactlyOnceWith("a1", "c2");
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("shows the platform's own error from the status check", async () => {
  const client = fakeClient({
    oauthStatus: vi.fn(async () => ({
      status: "failed",
      candidates: [],
      error: "Access was denied.",
    })),
  });
  render(client);
  await act(async () => button("Check connection")?.click());
  expect(element.textContent).toContain("Access was denied.");
});

it("keeps an organization account from starting until the numeric organization ID is entered", async () => {
  const client = fakeClient();
  render(client, { account: account({ platform: "linkedin", accountType: "organization" }) });
  const start = () => button("Connect in browser");
  expect(start()?.disabled).toBe(true);
  const field = element.querySelector<HTMLInputElement>("input");
  typeInto(field, "12ab");
  expect(start()?.disabled).toBe(true);
  typeInto(field, "123456");
  expect(start()?.disabled).toBe(false);
  await act(async () => start()?.click());
  expect(client.oauthBegin).toHaveBeenCalledWith("a1", "123456", ["publish"]);
});

it("starts the browser sign-in from the row, the owner finishes it there, and a status check reports it", async () => {
  const client = fakeClient();
  const onChanged = render(client, {
    account: account({ connection: "browser", connected: true }),
    capabilities: [
      { ...expiredPublish, reasonCode: "browser.reconnect", source: "browser" } as Capability,
    ],
  });
  await act(async () => button("Connect")?.click());
  expect(client.browserBegin).toHaveBeenCalledWith("a1", undefined);
  expect(element.textContent).toContain("Waiting for you");
  expect(button("Sign in again in the browser")).toBeTruthy();
  await act(async () => button("Check connection")?.click());
  expect(client.browserStatus).toHaveBeenCalledWith("a1");
  expect(element.textContent).toContain("Connected");
  // The Host owns the verified state; starting or checking the sign-in never writes a grant.
  expect(client.request).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
});

it("labels the first browser sign-in differently from signing in again", () => {
  render(fakeClient(), { account: account({ connection: "browser", connected: false }) });
  expect(button("Sign in in the browser")).toBeTruthy();
  expect(button("Sign in again in the browser")).toBeUndefined();
});

it("says plainly when the sign-in could not be started and keeps the actions available", async () => {
  const client = fakeClient({
    browserBegin: vi.fn(async () => {
      throw new Error("The browser profile is busy.");
    }),
  });
  render(client, { account: account({ connection: "browser" }) });
  await act(async () => button("Sign in in the browser")?.click());
  expect(element.textContent).toContain("The browser profile is busy.");
  expect(button("Sign in in the browser")?.disabled).toBe(false);
});

it("connects a token account with the account id only, because the Host holds the credential", async () => {
  const client = fakeClient();
  const onChanged = render(client, {
    account: account({ platform: "whatsapp", accountType: "business", connection: "token" }),
  });
  expect(element.querySelector('input[type="password"]')).toBeNull();
  await act(async () => button("Connect")?.click());
  expect(client.tokenConnect).toHaveBeenCalledExactlyOnceWith("a1");
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("does not refresh as connected when the token connection fails", async () => {
  const client = fakeClient({
    tokenConnect: vi.fn(async () => {
      throw new Error("The token was refused.");
    }),
  });
  const onChanged = render(client, {
    account: account({ platform: "whatsapp", accountType: "business", connection: "token" }),
  });
  await act(async () => button("Connect")?.click());
  expect(onChanged).not.toHaveBeenCalled();
  expect(element.textContent).toContain("The token was refused.");
});

it("uses the channel review for Telegram and offers no one-click Connect on its capability rows", () => {
  render(fakeClient(), {
    account: account({ platform: "telegram", accountType: "channel", connection: "token" }),
    capabilities: [expiredPublish],
  });
  expect(element.querySelector('[data-testid="telegram-connect"]')).not.toBeNull();
  expect(button("Connect")).toBeUndefined();
  expect(button("Connect in browser")).toBeUndefined();
});

it("shows the X profile editor only for a connected X account", () => {
  render(fakeClient(), { account: account({ platform: "x", connected: false }) });
  expect(element.querySelector('[data-testid="x-profile"]')).toBeNull();
  render(fakeClient(), { account: account({ platform: "x", connected: true }) });
  expect(element.querySelector('[data-testid="x-profile"]')).not.toBeNull();
});

it("starts nothing while the Host is offline", () => {
  const client = fakeClient();
  render(client, {
    account: account({ connected: true }),
    capabilities: [expiredPublish],
    disabled: true,
  });
  expect(button("Connect")).toBeUndefined();
  expect(button("Reconnect in browser")?.disabled).toBe(true);
  expect(button("Check connection")?.disabled).toBe(true);
  expect(client.oauthBegin).not.toHaveBeenCalled();
});

it("says on which computer the account is connected", () => {
  render(fakeClient(), { onThisComputer: false });
  expect(element.textContent).toContain("This account is connected on another computer.");
});
