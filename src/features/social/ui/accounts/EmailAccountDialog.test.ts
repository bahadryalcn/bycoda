// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialClient } from "../../model/socialClient";
import { EmailAccountDialog } from "./EmailAccountDialog";

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

function render(save: ReturnType<typeof vi.fn>) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const client = { email: { accounts: { save } } } as unknown as SocialClient;
  act(() => root.render(createElement(EmailAccountDialog, { client, onClose, onCreated })));
  return { onClose, onCreated };
}

function field(label: string) {
  const owner = [...element.querySelectorAll("label")].find((node) =>
    node.textContent?.trim().startsWith(label),
  );
  expect(owner, `Missing field: ${label}`).toBeTruthy();
  return document.getElementById(owner?.htmlFor ?? "") as HTMLInputElement;
}

function typeInto(label: string, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const input = field(label);
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function fillValid() {
  typeInto("Name", "Newsletter");
  typeInto("Sender address", "hello@example.com");
  typeInto("Unsubscribe link", "https://example.com/unsubscribe");
  typeInto("SMTP server", "smtp.example.com");
  typeInto("SMTP password", "fixture-secret");
}

const submit = () =>
  act(async () => {
    element
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

const reasons = () =>
  [...element.querySelectorAll(".social-disabled-reason-text")].map((node) => node.textContent);

const saveButton = () =>
  [...element.querySelectorAll("button")].find((node) => node.textContent === "Save email account");

it("walks the owner through what is missing before the account can be saved", () => {
  render(vi.fn());
  expect(saveButton()?.disabled).toBe(true);
  expect(reasons()).toEqual(["Enter a name for this email account."]);
  typeInto("Name", "Newsletter");
  typeInto("Sender address", "hello@example.com");
  expect(reasons()).toEqual(["Add an unsubscribe link before sending email."]);
  typeInto("Unsubscribe link", "http://example.com/unsubscribe");
  expect(reasons()).toEqual(["The unsubscribe link must start with https://."]);
});

it("does not save without an unsubscribe link even when the form is submitted", async () => {
  const save = vi.fn(async () => ({ id: "e1" }));
  render(save);
  typeInto("Name", "Newsletter");
  typeInto("Sender address", "hello@example.com");
  typeInto("SMTP server", "smtp.example.com");
  typeInto("SMTP password", "fixture-secret");
  await submit();
  expect(save).not.toHaveBeenCalled();
});

it("saves a valid SMTP account once, with the secret sent to the Host and the new id reported", async () => {
  const save = vi.fn(async () => ({ id: "e1" }));
  const { onCreated } = render(save);
  fillValid();
  expect(saveButton()?.disabled).toBe(false);
  await submit();
  expect(save).toHaveBeenCalledExactlyOnceWith({
    kind: "smtp",
    from: "hello@example.com",
    name: "Newsletter",
    unsubscribeUrl: "https://example.com/unsubscribe",
    secret: "fixture-secret",
    host: "smtp.example.com",
    port: 587,
    secure: false,
  });
  expect(onCreated).toHaveBeenCalledExactlyOnceWith("e1");
});

it("hides the secret value in a password field", () => {
  render(vi.fn());
  expect(field("SMTP password").type).toBe("password");
});

it("keeps the form and shows the failure when the Host refuses the account", async () => {
  const save = vi.fn(async () => {
    throw new Error("The unsubscribe link is not reachable.");
  });
  const { onCreated } = render(save);
  fillValid();
  await submit();
  expect(element.textContent).toContain("The unsubscribe link is not reachable.");
  expect(field("Name").value).toBe("Newsletter");
  expect(onCreated).not.toHaveBeenCalled();
});

it("closes without saving when the owner cancels", async () => {
  const save = vi.fn();
  const { onClose } = render(save);
  fillValid();
  const cancel = [...element.querySelectorAll("button")].find(
    (node) => node.textContent === "Cancel",
  );
  await act(async () => cancel?.click());
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
});
