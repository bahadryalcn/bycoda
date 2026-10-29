// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialThread } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { SocialReplySuggestion } from "./SocialReplySuggestion";

const Component = withQueryClient(SocialReplySuggestion);
let element: HTMLDivElement, root: Root;
const request = vi.fn();
const onSuggestion = vi.fn();
const onClose = vi.fn();
const client = { request } as unknown as SocialClient;
const thread = {
  id: "t1",
  accountId: "a",
  projectId: "p",
  contactId: "c",
  kind: "message",
  events: [],
} as unknown as SocialThread;
const profile = {
  projectId: "p",
  productName: "Demo",
  brandVoice: "Plain",
  facts: [
    { id: "f1", topic: "Pricing", text: "Free tier", source: "https://example.test", verifiedAt: 1 },
    { id: "f2", topic: "Release", text: "October", source: "https://example.test", verifiedAt: 1 },
  ],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset().mockImplementation(async (action: string) => {
    if (action === "policy.get")
      return { effective: { agent: { provider: "codex", model: "fixture-model" } } };
    if (action === "replies.suggest") return { text: "It is free.", factIds: ["f1"] };
    throw new Error(`Unexpected ${action}`);
  });
  onSuggestion.mockClear();
  onClose.mockClear();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

async function mount(props: Partial<Parameters<typeof SocialReplySuggestion>[0]> = {}) {
  await act(async () =>
    root.render(
      createElement(Component, {
        client,
        thread,
        profile,
        hostOnline: true,
        replacesDraft: false,
        onClose,
        onSuggestion,
        ...props,
      }),
    ),
  );
  await act(async () => undefined);
}
const button = (label: string) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label,
  )!;
async function tick(facts: string[]) {
  for (const box of Array.from(element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')))
    if (facts.includes(box.closest("label")?.textContent ?? "")) await act(async () => box.click());
}

it("needs a ticked verified fact, then hands the answer to the editor without saving anything", async () => {
  await mount();
  expect(button("Suggest").disabled).toBe(true);
  expect(element.textContent).toContain("codex · fixture-model");
  await tick(["Pricing"]);
  await act(async () => button("Suggest").click());
  expect(request).toHaveBeenCalledWith("replies.suggest", { threadId: "t1", factIds: ["f1"] });
  expect(onSuggestion).toHaveBeenCalledWith({ text: "It is free.", factIds: ["f1"] });
  expect(request.mock.calls.map((call) => call[0])).toEqual(["policy.get", "replies.suggest"]);
});

it("keeps the form and the ticked facts after a failure and offers a retry", async () => {
  request.mockImplementation(async (action: string) => {
    if (action === "policy.get") return { effective: { agent: { provider: "codex" } } };
    throw new Error("AI could not answer from the selected verified facts.");
  });
  await mount();
  await tick(["Pricing", "Release"]);
  await act(async () => button("Suggest").click());
  expect(element.querySelector('[role="alert"]')?.textContent).toContain("could not answer");
  expect(onSuggestion).not.toHaveBeenCalled();
  expect(button("Try again").disabled).toBe(false);
  expect(
    Array.from(element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter(
      (box) => box.checked,
    ),
  ).toHaveLength(2);
});

it("explains blockers in place and never asks while the project, agent or facts are missing", async () => {
  await mount({ thread: { ...thread, projectId: undefined } as unknown as SocialThread });
  expect(element.textContent).toContain("Choose the related project first.");
  expect(button("Suggest").disabled).toBe(true);
  await mount({ profile: { ...profile, facts: [] } });
  expect(element.textContent).toContain("Add a verified fact for this project first.");
  request.mockImplementation(async () => ({ effective: {} }));
  await mount({ client: { request } as unknown as SocialClient, replacesDraft: true });
  expect(element.textContent).toContain("Choose a text agent in Settings first.");
  expect(request).not.toHaveBeenCalledWith("replies.suggest", expect.anything());
});

it("warns before replacing unfinished reply text", async () => {
  await mount({ replacesDraft: true });
  expect(element.textContent).toContain("It replaces the unfinished reply text.");
});
