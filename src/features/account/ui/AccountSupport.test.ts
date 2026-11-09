// @vitest-environment happy-dom
import { AccountApiError } from "@bycoda/account-contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSupport, GuestSupport } from "./AccountSupport";

const mocks = vi.hoisted(() => ({
  createSupportTicket: vi.fn(),
  openExternal: vi.fn(async (_url: string) => undefined),
}));
vi.mock("../../../shared/lib/productIdentity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/lib/productIdentity")>();
  return {
    PRODUCT_IDENTITY: {
      ...actual.PRODUCT_IDENTITY,
      repositoryUrl: "https://github.com/example/bycoda",
    },
  };
});
vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: mocks.openExternal }));
vi.mock("../model/accountApi", () => ({
  accountApi: () => ({ createSupportTicket: mocks.createSupportTicket }),
  reportAccountFailure: vi.fn(async () => undefined),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === name)!;
async function click(element: Element) {
  await act(async () => (element as HTMLElement).click());
}
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const subject = () => container.querySelector("input") as HTMLInputElement;
const message = () => container.querySelector("textarea") as HTMLTextAreaElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("support tab", () => {
  it("says nothing is attached and not to paste secrets", async () => {
    await act(async () => root.render(createElement(AccountSupport)));
    expect(container.textContent).toContain("Nothing from your sessions, code, logs or file paths");
    expect(container.textContent).toContain("Do not paste passwords, tokens");
  });

  it("asks for a subject and a message without calling the API", async () => {
    await act(async () => root.render(createElement(AccountSupport)));
    await click(button("Send to support"));
    expect(container.textContent).toContain("Add a subject.");
    expect(container.textContent).toContain("Add a message.");
    expect(mocks.createSupportTicket).not.toHaveBeenCalled();
  });

  it("sends the ticket, shows the reference and clears the form", async () => {
    mocks.createSupportTicket.mockResolvedValue({
      id: "tkt_42",
      createdAt: "2026-11-08T10:00:00Z",
    });
    await act(async () => root.render(createElement(AccountSupport)));
    type(subject(), "Sync stuck");
    type(message(), "It never finishes.");
    await click(button("Send to support"));
    expect(mocks.createSupportTicket).toHaveBeenCalledWith({
      body: { subject: "Sync stuck", body: "It never finishes.", category: "bug" },
    });
    expect(container.textContent).toContain("Reference: tkt_42");
    expect(subject().value).toBe("");
  });

  it("keeps the draft after a rate limit and after another failure", async () => {
    mocks.createSupportTicket.mockRejectedValueOnce(
      new AccountApiError(429, "rate_limited", "slow", "req_1"),
    );
    await act(async () => root.render(createElement(AccountSupport)));
    type(subject(), "Sync stuck");
    type(message(), "It never finishes.");
    await click(button("Send to support"));
    expect(container.textContent).toContain("Too many requests");
    expect(subject().value).toBe("Sync stuck");
    expect(message().value).toBe("It never finishes.");

    mocks.createSupportTicket.mockRejectedValueOnce(new TypeError("network"));
    await click(button("Send to support"));
    expect(container.textContent).toContain("Your message is kept");
    expect(message().value).toBe("It never finishes.");
  });
});

describe("guest support", () => {
  it("offers only the e-mail link", async () => {
    await act(async () => root.render(createElement(GuestSupport)));
    expect(container.querySelector("input, textarea")).toBeNull();
    await click(button("Contact by e-mail"));
    expect(mocks.openExternal).toHaveBeenCalledWith("mailto:info@bycoda.codes");
  });

  it("opens the project repository from the Support section", async () => {
    await act(async () => root.render(createElement(GuestSupport)));
    await click(button("View on GitHub"));
    expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/example/bycoda");
  });
});
