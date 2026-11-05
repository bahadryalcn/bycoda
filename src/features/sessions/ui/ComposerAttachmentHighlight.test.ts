// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../model/session";
import { ComposerAttachmentHighlight } from "./ComposerAttachmentHighlight";

vi.mock("../../files/ui/FileTypeIcon", () => ({ FileTypeIcon: () => null }));

const files: Attachment[] = [
  { id: "image", name: "shot.png", mimeType: "image/png", kind: "image", size: 100 },
  { id: "pdf", name: "notes.pdf", mimeType: "application/pdf", kind: "file", size: 200 },
  { id: "markdown", name: "plan.md", mimeType: "text/markdown", kind: "file", size: 300 },
];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

function render(text: string, attachments = files) {
  const renderText = vi.fn((value: string) => value);
  act(() =>
    root.render(createElement(ComposerAttachmentHighlight, { text, attachments, renderText })),
  );
  return renderText;
}

describe("ComposerAttachmentHighlight", () => {
  it("keeps every native character and decorates each resolved attachment type", () => {
    const text = "See [image1], [file1] and [file2].\nKeep draft.";
    render(text);
    expect(container.textContent).toBe(text);
    expect(
      [...container.querySelectorAll("[data-composer-attachment-kind]")].map((element) =>
        element.getAttribute("data-composer-attachment-kind"),
      ),
    ).toEqual(["image", "pdf", "markdown"]);
    expect(container.querySelector("button, input, textarea")).toBeNull();
  });

  it("leaves code, unknown references and index expressions to existing text highlighting", () => {
    const text = "`[image1]` arr[image1] [image2] $skill @path [file1]";
    const renderText = render(text);
    expect(container.textContent).toBe(text);
    expect(container.querySelectorAll("[data-composer-attachment-kind]")).toHaveLength(1);
    expect(renderText).toHaveBeenCalledWith("`[image1]` arr[image1] [image2] $skill @path ");
  });

  it("returns original text after attachments are removed", () => {
    render("[image1]");
    render("[image1]", []);
    expect(container.textContent).toBe("[image1]");
    expect(container.querySelector("[data-composer-attachment-kind]")).toBeNull();
  });
});
