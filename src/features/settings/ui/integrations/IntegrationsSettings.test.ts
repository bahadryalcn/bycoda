// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { EmailAccountsSettings } from "./EmailAccountsSettings";
import { INTEGRATIONS } from "./IntegrationsSettings";
import { SlackSettings } from "./SlackSettings";
import { TeamsSettings } from "./TeamsSettings";
import { MessagingAccountsCard, type AccountFormProps } from "./MessagingAccountsCard";
import type { MessagingAccount } from "../../../messaging";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(invoke).mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const input = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
async function fill(label: string, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input(label),
      value,
    );
    input(label).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    item.textContent?.includes(label),
  );
async function toggle(label: string) {
  const control = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  expect(control, label).not.toBeNull();
  await act(async () => control!.click());
}
async function click(label: string) {
  expect(button(label), label).toBeDefined();
  await act(async () => button(label)!.click());
}

const account = (overrides: Partial<MessagingAccount> = {}): MessagingAccount => ({
  id: "acct-1",
  provider: "email" as const,
  label: "owner@example.com",
  identity: "owner@example.com",
  config: { preset: "gmail", address: "owner@example.com", auth: "password" },
  connected: true,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

it("retains account and new-account drafts while switching and locks pending saves", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "messaging_list_accounts")
      return [account(), account({ id: "acct-2", label: "Second" })];
    if (command === "messaging_save_account")
      return new Promise((resolve) => {
        finish = resolve;
      });
    throw new Error(`Unexpected command: ${command}`);
  });
  await act(async () => root.render(createElement(EmailAccountsSettings)));
  expect(container.textContent).toContain("Configured");
  const edit = async (index: number) => {
    const row = container.querySelectorAll('[role="listitem"]')[index]!;
    await act(async () =>
      [...row.querySelectorAll("button")].find((item) => item.textContent === "Edit")!.click(),
    );
  };
  const visibleInput = () =>
    [...container.querySelectorAll<HTMLInputElement>('input[aria-label="Display name"]')].find(
      (item) => !item.closest("[hidden]"),
    )!;
  const name = async (value: string) =>
    act(async () => {
      const field = visibleInput();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await edit(0);
  await name("Draft A");
  await edit(1);
  await name("Draft B");
  await edit(0);
  expect(visibleInput().value).toBe("Draft A");
  await click("Add account");
  await name("New draft");
  await edit(1);
  expect(visibleInput().value).toBe("Draft B");
  await click("Add account");
  expect(visibleInput().value).toBe("New draft");
  await edit(0);
  await click("Save and test connection");
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('[role="listitem"] button')].every(
      (item) => item.disabled,
    ),
  ).toBe(true);
  expect(button("Add account")?.disabled).toBe(true);
  await act(async () => finish(account()));
  await edit(1);
  expect(visibleInput().value).toBe("Draft B");
});

it("applies a late form completion only to its original account", async () => {
  vi.mocked(invoke).mockResolvedValue([account(), account({ id: "acct-2", label: "Second" })]);
  const callbacks = new Map<string, AccountFormProps>();
  function Form(props: AccountFormProps) {
    callbacks.set(props.account!.id, props);
    return createElement("div", null, `Editing ${props.account!.id}`);
  }
  await act(async () =>
    root.render(
      createElement(MessagingAccountsCard, {
        provider: "email",
        emptyLabel: "No accounts",
        addLabel: "Add",
        describe: (value) => value.identity,
        Form,
      }),
    ),
  );
  const edit = async (index: number) =>
    act(async () => {
      const row = container.querySelectorAll('[role="listitem"]')[index]!;
      [...row.querySelectorAll("button")].find((item) => item.textContent === "Edit")!.click();
    });
  await edit(0);
  await edit(1);
  // Browser sign-ins can finish in hidden forms; each pending owner must stay locked.
  await act(async () => callbacks.get("acct-1")!.onSavingChange!(true));
  await act(async () => callbacks.get("acct-2")!.onSavingChange!(true));
  await act(async () => callbacks.get("acct-2")!.onSavingChange!(false));
  expect(
    [...container.querySelectorAll<HTMLButtonElement>('[role="listitem"] button')].every(
      (item) => item.disabled,
    ),
  ).toBe(true);
  await act(async () => callbacks.get("acct-1")!.onSavingChange!(false));
  await act(async () => callbacks.get("acct-1")!.onSaved(account()));
  expect(
    [...container.querySelectorAll("div")].some(
      (item) => item.textContent === "Editing acct-2" && !item.closest("[hidden]"),
    ),
  ).toBe(true);
});

