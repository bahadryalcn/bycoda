import { describe, expect, it } from "vitest";
import { parseMarkdownIntoBlocks } from "streamdown";
import remend from "remend";
import { markdownBlocks, parseStreamingMarkdown } from "./streamingMarkdown";

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

/** A parse that cannot reuse Streamdown's single cached input. */
function fullBlocks(text: string): string[] {
  parseMarkdownIntoBlocks("");
  return [...parseMarkdownIntoBlocks(text)];
}

const REPLY = [
  "# Plan\n\nFirst I read **the store** and the `sessions` hook.\n\n",
  "- one item\n- two items with `code`\n  - nested\n\n1. ordered\n2. list\n\n",
  "| File | Change |\n| --- | --- |\n| a.ts | +3 |\n| b.ts | -1 |\n\n",
  "```ts\nconst value = 1;\n\nfunction twice(x: number) {\n  return x * 2;\n}\n```\n\n",
  "> quoted **note**\n> continues\n\n",
  "<details>\n<summary>More</summary>\n\nInside html\n\n</details>\n\n",
  "$$\na^2 + b^2\n\n= c^2\n$$\n\n",
  "~~~text\nliteral **stars**\n~~~\n\nClosing paragraph with a [link](https://example.com).",
].join("");

describe("incremental streamed Markdown", () => {
  it.each([1, 3, 7, 23])("matches a full parse at every %i-character step", (step) => {
    const stream = `test-${step}`;
    for (let end = 0; end <= REPLY.length; end += step) {
      const text = REPLY.slice(0, end);
      expect(markdownBlocks(text, stream), JSON.stringify(text.slice(-40))).toEqual(
        fullBlocks(text),
      );
    }
    expect(markdownBlocks(REPLY, stream)).toEqual(fullBlocks(REPLY));
  });

  it("keeps two interleaved streams independent", () => {
    const other = "Other reply\n\n```py\nprint(1)\n";
    for (let end = 1; end <= REPLY.length; end += 5) {
      const text = REPLY.slice(0, end);
      const otherText = other.slice(0, Math.min(other.length, end));
      expect(markdownBlocks(text, "a")).toEqual(fullBlocks(text));
      expect(markdownBlocks(otherText, "b")).toEqual(fullBlocks(otherText));
    }
  });

  it("parses again when the text is replaced rather than extended", () => {
    markdownBlocks("First\n\nSecond\n\nThird", "replace");
    const replaced = "Different\n\nSecond\n\nThird and more";
    expect(markdownBlocks(replaced, "replace")).toEqual(fullBlocks(replaced));
  });
});
