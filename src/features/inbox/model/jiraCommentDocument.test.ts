import { describe, expect, it } from "vitest";
import { jiraCommentDocument } from "./jiraCommentDocument";

describe("Jira comment ADF", () => {
  it("preserves source line breaks and multiline code", () => {
    expect(jiraCommentDocument("one\r\ntwo").content?.[0].content).toEqual([
      { type: "text", text: "one" },
      { type: "hardBreak" },
      { type: "text", text: "two" },
    ]);
    expect(jiraCommentDocument("```\none\ntwo\n```").content?.[0].content).toEqual([
      { type: "text", text: "one\ntwo" },
    ]);
  });
  it("preserves text and nested bold, italic, code and links", () => {
    expect(
      jiraCommentDocument(
        "Hello **bold *italic*** and `code` [Jira](https://example.atlassian.net).",
      ),
    ).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "bold ", marks: [{ type: "strong" }] },
            { type: "text", text: "italic", marks: [{ type: "strong" }, { type: "em" }] },
            { type: "text", text: " and " },
            { type: "text", text: "code", marks: [{ type: "code" }] },
            { type: "text", text: " " },
            {
              type: "text",
              text: "Jira",
              marks: [{ type: "link", attrs: { href: "https://example.atlassian.net" } }],
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });
  });

  it("converts bullet and ordered lists and fenced code", () => {
    const document = jiraCommentDocument(
      "- first\n- **second**\n\n1. one\n2. two\n\n```ts\nconst n = 1;\n```",
    );
    expect(document.content?.map((node) => node.type)).toEqual([
      "bulletList",
      "orderedList",
      "codeBlock",
    ]);
    expect(document.content?.[0].content?.[1]).toEqual({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "second", marks: [{ type: "strong" }] }],
        },
      ],
    });
    expect(document.content?.[2].content).toEqual([{ type: "text", text: "const n = 1;" }]);
  });

  it("uses completed Jira attachment links, including image-only comments", () => {
    const image = {
      id: "local",
      name: "screen.png",
      type: "image/png",
      dataUrl: "data:image/png;base64,AA==",
    };
    expect(() => jiraCommentDocument("", [image])).toThrow("Image upload has not completed");
    expect(
      jiraCommentDocument("", [
        {
          ...image,
          uploaded: {
            key: "ENG-1",
            id: "12",
            url: "https://example.atlassian.net/rest/api/3/attachment/content/12",
          },
        },
      ]).content,
    ).toEqual([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "screen.png",
            marks: [
              {
                type: "link",
                attrs: { href: "https://example.atlassian.net/rest/api/3/attachment/content/12" },
              },
            ],
          },
        ],
      },
    ]);
  });

  it("never emits executable link schemes or HTML nodes", () => {
    const document = jiraCommentDocument("[click](javascript:alert) <script>alert(1)</script>");
    expect(JSON.stringify(document)).not.toContain('"type":"link"');
    expect(JSON.stringify(document)).toContain("<script>");
  });
});
