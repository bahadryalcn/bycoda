// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["chat", "focus"] as const)(
  "keeps questions and answers together without duplicate message bubbles in %s layout",
  (layout) => {
    act(() =>
      root.render(
        createElement(AgentTranscript, {
          layout,
          blocks: [
            {
              id: "reply",
              role: "user",
              text: "How should we release?\nFix tests first\n\nAny details?\nKeep the API",
              questionAnswers: [
                { prompt: "How should we release?", answers: ["Fix tests first"] },
                { prompt: "Any details?", answers: ["Keep the API"] },
              ],
            },
          ],
        }),
      ),
    );
    const questions = container.querySelectorAll('[aria-label="AI question"]');
    expect(questions).toHaveLength(2);
    expect(questions[0].textContent).toContain("How should we release?");
    expect(questions[1].textContent).toContain("Any details?");
    const card = container.querySelector("[data-question-answer]")!;
    expect(card.getAttribute("aria-label")).toBe("Question and answer");
    expect(card.querySelectorAll(".user-message-bubble")).toHaveLength(0);
    expect(card.querySelectorAll('[data-selectable-agent-response="reply"]')[0].textContent).toBe(
      "Fix tests first",
    );
    expect(card.querySelectorAll('[data-selectable-agent-response="reply"]')[1].textContent).toBe(
      "Keep the API",
    );
    expect(card.querySelectorAll('[aria-label="Copy message"]')).toHaveLength(2);
    expect(card.textContent).toContain("Answered");
    expect(card.querySelectorAll('section[aria-label="Your answer"]')).toHaveLength(2);
  },
);

it("bounds the chat and focus preview, opens the exact full text, and copies the original", async () => {
  const text = "Start\n" + "Long content ".repeat(200) + "\nEND OF MESSAGE";
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks: [{ id: "prompt", role: "user", text }],
      }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Show full long text"]')!;
  expect(trigger).not.toBeNull();
  expect(container.textContent).not.toContain("END OF MESSAGE");
  act(() => trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(trigger.getAttribute("aria-describedby")).not.toBeNull();
  act(() => trigger.focus());
  const preview = document.getElementById(trigger.getAttribute("aria-describedby")!);
  expect(preview?.textContent).toContain("Long text preview");
  expect(preview?.textContent).not.toContain("END OF MESSAGE");
  expect(preview?.querySelector("pre")?.classList.contains("select-text")).toBe(true);
  await act(async () =>
    preview!.querySelector<HTMLButtonElement>('[aria-label="Copy message"]')!.click(),
  );
  expect(await navigator.clipboard.readText()).toBe(text);
  act(() => trigger.click());
  expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(text);
  expect(document.querySelector('[role="dialog"] pre')?.classList.contains("select-text")).toBe(
    true,
  );
  await navigator.clipboard.writeText("");
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Copy message"]')!
      .click(),
  );
  expect(await navigator.clipboard.readText()).toBe(text);
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-describedby")).toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Copy message"]')!.click(),
  );
  expect(await navigator.clipboard.readText()).toBe(text);
});

it("uzun metin penceresinde not kaydetme ve düzenleme mesaj eylemlerini kullanır", async () => {
  const text = "Long content ".repeat(200).trimEnd();
  const onSaveNote = vi.fn();
  const onEditLastTurn = vi.fn();
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks: [{ id: "prompt", role: "user", text }],
        onSaveNote,
        onEditLastTurn,
      }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Show full long text"]')!;
  act(() => trigger.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  const toolbar = dialog.querySelector(".sticky.top-0")!;
  expect(toolbar).not.toBeNull();
  expect(toolbar.querySelector('[aria-label="Copy message"]')?.textContent).toBe("Copy message");
  expect(toolbar.querySelector('[aria-label="Save as note"]')?.textContent).toBe("Save as note");
  expect(
    toolbar.compareDocumentPosition(dialog.querySelector("pre")!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Save as note"]')!
      .click(),
  );
  expect(onSaveNote).toHaveBeenCalledWith(text);
  expect(toolbar.querySelector('[aria-label="Saved to Notes"]')?.textContent).toBe(
    "Saved to Notes",
  );
  act(() =>
    document
      .querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Message actions"]')!
      .click(),
  );
  act(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes("Edit and resend"))!
      .click(),
  );
  expect(onEditLastTurn).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("detects JSON in a message while keeping the surrounding instructions visible", () => {
  const text = 'Review this:\n```json\n{"a":1}\n```\nKeep the key.';
  act(() =>
    root.render(
      createElement(AgentTranscript, {
        blocks: [{ id: "json", role: "user", text }],
      }),
    ),
  );
  expect(container.textContent).toContain("Review this:");
  expect(container.textContent).toContain("Keep the key.");
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Show full json"]')!;
  expect(trigger).not.toBeNull();
  act(() => trigger.click());
  expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe('```json\n{"a":1}\n```');
});
