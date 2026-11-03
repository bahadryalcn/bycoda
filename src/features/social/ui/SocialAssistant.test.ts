// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialAccount } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import type { ProgramConfig } from "../model/socialProgram";
import { SocialAssistant } from "./SocialAssistant";

const Component = withQueryClient(SocialAssistant);
let element: HTMLDivElement, root: Root;
const request = vi.fn();
const run = vi.fn(async (work: () => Promise<unknown>) => {
  await work();
  return true;
});
const onOpenProgram = vi.fn();
const client = { request } as unknown as SocialClient;
const account = (id: string, grants: SocialAccount["grants"]): SocialAccount => ({
  id,
  platform: "x",
  platformId: id,
  name: `Account ${id}`,
  accountType: "member",
  scopes: [],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants,
  createdAt: 1,
});
const profile = {
  projectId: "p",
  productName: "Demo",
  brandVoice: "Plain",
  facts: [
    {
      id: "f1",
      topic: "Pricing",
      text: "Free tier",
      source: "https://example.test",
      verifiedAt: 1,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset().mockImplementation(async (action: string, input: Record<string, unknown>) => {
    if (action === "policy.get")
      return { effective: { agent: { provider: "codex", model: "fixture-model" } } };
    if (action === "programs.suggest") {
      const config = input.config as ProgramConfig;
      return { config: { ...config, totalPosts: 7 }, questions: ["Which launch date?"] };
    }
    if (action === "programs.configure")
      return { ...(input.config as ProgramConfig), id: "saved", revision: 1, enabled: false };
    throw new Error(`Unexpected ${action}`);
  });
  run.mockClear();
  onOpenProgram.mockClear();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

async function mount(accounts: SocialAccount[] = [account("a", { p: ["read", "draft"] })]) {
  await act(async () =>
    root.render(
      createElement(Component, {
        client,
        accounts,
        projects: [{ id: "p", cwd: "/p", name: "Project" }],
        profiles: [profile],
        machineLabel: "This computer",
        projectId: "p",
        run,
        onOpenProgram,
      }),
    ),
  );
}
const button = (name: string) =>
  [...element.querySelectorAll("button")].find((item) => item.textContent?.trim() === name);
async function type(text: string) {
  const area = element.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const calls = (action: string) => request.mock.calls.filter((call) => call[0] === action);

it("asks only with the selected project, account, saved voice and facts, and never configures before review", async () => {
  await mount();
  expect(button("Prepare proposal")!.disabled).toBe(true);
  await type("A week of posts about the release");
  await act(async () => button("Prepare proposal")!.click());
  const [, input] = calls("programs.suggest")[0];
  expect(input.instructions).toBe("A week of posts about the release");
  expect(input.config).toMatchObject({
    projectId: "p",
    accountIds: ["a"],
    brief: { voice: "Plain", factIds: ["f1"] },
    approval: { mode: "approved" },
  });
  expect(calls("programs.configure")).toHaveLength(0);
  expect(element.textContent).toContain("Proposed paused campaign");
  expect(element.textContent).toContain("Which launch date?");
  expect(element.textContent).toContain("nothing is sent");
});

it("saves the reviewed proposal paused with one idempotency id and opens the real record", async () => {
  await mount();
  await type("Weekly posts");
  await act(async () => button("Prepare proposal")!.click());
  await act(async () => button("Save as paused campaign")!.click());
  const [, input, requestId] = calls("programs.configure")[0];
  expect(input).not.toHaveProperty("id");
  expect(typeof requestId).toBe("string");
  expect(request.mock.calls.some((call) => /activate|generate|send/.test(String(call[0])))).toBe(
    false,
  );
  expect(element.textContent).toContain("Saved as a paused campaign");
  await act(async () => button("Open campaign")!.click());
  expect(onOpenProgram).toHaveBeenCalledWith("saved");
});

it("discarding a proposal stores nothing", async () => {
  await mount();
  await type("Weekly posts");
  await act(async () => button("Prepare proposal")!.click());
  await act(async () => button("Discard proposal")!.click());
  expect(calls("programs.configure")).toHaveLength(0);
  expect(element.textContent).not.toContain("Proposed paused campaign");
});

it("keeps the request and offers retry when the AI fails, without saving anything", async () => {
  request.mockImplementation(async (action: string) => {
    if (action === "policy.get") return { effective: { agent: { provider: "codex" } } };
    throw new Error("Provider unavailable");
  });
  await mount();
  await type("Weekly posts");
  await act(async () => button("Prepare proposal")!.click());
  expect(element.textContent).toContain("Provider unavailable");
  expect(element.querySelector("textarea")!.value).toBe("Weekly posts");
  expect(button("Try again")).toBeTruthy();
  expect(calls("programs.configure")).toHaveLength(0);
});

it("blocks asking when no text agent is set and never offers accounts without draft access", async () => {
  request.mockImplementation(async (action: string) => {
    if (action === "policy.get") return { effective: {} };
    throw new Error(`Unexpected ${action}`);
  });
  await mount([account("a", { p: ["read"] }), account("b", { p: ["read", "draft"] })]);
  await type("Weekly posts");
  expect(element.textContent).toContain("Choose a text agent in Settings");
  expect(button("Prepare proposal")!.disabled).toBe(true);
  expect(element.textContent).toContain("Account b");
  expect(element.querySelector(".social-assistant-context")!.textContent).not.toContain(
    "Account a",
  );
});
