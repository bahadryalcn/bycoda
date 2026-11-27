import { GFM, parser } from "@lezer/markdown";
import { graphemes } from "../../../shared/lib/text/truncate";
import { splitNamedAttachmentReferences } from "../../sessions/public/attachments";
import { skillInvocationTokens } from "../../skills";
import { taskInstructionsSummary } from "./taskInstructions";

export const TASK_TITLE_LIMIT = 200;

const markdown = parser.configure(GFM);
const syntaxMarkers = new Set([
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "EmphasisMark",
  "StrikethroughMark",
  "LinkMark",
  "Escape",
  "HorizontalRule",
  "TaskMarker",
]);

/** Empty means the draft needs a readable title before it can be saved. */
export function resolveTaskTitle(title: string, prompt: string): string {
  const explicit = title.trim();
  if (explicit) return explicit.length <= TASK_TITLE_LIMIT ? explicit : "";

  const summary = taskInstructionsSummary(prompt);
  // Keep original indentation for Markdown code blocks in plain-text prompts.
  const source = summary === prompt.trim() ? prompt : summary;
  const markers: [number, number][] = [];
  const code: [number, number][] = [];
  markdown.parse(source).iterate({
    enter(node) {
      if (node.name === "FencedCode") {
        code.push([node.from, node.to]);
        const cursor = node.node.cursor();
        if (cursor.firstChild()) {
          do {
            if (cursor.name === "CodeMark" || cursor.name === "CodeInfo")
              markers.push([cursor.from, cursor.to]);
          } while (cursor.nextSibling());
        }
        return false;
      }
      if (node.name === "CodeBlock") {
        code.push([node.from, node.to]);
        return false;
      }
      if (node.name === "InlineCode") {
        code.push([node.from, node.to]);
        for (let mark = node.node.firstChild; mark; mark = mark.nextSibling)
          if (mark.name === "CodeMark") markers.push([mark.from, mark.to]);
        return false;
      }
      if (node.name === "Link" || node.name === "Image") {
        const close = node.node.getChildren("LinkMark").find((mark) => source[mark.from] === "]");
        if (close) markers.push([close.from, node.to]);
      }
      if (syntaxMarkers.has(node.name)) {
        if (node.name === "LinkMark" && !/^[![]/.test(source.slice(node.from, node.to))) return;
        markers.push([node.from, node.name === "Escape" ? node.from + 1 : node.to]);
      }
    },
  });
  let offset = 0;
  for (const part of splitNamedAttachmentReferences(source, code)) {
    const length = "text" in part ? part.text.length : part.token.length;
    if ("token" in part) markers.push([offset, offset + length]);
    offset += length;
  }
  for (const { start, end } of skillInvocationTokens(source)) {
    if (!code.some(([from, to]) => start >= from && start < to)) markers.push([start, end]);
  }
  const stripped = source.split("");
  for (const [from, to] of markers) {
    for (let index = from; index < to; index++) {
      if (stripped[index] !== "\n") stripped[index] = "";
    }
  }
  const line =
    stripped
      .join("")
      .split(/\r\n?|\n/)
      .map((entry) => entry.replace(/\s+/g, " ").trim())
      .find((entry) => /[^\s\p{Cf}]/u.test(entry)) ?? "";
  if (line.length <= TASK_TITLE_LIMIT) return line;
  let end = 0;
  // Include the next code point so a grapheme crossing the cap is detected.
  for (const part of graphemes(line.slice(0, TASK_TITLE_LIMIT + 2))) {
    if (end + part.length > TASK_TITLE_LIMIT) break;
    end += part.length;
  }
  return line.slice(0, end).trimEnd();
}
