import { describe, expect, it } from "vitest";
import { parseMarkdownIntoBlocks } from "streamdown";
import remend from "remend";
import { parseStreamingMarkdown } from "./streamingMarkdown";

describe("streamed Markdown repair", () => {
  it("repairs unfinished prose while preserving open literal fences", () => {
    const literal = '```typescript\nconst label = "**[literal](unfinished";\n';
    const blocks = parseStreamingMarkdown(`**unfinished\n\n${literal}`);
    expect(blocks[0]).toBe("**unfinished\n\n");
    expect(blocks.at(-1)).toBe(literal);
  });
  it("preserves closed tilde fences and incomplete backticks inside them", () => {
    const literal = "~~~text\n`x **y [z](q\n~~~\n";
    expect(parseStreamingMarkdown(literal).join("")).toBe(literal);
  });
  it.each([
    "[reference][target]\n\n[target]: https://example.com\n\n**tail",
    "Note[^1]\n\n[^1]: footnote **unfinished",
    "~~~text\n**literal\n~~~\n\n**tail",
    "Paragraph\n\n```ts\nconst literal = '**open';",
    "",
  ])("repairs only the final parser block: %s", (text) => {
    const original = [...parseMarkdownIntoBlocks(text)];
    const result = parseStreamingMarkdown(text);
    expect(result.slice(0, -1)).toEqual(original.slice(0, -1));
    const tail = original.at(-1);
    expect(result.at(-1)).toBe(tail && !/^ {0,3}(?:`{3,}|~{3,})/.test(tail) ? remend(tail) : tail);
    expect(parseMarkdownIntoBlocks(text)).toEqual(original);
  });
});
