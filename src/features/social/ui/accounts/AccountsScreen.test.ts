// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialAccount, SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { remoteRequest } from "../../../connections/public/connections";
import { AccountsScreen } from "./AccountsScreen";

// The detail, dialog and general cards are covered by their own tests; this file covers the list.
vi.mock("../../../connections/model/connections", () => ({
  remoteRequest: vi.fn(async () => []),
}));
vi.mock("./GeneralSettings", () => ({ GeneralSettings: () => null }));
vi.mock("./AccountDetail", () => ({
  AccountDetail: (props: { account: { id: string } }) =>
    createElement("div", {
      "data-testid": "detail",
      "data-account": props.account.id,
    }),
}));
vi.mock("./ConnectAccountDialog", () => ({
  ConnectAccountDialog: (props: { onClose(): void; onCreated(id: string): void }) =>
    createElement(
      "div",
      { "data-testid": "connect-dialog" },
      createElement("button", { "data-testid": "close-dialog", onClick: props.onClose }, "close"),
      createElement(
        "button",
        {
          "data-testid": "create-dialog",
          onClick: () => props.onCreated("a2"),
        },
        "create",
      ),
    ),
}));
vi.mock("../../../../shared/ui/Sheet", () => ({
  Sheet: (props: { title: string; onClose(): void; children: unknown }) =>
    createElement(
      "div",
      { "data-testid": "sheet", "aria-label": props.title },
      createElement("button", { "data-testid": "close-sheet", onClick: props.onClose }, "close"),
      props.children as never,
    ),
}));

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

const account = (id: string, patch: Partial<SocialAccount> = {}) =>
  ({
    id,
    platform: "instagram",
    name: `Account ${id}`,
    connected: true,
    paused: false,
    grants: {},
    executorId: "e1",
    ...patch,
  }) as SocialAccount;

const snapshot = (accounts: SocialAccount[]): SocialSnapshot =>
  ({
    accounts,
    capabilities: {},
    executorId: "e1",
    hostOnline: true,
    sendingEnabled: false,
    stopped: false,
    pollingEnabled: false,
    policies: { global: {}, platforms: {} },
  }) as unknown as SocialSnapshot;

