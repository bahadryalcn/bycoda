import { describe, expect, it } from "vitest";
import { parseStreamingMarkdown } from "./streamingMarkdown";

describe("streamed Markdown repair", () => {
  it("repairs unfinished prose while preserving open literal fences", () => {
    const literal = '```typescript\nconst label = "**[literal](unfinished";\n';
    const blocks = parseStreamingMarkdown(`**unfinished\n\n${literal}`);
    expect(blocks[0]).toBe("**unfinished\n\n**");
    expect(blocks.at(-1)).toBe(literal);
  });
  it("preserves closed tilde fences and incomplete backticks inside them", () => {
    const literal = '~~~text\n`x **y [z](q\n~~~\n';
    expect(parseStreamingMarkdown(literal).join("")).toBe(literal);
  });
});
