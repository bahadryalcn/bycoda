// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiPlan } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { ContentEditorAi, type ContentEditorAiProps } from "./ContentEditorAi";

let element: HTMLDivElement;
let root: Root;

const plan = (text: string): AiPlan => ({
  planId: "p1",
  steps: [
    {
      id: "s1",
      action: "campaigns.create",
      input: { name: "Idea", variants: [{ text }] },
      summary: "",
      needsApproval: true,
    },
  ],
});

const request = vi.fn(async (_action: string, _input?: unknown): Promise<AiPlan> =>
  plan("Fresh idea"),
);
const onUse = vi.fn();
const onNavigate = vi.fn();

function render(patch: Partial<ContentEditorAiProps> = {}) {
  act(() =>
    root.render(
      createElement(ContentEditorAi, {
        client: { request } as unknown as SocialClient,
        projectId: "p1",
        accountCount: 1,
        aiStopped: false,
        disabled: false,
        onUse,
        onNavigate,
        ...patch,
      }),
    ),
  );
}

const text = () => element.textContent ?? "";
const button = (label: string) =>
  [...element.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);

function field(label: string): HTMLInputElement {
  const found = [...element.querySelectorAll("label")].find((item) =>
    item.textContent?.trim().startsWith(label),
  );
  return document.getElementById(found!.htmlFor) as HTMLInputElement;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function open(instruction = "A launch post") {
  act(() => button("Ask AI")!.click());
  if (instruction) type(field("What should the post say?"), instruction);
}

async function ask() {
  act(() => button("Write with AI")!.click());
  await flush();
}

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  request.mockClear();
  request.mockImplementation(async () => plan("Fresh idea"));
  onUse.mockClear();
  onNavigate.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

describe("Ask AI gate", () => {
  it("stays closed until the owner opens it", () => {
    render();
    expect(element.querySelector("input")).toBeNull();
    open("");
    expect(button("Ask AI")?.getAttribute("aria-expanded")).toBe("true");
    expect(field("What should the post say?")).toBeTruthy();
  });

  it("asks for a description first and names that as the reason", () => {
    render();
    open("");
    expect(button("Write with AI")?.disabled).toBe(true);
    expect(text()).toContain("Describe the post first.");
    type(field("What should the post say?"), "   ");
    expect(button("Write with AI")?.disabled).toBe(true);
  });

  it.each<[string, Partial<ContentEditorAiProps>, string]>([
    ["AI is stopped", { aiStopped: true }, "AI is stopped. Resume it from the top bar."],
    ["there is no project", { projectId: undefined }, "Choose a project first."],
    ["no account is chosen", { accountCount: 0 }, "Choose an account first."],
  ])("explains why asking is closed when %s, and never sends a request", (_name, patch, reason) => {
    render(patch);
    open("A post");
    expect(button("Write with AI")?.disabled).toBe(true);
    expect(text()).toContain(reason);
    act(() => button("Write with AI")?.click());
    expect(request).not.toHaveBeenCalled();
  });

  it("disables the whole entry while another editor action runs", () => {
    render({ disabled: true });
    expect(button("Ask AI")?.disabled).toBe(true);
  });
});

describe("Ask AI result", () => {
  it("asks the Host for a plan and shows the text without using it", async () => {
    render();
    open("  A launch post  ");
    await ask();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("ai.command", { text: "A launch post", projectId: "p1" });
    expect(text()).toContain("Fresh idea");
    expect(onUse).not.toHaveBeenCalled();
  });

  it("hands the suggestion to the editor only when the owner accepts it", async () => {
    render();
    open();
    await ask();
    act(() => button("Use this text")!.click());
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith({ text: "Fresh idea", name: "Idea" });
    expect(element.querySelector(".content-ai-suggestion")).toBeNull();
    expect(button("Ask AI")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("drops a discarded suggestion without touching the post", async () => {
    render();
    open();
    await ask();
    act(() => button("Discard")!.click());
    expect(onUse).not.toHaveBeenCalled();
    expect(text()).not.toContain("Fresh idea");
    expect(field("What should the post say?").value).toBe("A launch post");
  });

  it("runs one request even when the button is pressed twice", async () => {
    render();
    open();
    act(() => {
      button("Write with AI")!.click();
      button("Write with AI")!.click();
    });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("says so, and offers Command, when the plan has no post", async () => {
    request.mockImplementation(async () => ({ planId: "p", steps: [] }));
    render();
    open();
    await ask();
    expect(text()).toContain("AI did not return a post. Write it yourself or try again.");
    act(() => button("Open Command")!.click());
    expect(onNavigate).toHaveBeenCalledWith("command");
    expect(onUse).not.toHaveBeenCalled();
  });

  it("shows the Host error and leaves any earlier suggestion cleared", async () => {
    render();
    open();
    await ask();
    expect(text()).toContain("Fresh idea");
    request.mockImplementation(async () => {
      throw new Error("The AI agent is not ready.");
    });
    await ask();
    expect(text()).toContain("The AI agent is not ready.");
    expect(text()).not.toContain("Fresh idea");
    expect(onUse).not.toHaveBeenCalled();
  });
});
