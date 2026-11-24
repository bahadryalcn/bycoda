// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { TranscriptSkillGroups, TranscriptSkillNames } from "./SkillTokenText";
import { AttachmentTokenText } from "./AttachmentTokenText";
import { UserMessageMarkdown } from "./UserTextPreview";

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
    expect(container.querySelectorAll('[data-skill-token] svg[aria-hidden="true"]')).toHaveLength(
      2,
    );
    expect(container.querySelector("[data-attachment-kind='text']")).not.toBeNull();
    expect(container.querySelector("[title]")).toBeNull();

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

it("shows a sent skill group at the start of a Markdown line as one chip", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  const root = createRoot(container);
  const group = {
    kind: "template" as const,
    scope: "template" as const,
    source: "bycoda" as const,
    templateId: "skill-group:g",
    groupId: "g",
    name: "Review",
    invocation: "group-review",
    description: "",
    memberCount: 2,
    members: ["lint", "test"],
    body: "",
  };
  try {
    await act(() =>
      root.render(
        createElement(TranscriptSkillNames, {
          value: new Set(["lint", "test"]),
          children: createElement(TranscriptSkillGroups, {
            value: [group],
            children: createElement(UserMessageMarkdown, {
              text: "Review this\n\n/lint /test fix it\n\n/src/App.tsx",
              cwd: "/workspace",
            }),
          }),
        }),
      ),
    );
    expect(
      container.querySelector("[data-skill-group-token] [data-inline-reference] > span")
        ?.textContent,
    ).toBe("Review");
    expect(container.querySelector("[data-skill-group-token] small")?.textContent).toBe("2");
    expect(container.querySelectorAll("[data-skill-token]")).toHaveLength(0);
    expect(Array.from(container.querySelectorAll("a"), (link) => link.textContent)).toEqual([
      "/src/App.tsx",
    ]);
  } finally {
    act(() => root.unmount());
  }
});
