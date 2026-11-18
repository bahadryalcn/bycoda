// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialAccount, SocialDraft } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { InstagramDirectComposer } from "./InstagramDirectComposer";

const account = {
  id: "ig",
  platform: "instagram",
  platformId: "web:instagram:42",
  name: "Studio",
  connection: "browser",
  executorId: "host",
  connected: true,
  accessApproved: true,
  paused: false,
  grants: { "p1": ["message"] },
} as SocialAccount;
const projects = [{ id: "p1", name: "Launch", cwd: "fixture" }];
const text = "Hello Ada.\nHere is the artwork.";

let element: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

function button(label: string) {
  const found = [...document.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!found) throw new Error(`Missing button ${label}.`);
  return found;
}

function render(client: SocialClient, currentAccount = account) {
  act(() =>
    root.render(createElement(InstagramDirectComposer, {
      client,
      account: currentAccount,
      projects,
      disabled: false,
    })),
  );
}

function typeMessage() {
  const input = element.querySelector<HTMLInputElement>("input")!;
  const message = element.querySelector<HTMLTextAreaElement>("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "@Ada");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(message, text);
    message.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function fixture() {
  const draft: SocialDraft = {
    id: "draft-1",
    kind: "message",
    accountId: "ig",
    contactId: "contact-1",
    projectId: "p1",
    text,
    factIds: [],
    createdAt: 1,
  };
  const job = {
    id: "job-1",
    draftId: draft.id,
    accountId: account.id,
    kind: "message",
    status: "queued",
  };
  const browserInstagramRecipient = vi.fn(async () => ({ handle: "ada", platformId: "71" }));
  const send = vi.fn(async () => job);
  const jobs = vi.fn(async () => ({ jobs: [job] }));
  const request = vi.fn(async (action: string, _input: unknown, _requestId?: string) => {
    switch (action) {
      case "contacts.upsert":
        return { id: "contact-1", accountId: "ig", platformId: "71", projectIds: ["p1"] };
      case "messages.draft": return draft;
      case "drafts.approve": return draft;
      case "messages.send": return send();
      case "jobs.status": return jobs();
      default: throw new Error(`Unexpected fixture action ${action}.`);
    }
  });
  return {
    client: { browserInstagramRecipient, request } as unknown as SocialClient,
    browserInstagramRecipient, request, send, jobs, draft,
  };
}

it("reviews the verified recipient and exact saved draft before the owner queues a message", async () => {
  const { browserInstagramRecipient, client, draft, request } = fixture();
  render(client);
  typeMessage();
  await act(async () => button("Review Instagram message").click());
  expect(browserInstagramRecipient).toHaveBeenCalledExactlyOnceWith("ig", "ada");
  expect(request.mock.calls.map(([action]) => action)).toEqual(["contacts.upsert", "messages.draft"]);
  expect(request.mock.calls[0]![1]).toEqual({
    accountId: "ig", platformId: "71", name: "ada", instagramRecipientProjectId: "p1",
  });
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
  expect(dialog?.textContent).toContain("Queue this message from Studio to @ada for Launch?");
  expect(dialog?.querySelector("textarea")?.value).toBe(text);
  await act(async () => button("Queue Instagram message").click());
  expect(request.mock.calls[2]).toEqual(["drafts.approve", { id: draft.id, reviewedDraft: draft }, expect.any(String)]);
  expect(request.mock.calls[3]).toEqual(["messages.send", { id: draft.id }, expect.any(String)]);
  const requestIds = request.mock.calls.map(([, , id]) => id);
  expect(new Set(requestIds).size).toBe(4);
  expect(element.textContent).toContain("Instagram message queued. Check Activity for delivery.");
});

it("retains an uncertain send on return and checks only the original job", async () => {
  const { client, jobs, request, send } = fixture();
  send.mockRejectedValueOnce(new Error("Connection lost."));
  jobs.mockResolvedValueOnce({ jobs: [] });
  render(client);
  typeMessage();
  await act(async () => button("Review Instagram message").click());
  await act(async () => button("Queue Instagram message").click());
  expect(element.textContent).toContain("The send result is uncertain.");
  act(() => root.render(null));
  render(client);
  expect(element.querySelector("textarea")?.value).toBe(text);
  await act(async () => button("Check status").click());
  expect(element.textContent).toContain("The send result is uncertain.");
  await act(async () => button("Check status").click());
  expect(request.mock.calls.filter(([action]) => action === "jobs.status")).toEqual([
    ["jobs.status", { page: true, offset: 0, limit: 100 }],
    ["jobs.status", { page: true, offset: 0, limit: 100 }],
  ]);
  expect(send).toHaveBeenCalledOnce();
  expect(element.textContent).toContain("Instagram message queued. Check Activity for delivery.");
});

it("stops before writing a contact if the browser resolves a different username", async () => {
  const { browserInstagramRecipient, client, request } = fixture();
  browserInstagramRecipient.mockResolvedValue({ handle: "different", platformId: "71" });
  render(client);
  typeMessage();
  await act(async () => button("Review Instagram message").click());
  expect(request).not.toHaveBeenCalled();
  expect(element.textContent).toContain("Could not verify this Instagram recipient.");
  expect(element.querySelector("textarea")?.value).toBe(text);
});
