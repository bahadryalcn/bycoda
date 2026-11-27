import { skillInvocationTokens } from "../../skills";
import type { InlineReferenceContext } from "./composerInlineReferences";

/** Real skill tokenizing (fence and inline-code aware) without the skills store's native imports. */
function skillParts(text: string, names: ReadonlySet<string>) {
  if (!text) return [];
  const parts: { text: string; skill?: boolean }[] = [];
  let cursor = 0;
  for (const { name, start, end } of skillInvocationTokens(text)) {
    if (!names.has(name)) continue;
    if (start > cursor) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: text.slice(start, end), skill: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

export function inlineFixtureContext(modeEnd = 0): InlineReferenceContext {
  const file = (name: string) => ({ name, path: `/fixture/${name}`, relative: name });
  return {
    attachments: [
      { id: "photo", name: "image.png", mimeType: "image/png", kind: "image", size: 1024 },
      { id: "sheet", name: "data.csv", mimeType: "text/csv", kind: "file", size: 2048 },
    ],
    citations: 2,
    modeEnd,
    names: new Set(["review", "plan"]),
    skillParts: (text, names) => skillParts(text, names) as never,
    mentions: new Map([
      ["App.tsx", file("App.tsx")],
      ["src/main.ts", file("src/main.ts")],
    ]),
    mcpTags: [],
  };
}

/** Every construct the scanner distinguishes, so edits can open and close any of them. */
export const INLINE_FIXTURE_PIECES = [
  "plain words about the change",
  "see [image1] now",
  "and [File 1] too",
  "[Image: image.png; ref=image_photo]",
  "[Image: gone.png; ref=image_gone]",
  "open @App.tsx and @src/main.ts,",
  "visit https://example.com/docs/page?x=1.",
  "a [link](https://example.org/a) here",
  "/review and /plan",
  "$review",
  "cite [1] and [2]",
  "`inline code https://example.net/z`",
  "```",
  "```ts",
  "~~~",
  "> quoted @App.tsx",
  "    indented [image1]",
  "<div>",
  "",
  "",
  "- list item /plan",
  "# heading",
  "\\`escaped",
  "[unclosed](",
];

/** Deterministic pseudo-random numbers so a failing edit sequence replays. */
export function seededRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function buildDraft(bytes: number, random = seededRandom(7)): string {
  const lines: string[] = [];
  let size = 0;
  const calm = INLINE_FIXTURE_PIECES.filter((piece) => !/^(```|~~~|<div>|\\)/.test(piece));
  while (size < bytes) {
    // A closed fence now and then keeps long drafts mostly prose, like real ones.
    const roll = random();
    if (roll > 0.12) {
      const line = PROSE[Math.floor(random() * PROSE.length)]!;
      lines.push(line);
      size += line.length + 1;
      continue;
    }
    const block =
      roll < 0.01
        ? "```ts\nconst url = 'https://example.com/code'; // [image1] @App.tsx\n```"
        : calm[Math.floor(random() * calm.length)]!;
    lines.push(block);
    size += block.length + 1;
  }
  return lines.join("\n");
}

const PROSE = [
  "The quick brown fox jumps over the lazy dog while the draft keeps growing line by line.",
  "I would like the assistant to look at the failing path and explain why the retry never fires.",
  "",
  "After the refactor the cache is rebuilt twice, which is why the second pass looks so slow.",
  "Please keep the public contract unchanged and only touch the model folder for this change.",
];
