// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { ActivityHistory } from "./ActivityHistory";

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

const accounts = [{ id: "a1", name: "Studio" }] as unknown as SocialAccount[];
const job = (patch: Partial<SocialJob>) =>
  ({
    id: "j1",
    accountId: "a1",
    kind: "publish",
    status: "succeeded",
    createdAt: Date.UTC(2026, 10, 7),
    payload: { text: "Launch day" },
    ...patch,
  }) as SocialJob;

function render(jobs: SocialJob[], actions: unknown[] = []) {
  const client = {
    sectionSnapshot: vi.fn(async () => ({ snapshot: { jobs } })),
    ai: { actions: vi.fn(async () => ({ items: actions })), undo: vi.fn(async () => ({})) },
  } as unknown as SocialClient;
  act(() => root.render(createElement(ActivityHistory, { client, accounts })));
}

it("shows a succeeded post as Sent with its account name", async () => {
  render([job({})]);
  await act(async () => undefined);
  expect(element.textContent).toContain("Publishing · Studio");
  expect(element.textContent).toContain("Sent");
});

const buttonNamed = (name: string) =>
  [...element.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);

it("hides Undo for an AI action without an inverse and gives the reason under Details", async () => {
  render(
    [],
    [
      {
        id: "x1",
        at: Date.UTC(2026, 10, 7),
        actor: "owner",
        action: "replies.send",
        summary: "Replied to a comment",
        status: "done",
      },
    ],
  );
  await act(async () => undefined);
  expect(element.textContent).toContain("Replied to a comment");
  expect(buttonNamed("Undo")).toBeUndefined();
  expect(element.textContent).not.toContain("This action cannot be undone.");
  act(() => buttonNamed("Details")?.click());
  expect(element.textContent).toContain("This action cannot be undone.");
});

it("keeps a review row with its plain reason", async () => {
  render([job({ status: "review", reviewReason: "awaiting_approval" })]);
  await act(async () => undefined);
  expect(element.textContent).toContain("Waiting for your approval");
});