it("lists only the messaging providers that are switched on", () => {
  const ids = INTEGRATIONS.map((item) => item.id);
  expect(ids).toEqual(expect.arrayContaining(["github", "email", "slack"]));
  expect(ids).not.toContain("discord");
  expect(ids).not.toContain("teams");
});

it("keeps a rejected email draft, then lists the verified account", async () => {
  const saved: unknown[] = [];
  let reject = true;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "messaging_list_accounts") return saved;
    if (command === "messaging_save_account") {
      if (reject) throw new Error("IMAP login failed");
      saved.push(account());
      return saved[0];
    }
    throw new Error(`Unexpected command: ${command} ${JSON.stringify(args)}`);
  });
  await act(async () => root.render(createElement(EmailAccountsSettings)));
  expect(container.textContent).toContain("No email accounts connected yet.");
  await toggle("Use an app password instead");
  await fill("Email address", "owner@example.com");
  await fill("Password or app password", "app-password-fixture");
  await click("Save and test connection");
  expect(container.textContent).toContain("IMAP login failed");
  expect(input("Password or app password").value).toBe("app-password-fixture");

  reject = false;
  await click("Retry save and test");
  const save = vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "messaging_save_account");
  expect(save).toHaveLength(2);
  expect(save[1]![1]).toMatchObject({
    input: { provider: "email", secret: { password: "app-password-fixture" } },
  });
  expect(container.textContent).toContain("Connected as owner@example.com.");
  expect(container.querySelector('input[aria-label="Password or app password"]')).toBeNull();
  expect(button("Add account")).toBeDefined();
});

const browserStart = (handle: string) => ({
  handle,
  authorizeUrl: `https://accounts.example.com/authorize?state=${handle}`,
  expiresIn: 300,
});

it("signs Gmail in through the browser and saves the handle without a password", async () => {
  vi.useFakeTimers();
  let polls = 0;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "messaging_list_accounts") return [];
    if (command === "messaging_browser_sign_in_start") return browserStart("browser-1");
    if (command === "messaging_browser_sign_in_poll") {
      polls += 1;
      return polls < 2
        ? { status: "pending" }
        : { status: "done", identity: "owner@gmail.example" };
    }
    if (command === "messaging_save_account") return account({ config: { auth: "google" } });
    throw new Error(`Unexpected command: ${command} ${JSON.stringify(args)}`);
  });
  await act(async () => root.render(createElement(EmailAccountsSettings)));
  expect(container.querySelector('input[aria-label="Password or app password"]')).toBeNull();
  await click("Sign in with Google");
  expect(invoke).toHaveBeenCalledWith("messaging_browser_sign_in_start", {
    purpose: "google",
    clientId: null,
    clientSecret: null,
    loginHint: null,
  });
  expect(openUrl).toHaveBeenCalledWith("https://accounts.example.com/authorize?state=browser-1");
  expect(container.textContent).toContain("Finish signing in in your browser…");
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(polls).toBe(2);
  expect(container.textContent).toContain("Signed in as owner@gmail.example");
  expect(input("Email address").value).toBe("owner@gmail.example");
  await click("Save and test connection");
  const save = vi
    .mocked(invoke)
    .mock.calls.find(([command]) => command === "messaging_save_account");
  expect(save?.[1]).toMatchObject({
    input: {
      provider: "email",
      authHandle: "browser-1",
      config: { preset: "gmail", auth: "google", address: "owner@gmail.example" },
    },
  });
  expect((save![1] as { input: object }).input).not.toHaveProperty("secret");
});

