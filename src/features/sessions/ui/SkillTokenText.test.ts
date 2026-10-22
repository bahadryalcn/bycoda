// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { TranscriptSkillNames } from "./SkillTokenText";
import { AttachmentTokenText } from "./AttachmentTokenText";

it("emphasizes recognized skills alongside attachments without changing copied text", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  const text =
    "/stitch-design-taste design [file1]\nUse $design-taste-frontend /unknown /src/App.tsx $HOME";
  try {
    act(() =>
      root.render(
        createElement(TranscriptSkillNames, {
          value: new Set(["stitch-design-taste", "design-taste-frontend"]),
          children: createElement(AttachmentTokenText, {
            text,
            attachments: [
              { id: "file", name: "brief.txt", kind: "file", mimeType: "text/plain", size: 1 },
            ],
          }),
        }),
      ),
    );
    expect(container.textContent).toBe(text);
    expect(
      Array.from(container.querySelectorAll("[data-skill-token]"), (node) => node.textContent),
    ).toEqual(["/stitch-design-taste", "$design-taste-frontend"]);
    expect(container.querySelector("[title='brief.txt']")).not.toBeNull();

    act(() =>
      root.render(
        createElement(TranscriptSkillNames, {
          value: new Set(["design-taste-frontend"]),
          children: createElement(AttachmentTokenText, { text, attachments: undefined }),
        }),
      ),
    );
    expect(container.textContent).toBe(text);
    expect(container.querySelectorAll("[data-skill-token]")).toHaveLength(1);
  } finally {
    act(() => root.unmount());
  }
});
