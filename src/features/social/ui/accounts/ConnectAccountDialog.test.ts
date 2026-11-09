// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostProject } from "../../../connections/model/protocol";
import type { SocialClient } from "../../model/socialClient";
import { ConnectAccountDialog } from "./ConnectAccountDialog";

vi.mock("../../../../shared/ui/Modal", () => ({
  Modal: (props: { title: string; children: ReactNode; footer: ReactNode }) =>
    createElement(
      "div",
      { role: "dialog", "aria-label": props.title },
      props.children,
      props.footer,
    ),
  ModalActions: (props: { children: ReactNode }) => createElement("div", null, props.children),
}));
vi.mock("./EmailAccountDialog", () => ({
  EmailAccountDialog: () => createElement("div", { "data-testid": "email-dialog" }),
}));

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.querySelectorAll('[role="listbox"]').forEach((node) => node.remove());
  element.remove();
});

const projects = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
] as unknown as HostProject[];

function fakeClient(create: ReturnType<typeof vi.fn> = vi.fn(async () => ({ id: "new-1" }))) {
  const client = {
    request: create,
    browserBegin: vi.fn(),
    oauthBegin: vi.fn(),
    tokenConnect: vi.fn(),
  };
  return { client, create };
}

function render(
  client: ReturnType<typeof fakeClient>["client"],
  props: { initialProjectId?: string; onClose?: () => void; onCreated?: (id: string) => void } = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const onCreated = props.onCreated ?? vi.fn();
  act(() =>
    root.render(
      createElement(ConnectAccountDialog, {
        client: client as unknown as SocialClient,
        projects,
        initialProjectId: props.initialProjectId,
        onClose,
        onCreated,
      }),
    ),
  );
  return { onClose, onCreated };
}

function button(text: string) {
  return [...element.querySelectorAll("button")].find((node) => node.textContent === text);
}

function nameInput() {
  const label = [...element.querySelectorAll("label")].find((node) =>
    node.textContent?.trim().startsWith("Name"),
  );
  return document.getElementById(label?.htmlFor ?? "") as HTMLInputElement;
}

function typeName(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const input = nameInput();
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submitForm() {
  return act(async () => {
    element
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function choose(trigger: string, option: string) {
  await act(async () =>
    element.querySelector<HTMLButtonElement>(`button[aria-label^="${trigger}: "]`)?.click(),
  );
  const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
    node.textContent?.includes(option),
  );
  expect(found, `Missing option: ${option}`).toBeTruthy();
  await act(async () => found?.click());
}

it("defaults to the official API and asks for a name before it connects", () => {
  const { client } = fakeClient();
  render(client);
  expect(element.querySelector('button[aria-label="Platform: X"]')).not.toBeNull();
  expect(element.querySelector('button[aria-label="How to connect: Official API"]')).not.toBeNull();
  expect(button("Connect")?.disabled).toBe(true);
  expect(element.textContent).toContain("Enter a name for this account.");
});

it("creates the account with the chosen projects and leaves the connection to its detail", async () => {
  const { client, create } = fakeClient();
  const { onCreated } = render(client, { initialProjectId: "p1" });
  typeName("  Launch account ");
  const beta = [...element.querySelectorAll("label")].find((node) => node.textContent === "Beta");
  act(() => beta?.querySelector("input")?.click());
  await submitForm();
  expect(create).toHaveBeenCalledExactlyOnceWith("accounts.create", {
    platform: "x",
    name: "Launch account",
    accountType: "member",
    connection: "oauth",
    projectIds: ["p1", "p2"],
  });
  expect(onCreated).toHaveBeenCalledExactlyOnceWith("new-1");
  // A new account is not connected: no sign-in, consent page or token call happens here.
  expect(client.browserBegin).not.toHaveBeenCalled();
  expect(client.oauthBegin).not.toHaveBeenCalled();
  expect(client.tokenConnect).not.toHaveBeenCalled();
});

it("switches to a token connection and the bot type when Telegram is chosen", async () => {
  const { client, create } = fakeClient();
  render(client);
  await choose("Platform", "Telegram");
  expect(
    element.querySelector('button[aria-label="How to connect: Token from this computer"]'),
  ).not.toBeNull();
  expect(element.querySelector('button[aria-label="Account type: Bot"]')).not.toBeNull();
  typeName("Channel bot");
  await submitForm();
  expect(create).toHaveBeenCalledWith(
    "accounts.create",
    expect.objectContaining({ platform: "telegram", accountType: "bot", connection: "token" }),
  );
});

it("uses a browser connection when the owner picks the browser sign-in", async () => {
  const { client, create } = fakeClient();
  render(client);
  await choose("How to connect", "Browser sign-in");
  typeName("Browser account");
  await submitForm();
  expect(create).toHaveBeenCalledWith(
    "accounts.create",
    expect.objectContaining({ platform: "x", connection: "browser", accountType: "member" }),
  );
});

it("keeps the entered name and shows the failure when the account cannot be created", async () => {
  const { client } = fakeClient(
    vi.fn(async () => {
      throw new Error("The Host is busy.");
    }),
  );
  const { onCreated } = render(client);
  typeName("Studio");
  await submitForm();
  expect(element.textContent).toContain("The Host is busy.");
  expect(nameInput().value).toBe("Studio");
  expect(onCreated).not.toHaveBeenCalled();
});

it("does not create anything when the name is blank", async () => {
  const { client, create } = fakeClient();
  render(client);
  typeName("   ");
  await submitForm();
  expect(create).not.toHaveBeenCalled();
});

it("closes without creating when the owner cancels", async () => {
  const { client, create } = fakeClient();
  const { onClose } = render(client);
  await act(async () => button("Cancel")?.click());
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(create).not.toHaveBeenCalled();
});

it("switches to the email account form from the same dialog", async () => {
  const { client } = fakeClient();
  render(client);
  await act(async () => button("Add an email account instead")?.click());
  expect(element.querySelector('[data-testid="email-dialog"]')).not.toBeNull();
});