it("offers the app password when Google sign-in is refused", async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "messaging_list_accounts") return [];
    if (command === "messaging_browser_sign_in_start") return browserStart("browser-2");
    if (command === "messaging_browser_sign_in_poll")
      return { status: "denied", error: "Google refused this sign-in." };
    throw new Error(`Unexpected command: ${command} ${JSON.stringify(args)}`);
  });
  vi.useFakeTimers();
  await act(async () => root.render(createElement(EmailAccountsSettings)));
  expect(container.textContent).toContain("Can't sign in with Google?");
  await click("Sign in with Google");
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(container.textContent).toContain("Google refused this sign-in.");
  expect(container.textContent).not.toContain("Can't sign in with Google?");
  await click("Use an app password instead");
  expect(input("Password or app password")).not.toBeNull();
  expect(button("Sign in with Google")).toBeUndefined();
});

it("saves Slack after browser sign-in and cancels a pending sign-in on unmount", async () => {
  vi.useFakeTimers();
  let done = false;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "messaging_list_accounts") return [];
    if (command === "messaging_browser_sign_in_start") return browserStart("slack-1");
    if (command === "messaging_browser_sign_in_poll")
      return done ? { status: "done", identity: "Example Team" } : { status: "pending" };
    if (command === "messaging_browser_sign_in_cancel") return undefined;
    if (command === "messaging_save_account")
      return account({ provider: "slack", identity: "Example Team", config: {} });
    throw new Error(`Unexpected command: ${command} ${JSON.stringify(args)}`);
  });
  await act(async () => root.render(createElement(SlackSettings)));
  await click("Sign in with Slack");
  await click("Open again");
  expect(openUrl).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  done = true;
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  expect(invoke).toHaveBeenCalledWith("messaging_save_account", {
    input: { provider: "slack", config: {}, authHandle: "slack-1" },
  });

  await act(async () => root.unmount());
  root = createRoot(container);
  done = false;
  await act(async () => root.render(createElement(SlackSettings)));
  await click("Sign in with Slack");
  await act(async () => root.unmount());
  expect(invoke).toHaveBeenCalledWith("messaging_browser_sign_in_cancel", { handle: "slack-1" });
  root = createRoot(container);
});

it("does not read a failed account list as no accounts", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("Native unavailable"));
  await act(async () => root.render(createElement(EmailAccountsSettings)));
  expect(container.textContent).toContain("Native unavailable");
  expect(container.textContent).not.toContain("No email accounts connected yet.");
  expect(container.querySelector('input[aria-label="Email address"]')).toBeNull();
});

it("polls Microsoft sign-in at the returned interval and saves Teams with the handle", async () => {
  vi.useFakeTimers();
  let polls = 0;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "messaging_list_accounts") return [];
    if (command === "messaging_microsoft_device_start")
      return {
        handle: "device-1",
        userCode: "ABCD-1234",
        verificationUri: "https://microsoft.com/devicelogin",
        expiresIn: 900,
        interval: 2,
        message: "",
      };
    if (command === "messaging_microsoft_device_poll") {
      polls += 1;
      return { status: polls < 2 ? "pending" : "done" };
    }
    if (command === "messaging_save_account")
      return account({
        provider: "teams",
        identity: "owner@contoso.example",
        config: { tenant: "common" },
      });
    throw new Error(`Unexpected command: ${command} ${JSON.stringify(args)}`);
  });
  await act(async () => root.render(createElement(TeamsSettings)));
  await click("Sign in with Microsoft");
  expect(container.textContent).toContain("ABCD-1234");
  await act(async () => vi.advanceTimersByTimeAsync(1999));
  expect(polls).toBe(0);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(polls).toBe(1);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(polls).toBe(2);
  expect(invoke).toHaveBeenCalledWith("messaging_save_account", {
    input: { provider: "teams", config: { tenant: "common" }, authHandle: "device-1" },
  });
});

it("shows a sign-in start failure inline and stops", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "messaging_list_accounts") return [];
    if (command === "messaging_microsoft_device_start")
      throw new Error("Microsoft sign-in needs an app registration client ID.");
    throw new Error(`Unexpected command: ${command}`);
  });
  await act(async () => root.render(createElement(TeamsSettings)));
  await click("Sign in with Microsoft");
  expect(container.textContent).toContain("needs an app registration");
  expect(
    vi.mocked(invoke).mock.calls.some(([command]) => command === "messaging_microsoft_device_poll"),
  ).toBe(false);
});
