import { expect, it } from "vitest";
import { composerInlineReferences, type InlineReferenceContext } from "./composerInlineReferences";

const context: InlineReferenceContext = {
  attachments: [
    { id: "photo", name: "image.png", mimeType: "image/png", kind: "image", size: 1024 },
  ],
  citations: 0,
  modeEnd: 0,
  names: new Set(),
  skillParts: (text) => [{ text }],
  mentions: new Map([
    [
      "PreviewTunnel.ts",
      { name: "PreviewTunnel.ts", path: "/fixture/PreviewTunnel.ts", relative: "PreviewTunnel.ts" },
    ],
  ]),
  mcpTags: [],
};

it("resolves widgets without changing the source offsets or replacing URLs inside code", () => {
  const draft =
    "Read [image1] and @PreviewTunnel.ts, then [docs](https://example.com/docs). `https://example.com/example`";
  const parts = composerInlineReferences(draft, context);
  expect(parts.map((part) => [part.kind, part.label, draft.slice(part.start, part.end)])).toEqual([
    ["attachment", "image.png", "[image1]"],
    ["file", "PreviewTunnel.ts", "@PreviewTunnel.ts"],
    ["url", "docs", "[docs](https://example.com/docs)"],
  ]);
});

it("prefers a resolved attachment over a missing reference with the same source range", () => {
  const draft = "See [Image: image.png; ref=image_photo] and [Image: other.png; ref=image_unknown]";
  expect(composerInlineReferences(draft, context).map((part) => [part.kind, part.value])).toEqual([
    ["attachment", "photo"],
    ["missing", "other.png"],
  ]);
});
