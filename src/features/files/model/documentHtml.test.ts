// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeDocumentHtml } from "./documentHtml";

describe("sanitizeDocumentHtml", () => {
  it("keeps ordinary document structure", () => {
    const html = sanitizeDocumentHtml(
      "<h1>Title</h1><p>Some <strong>bold</strong> text</p><table><tr><td>1</td></tr></table>",
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<td>1</td>");
  });

  it("removes scripts, handlers, styles and frames", () => {
    const html = sanitizeDocumentHtml(
      '<p onclick="x()" style="color:red">a</p><script>alert(1)</script><style>p{}</style><iframe src="https://e.com"></iframe><form><input></form>',
    );
    expect(html).toBe("<p>a</p>");
  });

  it("keeps data images and drops remote ones", () => {
    const html = sanitizeDocumentHtml(
      '<img src="data:image/png;base64,AAAA"><img src="https://evil.test/p.png"><img src="javascript:alert(1)">',
    );
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("javascript");
  });

  it("makes links inert but keeps their text and web targets as tooltips", () => {
    const html = sanitizeDocumentHtml(
      '<a href="https://example.com" target="_blank">site</a><a href="javascript:alert(1)">bad</a>',
    );
    expect(html).not.toContain("href");
    expect(html).toContain('title="https://example.com"');
    expect(html).toContain(">bad</a>");
    expect(html).not.toContain("javascript");
  });
});
