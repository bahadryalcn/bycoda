import { describe, expect, it, vi } from "vitest";
import { parseMarkdownIntoBlocks } from "streamdown";
import remend from "remend";
import { markdownBlocks, parseStreamingMarkdown } from "./streamingMarkdown";

/** Every whole-text lex that streamingMarkdown asks Streamdown for, by input length. */
const lexed = vi.hoisted(() => ({ lengths: [] as number[] }));

vi.mock("streamdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("streamdown")>();
  return {
    ...actual,
    parseMarkdownIntoBlocks: (text: string) => {
      lexed.lengths.push(text.length);
      return actual.parseMarkdownIntoBlocks(text);
    },
  };
});

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

const LONG_FENCE = Array.from({ length: 150 }, (_, i) => `const value${i} = [${i}, "x"];`).join(
  "\n",
);

const SAMPLES: Record<string, string> = {
  paragraphsWithoutBlankLines:
    "First line of a reply\nsecond line continues the paragraph\nthird line too\nand **bold** here\n",
  listsAndNesting:
    "- alpha\n- beta with `code`\n  - nested item\n  - nested two\n- gamma\n\n" +
    "1. one\n2. two\n3. three\n",
  tables: "| Name | Value |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n\nAfter the table.\n",
  fenceInList: "1. Step one\n\n   ```bash\n   npm install\n   npm test\n   ```\n\n2. Step two\n",
  fenceRightAfterParagraph:
    "Here is the code:\n```ts\nconst a = 1;\n\nconst b = 2;\n```\nDone.\n\nAnother block\n",
  tildeFences: "~~~python\ndef f():\n    return 1\n\n```not a closer\n~~~\n\nText after.\n",
  longOpenFence: `Intro\n\n\`\`\`ts\n${LONG_FENCE}\n\`\`\`\n\nOutro\n`,
  htmlBlocks:
    "<details>\n<summary>More</summary>\n\nInside html\n\n</details>\n\n" +
    "<div>\nraw\n</div>\nafter\n",
  tightHeadingAndQuote:
    "# Heading\nparagraph right under heading\n---\nafter rule\n> quote\n> continues\n",
  tabsInList: "- item\n\tindented with tab\n\n\tcode with tab\n",
  definitionAtEnd: "See [docs][d] and more\n\nlast paragraph\n\n[d]: https://example.com\n",
  footnoteAtEnd: "Claim[^note] here\n\nmore text\n\n[^note]: the source\n",
};

/** Growing prefixes of `text`: one character at a time, or random chunks from a fixed seed. */
function streamedPrefixes(text: string, seed: number | undefined): string[] {
  const prefixes: string[] = [];
  let state = seed ?? 0;
  for (let end = 0; end < text.length;) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    end = Math.min(text.length, end + (seed === undefined ? 1 : 1 + (state % 24)));
    prefixes.push(text.slice(0, end));
  }
  return prefixes;
}

describe("incremental parse equals a full parse at every streamed prefix", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, text) => {
    const schedules: (number | undefined)[] = text.length <= 600 ? [undefined, 7, 99] : [7, 99];
    for (const seed of schedules) {
      const stream = `property-${name}-${seed ?? "char"}`;
      for (const prefix of streamedPrefixes(text, seed)) {
        const message = `${name} at ${JSON.stringify(prefix.slice(-30))}`;
        expect(markdownBlocks(prefix, stream), message).toEqual(fullBlocks(prefix));
      }
    }
  });

  it("does not lex the whole open fence again on each streamed step", () => {
    const stream = "long-open-fence";
    const text = SAMPLES.longOpenFence;
    const fenceStart = text.indexOf("```ts");
    lexed.lengths.length = 0;
    const steps = [];
    for (let end = fenceStart + 6; end < text.length; end += 200) steps.push(text.slice(0, end));
    for (const step of steps) markdownBlocks(step, stream);
    // Only the short prefix before the fence and the first steps may be lexed in full.
    expect(lexed.lengths.filter((length) => length > 1000)).toEqual([]);
    expect(markdownBlocks(text, stream)).toEqual(fullBlocks(text));
  });
});
