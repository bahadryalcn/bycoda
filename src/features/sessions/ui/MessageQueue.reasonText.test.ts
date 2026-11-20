// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageQueue } from "./MessageQueue";
import type { QueuedMessage } from "../model/session";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const missing: QueuedMessage = {
  id: "q1",
  text: "with a gone file",
  attachments: [
    { id: "f", name: "a", mimeType: "text/plain", kind: "file", size: 1, missing: true },
  ],
};

// #278: the paused header reason wraps instead of truncating next to Resume.
it("wraps the paused reason instead of truncating it", async () => {
  await act(async () =>
    root.render(
      createElement(MessageQueue, { messages: [missing], status: "paused", canAttach: true }),
    ),
  );
  const reason = [
    ...container.querySelectorAll<HTMLElement>("[data-message-queue-card] div *"),
  ].find((node) => node.children.length === 0 && node.textContent === "Queue paused");
  expect(reason).toBeDefined();
  expect(reason!.className).toContain("[overflow-wrap:anywhere]");
  expect(reason!.className).not.toContain("truncate");
  expect(reason!.parentElement!.className).toContain("flex-wrap");
  expect(reason!.parentElement!.className).not.toMatch(/(^|\s)h-7(\s|$)/);
});

// #279: the recovery instruction is visible text, not a hover-only tooltip.
it("shows how to recover a missing attachment as visible text", async () => {
  await act(async () =>
    root.render(createElement(MessageQueue, { messages: [missing], canAttach: true })),
  );
  const note = container.querySelector("[data-queue-attachment-missing]");
  expect(note?.textContent).toBe("Attachment missing · Edit to drop it, or remove the message.");
});

// #280: a Resume that cannot run stays focusable and names why.
it("keeps a blocked Resume focusable with its reason", async () => {
  await act(async () =>
    root.render(
      createElement(MessageQueue, {
        messages: [missing],
        status: "paused",
        onResume: () => true,
        canAttach: false,
      }),
    ),
  );
  const resume = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) =>
    node.textContent?.includes("Resume"),
  )!;
  expect(resume.disabled).toBe(false);
  expect(resume.getAttribute("aria-disabled")).toBe("true");
  expect(resume.getAttribute("aria-description")).toBe("Attachment missing");
});
