// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiffCommentComposer } from "./DiffCommentComposer";
import { writeDiffCommentDraft } from "../model/diffComment";
import {
  extractChatCitations,
  projectChatCitationsForProvider,
} from "../../sessions/model/chatCitation";
import {
  ADD_TO_CHAT_EVENT,
  composerSeedForAddToChat,
  type AddToChatRequest,
} from "../../sessions/model/quoteDraft";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("names the comment textarea for assistive technology", async () => {
  await act(async () =>
    root.render(
      createElement(DiffCommentComposer, {
        path: "src/app.ts",
        target: {
          line: { kind: "add", text: "const a = 1;", oldNumber: null, newNumber: 12 },
          anchor: { x: 0, y: 0 },
        },
        onDismiss: vi.fn(),
      }),
    ),
  );
  const textarea = document.querySelector("textarea")!;
  expect(textarea.getAttribute("aria-label")).toBe("Comment");
  expect(textarea.getAttribute("placeholder")).toBe("Leave a comment…");
});

it("adds a file comment as one inline reference in a new chat", async () => {
  const path = "G:/Working Copy/src/app.ts";
  const line = { kind: "del" as const, text: "  oldCall();", oldNumber: 12, newNumber: null };
  writeDiffCommentDraft({ path, line }, "Keep this behavior.");
  const received = vi.fn();
  window.addEventListener(ADD_TO_CHAT_EVENT, received, { once: true });
  await act(async () =>
    root.render(
      createElement(DiffCommentComposer, {
        path,
        target: { line, anchor: { x: 0, y: 0 } },
        onDismiss: vi.fn(),
      }),
    ),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
  );

  const { text, mode } = (received.mock.calls[0][0] as CustomEvent<AddToChatRequest>).detail;
  const draft = composerSeedForAddToChat(text, mode);
  expect(extractChatCitations(draft)).toMatchObject({
    text: "[quote1] ",
    citations: [
      {
        file: { path, line: 12, kind: "del" },
        text: "  oldCall();",
        comment: "Keep this behavior.",
      },
    ],
  });
  expect(projectChatCitationsForProvider(draft)).toContain('"kind": "del"');
});
