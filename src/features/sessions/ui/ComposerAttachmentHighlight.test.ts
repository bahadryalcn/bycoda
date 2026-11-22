// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../model/session";
import { attachmentDraftTokens } from "../model/attachmentTokens";
import { ComposerAttachmentHighlight } from "./ComposerAttachmentHighlight";

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

const NBSP = "\u00a0";
/** The generated token form for the fixture files (sizes 100, 200 and 300 bytes). */
const tok = (kind: "Image" | "File", n: number, size: string) =>
  `[${kind}${NBSP}${n}${NBSP}·${NBSP}${size.replace(" ", NBSP)}]`;

/** Text as typed: the hidden source spans, without the labelled faces drawn over them. */
function sourceText(root: HTMLElement): string | null {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const face of clone.querySelectorAll("[data-draft-token-face] > [aria-hidden]")) {
    face.remove();
  }
  return clone.textContent;
}

function render(text: string, attachments = files) {
  const renderText = vi.fn((value: string) => value);
  act(() =>
    root.render(createElement(ComposerAttachmentHighlight, { text, attachments, renderText })),
  );
  return renderText;
}

describe("ComposerAttachmentHighlight", () => {
  it("keeps every native character and decorates each resolved attachment type", async () => {
    const [image, first, second] = attachmentDraftTokens(files);
    const text = `See ${image}, ${first} and ${second}.\nKeep draft.`;
    render(text);
    expect(sourceText(container)).toBe(text);
    expect(
      [...container.querySelectorAll("[data-draft-token-face] > [aria-hidden]")].map(
        (face) => face.textContent,
      ),
    ).toEqual(["shot.png · 100 B", "notes.pdf · 200 B", "plan.md · 300 B"]);
    expect(
      [...container.querySelectorAll("[data-composer-attachment-kind]")].map((element) =>
        element.getAttribute("data-composer-attachment-kind"),
      ),
    ).toEqual(["image", "pdf", "markdown"]);
    expect(container.querySelector("button, input, textarea")).toBeNull();
    await act(async () => {
      await vi.waitFor(() => {
        for (const token of container.querySelectorAll("[data-composer-attachment-kind]")) {
          expect(token.querySelector("svg")).not.toBeNull();
        }
      });
    });
  });

  it("leaves code, unknown references and index expressions to existing text highlighting", () => {
    const text = `\`[image1]\` arr[image1] [image2] $skill @path ${tok("File", 1, "200 B")}`;
    const renderText = render(text);
    expect(sourceText(container)).toBe(text);
    expect(container.querySelectorAll("[data-composer-attachment-kind]")).toHaveLength(1);
    expect(renderText).toHaveBeenCalledWith("`[image1]` arr[image1] [image2] $skill @path ");
  });

  it("returns original text after attachments are removed", () => {
    render("[image1]");
    render("[image1]", []);
    expect(container.textContent).toBe("[image1]");
    expect(container.querySelector("[data-composer-attachment-kind]")).toBeNull();
  });

  it("opens a named marker only through its owning identity, even next to prose", () => {
    const text = "Look[Image: shot.png; ref=image_image] and [Image: shot.png; ref=image_other]";
    render(text);
    expect(sourceText(container)).toBe(text);
    expect(
      container
        .querySelector('[data-composer-reference="attachment"]')
        ?.getAttribute("data-reference-value"),
    ).toBe("image");
    expect(
      container
        .querySelector('[data-composer-reference="missing"]')
        ?.getAttribute("data-reference-value"),
    ).toBe("shot.png");
  });
});
