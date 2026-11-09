// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../model/session";
import type { UserQuestionPrompt } from "../model/userQuestion";
import { resolveQuestionDraft } from "../model/questionDrafts";
import { QuestionForm } from "./QuestionForm";

const mocks = vi.hoisted(() => ({
  pick: vi.fn(),
  fromFiles: vi.fn(),
  prepare: vi.fn(),
  drop: undefined as
    | undefined
    | {
        enabled: boolean;
        disabled: boolean;
        readDroppedAttachments: (read: () => Promise<Attachment[]>) => void;
      },
}));
vi.mock("../model/attachments", async (original) => ({
  ...(await original<typeof import("../model/attachments")>()),
  pickAttachments: mocks.pick,
  attachmentsFromFiles: mocks.fromFiles,
}));
vi.mock("../model/questionAttachments", async (original) => ({
  ...(await original<typeof import("../model/questionAttachments")>()),
  prepareQuestionAttachments: mocks.prepare,
}));
vi.mock("./useComposerFileDrop", () => ({
  useComposerFileDrop: (options: NonNullable<typeof mocks.drop>) => {
    mocks.drop = options;
  },
}));
vi.mock("./AttachmentChip", () => ({
  AttachmentChip: ({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) =>
    createElement(
      "div",
      { "data-attachment": attachment.id },
      attachment.name,
      onRemove
        ? createElement(
            "button",
            { type: "button", onClick: onRemove },
            `Remove ${attachment.name}`,
          )
        : null,
    ),
}));

let node: HTMLDivElement;
let root: Root;
let sequence = 0;
let prompt: UserQuestionPrompt;
let scope: string;
const file: Attachment = {
  id: "file-one",
  name: "details.pdf",
  kind: "file",
  mimeType: "application/pdf",
  size: 12,
  path: "C:/question-files/details.pdf",
};

function button(label: string) {
  return [...node.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
  )!;
}
function render(onReply = vi.fn()) {
  act(() =>
    root.render(
      createElement(QuestionForm, { prompt, draftScope: scope, parentSessionId: scope, onReply }),
    ),
  );
  return onReply;
}
function type(text: string) {
  const field = node.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function pick() {
  await act(async () => button("Attach files").click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.pick.mockResolvedValue([file]);
  mocks.fromFiles.mockResolvedValue([file]);
  mocks.prepare.mockImplementation(async (files: Attachment[]) => files);
  scope = `question-attachment-test-${++sequence}`;
  prompt = {
    requestId: sequence,
    occurrenceId: `occurrence-${sequence}`,
    callId: scope,
    questions: [
      {
        id: "answer",
        prompt: "Share supporting files",
        allowCustom: true,
        multiSelect: false,
        options: [],
      },
    ],
  };
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  resolveQuestionDraft(scope, prompt);
  node.remove();
  vi.unstubAllGlobals();
});

describe("question attachments", () => {
  it("keeps legacy questions usable for text answers", () => {
    prompt = { ...prompt, occurrenceId: undefined, providerTurnId: undefined };
    const onReply = render();
    type("Text only");
    act(() => button("Send answer").click());
    expect(onReply).toHaveBeenCalledWith(
      prompt.requestId,
      expect.objectContaining({ kind: "answered" }),
    );
  });

  it("sends a picked file as an attachment-only answer", async () => {
    const onReply = render();
    expect(button("Send answer").disabled).toBe(true);
    await pick();
    expect(node.textContent).toContain(file.name);
    expect(button("Send answer").disabled).toBe(false);
    act(() => button("Send answer").click());
    expect(onReply).toHaveBeenCalledWith(
      prompt.requestId,
      expect.objectContaining({
        kind: "answered",
        attachments: { answer: [file] },
      }),
    );
  });

  it("removes a file without changing the typed answer", async () => {
    render();
    type("Use this report");
    await pick();
    act(() => button(`Remove ${file.name}`).click());
    expect(node.querySelector("[data-attachment]")).toBeNull();
    expect(node.querySelector("textarea")!.value).toBe("Use this report");
    expect(button("Send answer").disabled).toBe(false);
  });

  it("pastes clipboard files into the question rather than the outer composer", async () => {
    render();
    const image = new File(["image"], "screen.png", { type: "image/png" });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [image], items: [] } });
    await act(async () => node.querySelector("textarea")!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(mocks.fromFiles).toHaveBeenCalledWith([image], { persistBlobs: false });
    expect(node.textContent).toContain(file.name);
  });

  it("uses the shared file-drop read path", async () => {
    render();
    expect(mocks.drop?.enabled).toBe(true);
    await act(async () => mocks.drop!.readDroppedAttachments(async () => [file]));
    expect(mocks.prepare).toHaveBeenCalledWith([file]);
    expect(node.textContent).toContain(file.name);
  });

  it("keeps text and permits retry when attachment preparation fails", async () => {
    render();
    type("Keep this exact answer");
    mocks.prepare.mockRejectedValueOnce(new Error("Attachment storage unavailable"));
    await pick();
    expect(node.textContent).toContain("Attachment storage unavailable");
    expect(node.querySelector("textarea")!.value).toBe("Keep this exact answer");
    expect(button("Attach files").disabled).toBe(false);
    await pick();
    expect(node.textContent).not.toContain("Attachment storage unavailable");
    expect(node.textContent).toContain(file.name);
  });

  it("retains prepared file metadata when the question remounts", async () => {
    render();
    await pick();
    act(() => root.render(null));
    const onReply = render();
    expect(node.textContent).toContain(file.name);
    act(() => button("Send answer").click());
    expect(onReply).toHaveBeenCalledWith(
      prompt.requestId,
      expect.objectContaining({ attachments: { answer: [file] } }),
    );
  });

  it("prevents new files, removal and duplicate submit while sending", async () => {
    const onReply = render();
    await pick();
    act(() => button("Send answer").click());
    expect(button("Attach files").disabled).toBe(true);
    expect(button(`Remove ${file.name}`)).toBeUndefined();
    expect(mocks.drop?.disabled).toBe(true);
    act(() =>
      node
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("waits for file preparation before allowing the answer to send", async () => {
    let finish!: (files: Attachment[]) => void;
    mocks.prepare.mockReturnValueOnce(
      new Promise<Attachment[]>((resolve) => {
        finish = resolve;
      }),
    );
    const onReply = render();
    type("Supporting document");
    await pick();
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(button("Attach files").getAttribute("aria-disabled")).toBe("true");
    act(() => button("Attach files").click());
    expect(mocks.pick).toHaveBeenCalledTimes(1);
    expect(button("Send answer").disabled).toBe(true);
    act(() =>
      node
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onReply).not.toHaveBeenCalled();
    await act(async () => finish([file]));
    expect(button("Send answer").disabled).toBe(false);
    act(() => button("Send answer").click());
    expect(onReply).toHaveBeenCalledWith(
      prompt.requestId,
      expect.objectContaining({
        custom: { answer: "Supporting document" },
        attachments: { answer: [file] },
      }),
    );
  });

  it("preserves typed schema fields by withholding attachment controls", () => {
    prompt.questions[0].preserveCustomWhitespace = true;
    render();
    expect(button("Attach files")).toBeUndefined();
    expect(mocks.drop?.enabled).toBe(false);
  });
});