function client(sectionSnapshot: () => Promise<unknown>): SocialClient {
  return {
    sectionSnapshot,
    browser: { needsHuman: { list: async () => ({ items: [] }) } },
  } as unknown as SocialClient;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function props(sectionSnapshot: () => Promise<unknown>) {
  return {
    client: client(sectionSnapshot),
    machineId: "m1",
    shellState: { hostOnline: true, unreachable: false, aiStopped: false },
    active: true,
    onNavigate: vi.fn(),
  };
}

it("shows the one primary action and a plain empty sentence, without a repeated title", async () => {
  const read = vi.fn(async () => ({ snapshot: snapshot([]) }));
  act(() => root.render(createElement(AccountsScreen, props(read))));
  await flush();
  expect(element.querySelector("h2")).toBeNull();
  expect(element.textContent).toContain("No accounts yet. Connect one to start.");
  expect(
    [...element.querySelectorAll("button")].some(
      (button) => button.textContent === "Connect account",
    ),
  ).toBe(true);
});

it("lists each account by name and shows health text only when it needs attention", async () => {
  const accounts = [account("a1", { connection: "browser" }), account("a2", { connected: false })];
  act(() =>
    root.render(
      createElement(
        AccountsScreen,
        props(async () => ({ snapshot: snapshot(accounts) })),
      ),
    ),
  );
  await flush();
  const rows = element.querySelectorAll(".social-account-row");
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("Account a1");
  expect(rows[0]?.textContent).not.toContain("Connected");
  expect(rows[1]?.querySelector('[aria-label="Connection needed"]')).not.toBeNull();
});

it("keeps a retry line when the accounts cannot be read and offers Try again", async () => {
  const read = vi.fn(async () => {
    throw new Error("offline");
  });
  act(() => root.render(createElement(AccountsScreen, props(read))));
  await flush();
  expect(element.textContent).toContain("Could not reach this computer.");
  const retry = [...element.querySelectorAll("button")].find(
    (button) => button.textContent === "Try again",
  );
  expect(retry).toBeTruthy();
  act(() => retry?.click());
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
});

it("does not read the accounts while the screen is hidden", async () => {
  const read = vi.fn(async () => ({ snapshot: snapshot([]) }));
  act(() => root.render(createElement(AccountsScreen, { ...props(read), active: false })));
  await flush();
  expect(read).not.toHaveBeenCalled();
});

it("waits for a slow account poll to settle before starting another round (#1060)", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(remoteRequest).mockClear();
    const response = { snapshot: snapshot([]) };
    let finish!: (value: typeof response) => void;
    const read = vi
      .fn(async () => response)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const input = props(read);
    const needsHuman = vi.spyOn(input.client.browser.needsHuman, "list");
    await act(async () => root.render(createElement(AccountsScreen, input)));
    await act(async () => vi.advanceTimersByTimeAsync(180_000));
    expect(read).toHaveBeenCalledTimes(1);
    expect(needsHuman).toHaveBeenCalledTimes(1);
    await act(async () => finish(response));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(read).toHaveBeenCalledTimes(2);
    expect(needsHuman).toHaveBeenCalledTimes(2);
    expect(remoteRequest).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("opens the Connect account dialog from the header and closes it again", async () => {
  const read = vi.fn(async () => ({ snapshot: snapshot([account("a1")]) }));
  act(() => root.render(createElement(AccountsScreen, props(read))));
  await flush();
  expect(element.querySelector('[data-testid="connect-dialog"]')).toBeNull();
  const connect = [...element.querySelectorAll("button")].find(
    (node) => node.textContent === "Connect account",
  );
  await act(async () => connect?.click());
  expect(element.querySelector('[data-testid="connect-dialog"]')).not.toBeNull();
  await act(async () =>
    element.querySelector<HTMLButtonElement>('[data-testid="close-dialog"]')?.click(),
  );
  expect(element.querySelector('[data-testid="connect-dialog"]')).toBeNull();
});

it("opens the detail of a new account after it is created and reads the list again", async () => {
  const read = vi.fn(async () => ({
    snapshot: snapshot([account("a1"), account("a2")]),
  }));
  act(() => root.render(createElement(AccountsScreen, props(read))));
  await flush();
  const connect = [...element.querySelectorAll("button")].find(
    (node) => node.textContent === "Connect account",
  );
  await act(async () => connect?.click());
  await act(async () =>
    element.querySelector<HTMLButtonElement>('[data-testid="create-dialog"]')?.click(),
  );
  await flush();
  expect(element.querySelector('[data-testid="connect-dialog"]')).toBeNull();
  expect(element.querySelector('[data-testid="detail"]')?.getAttribute("data-account")).toBe("a2");
  expect(read).toHaveBeenCalledTimes(2);
});

it("opens the account's detail when its row is chosen and closes it with the sheet", async () => {
  const read = vi.fn(async () => ({
    snapshot: snapshot([account("a1"), account("a2")]),
  }));
  act(() => root.render(createElement(AccountsScreen, props(read))));
  await flush();
  expect(element.querySelector('[data-testid="detail"]')).toBeNull();
  const rows = element.querySelectorAll<HTMLButtonElement>(".social-account-row");
  await act(async () => rows[1]?.click());
  expect(element.querySelector('[data-testid="sheet"]')?.getAttribute("aria-label")).toBe(
    "Account a2",
  );
  expect(element.querySelector('[data-testid="detail"]')?.getAttribute("data-account")).toBe("a2");
  await act(async () =>
    element.querySelector<HTMLButtonElement>('[data-testid="close-sheet"]')?.click(),
  );
  expect(element.querySelector('[data-testid="detail"]')).toBeNull();
});

it("says why a new account cannot be connected while this computer cannot be reached", async () => {
  const read = vi.fn(async () => ({ snapshot: snapshot([]) }));
  act(() =>
    root.render(
      createElement(AccountsScreen, {
        ...props(read),
        shellState: { hostOnline: false, unreachable: true, aiStopped: false },
      }),
    ),
  );
  await flush();
  const reasons = [...element.querySelectorAll(".social-disabled-reason-text")].map(
    (node) => node.textContent,
  );
  expect(reasons).toContain("Could not reach this computer.");
});

it("leaves the offline Host notice to the shell", async () => {
  const offline = {
    ...snapshot([account("a1")]),
    hostOnline: false,
  } as SocialSnapshot;
  act(() =>
    root.render(
      createElement(
        AccountsScreen,
        props(async () => ({ snapshot: offline })),
      ),
    ),
  );
  await flush();
  expect(element.textContent).not.toContain("Scheduling is offline");
});

it("shows unknown health and retry when intervention read fails", async () => {
  const input = props(async () => ({ snapshot: snapshot([account("a1")]) }));
  input.client.browser.needsHuman.list = vi.fn(async () => {
    throw new Error("offline");
  });
  act(() => root.render(createElement(AccountsScreen, input)));
  await flush();
  expect(element.textContent).toContain("Could not check whether accounts need your attention.");
  expect(element.querySelector('[aria-label="Connection status unknown"]')).not.toBeNull();
  expect(element.textContent).toContain("Try again");
});
