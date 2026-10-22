import { isMarkdownBlockquotePosition } from "../../sessions/model/quoteDraft";

/** Shared by prompt expansion and the desktop picker/highlighter. */
export function isSkillInvocationPosition(text: string, at: number): boolean {
  if (isMarkdownBlockquotePosition(text, at)) return false;
  let fence: { character: string; length: number } | undefined;
  let inline = 0;
  let offset = 0;
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const targetLine = offset + line.length >= at;
    if (targetLine && (fence || marker)) return false;
    if (!fence && !marker) {
      const prefix = targetLine ? line.slice(0, at - offset) : line;
      for (let i = 0; i < prefix.length; i++) {
        if (prefix[i] === "\\" && !inline) {
          i++;
          continue;
        }
        if (prefix[i] !== "`") continue;
        let end = i + 1;
        while (prefix[end] === "`") end++;
        const length = end - i;
        if (!inline) inline = length;
        else if (inline === length) inline = 0;
        i = end - 1;
      }
    }
    if (targetLine) return !inline;
    if (marker) {
      inline = 0;
      const run = marker[1];
      if (!fence) fence = { character: run[0], length: run.length };
      else if (run[0] === fence.character && run.length >= fence.length && !marker[2].trim())
        fence = undefined;
    }
    offset += line.length + 1;
  }
  return true;
}

export function skillInvocationTokens(
  text: string,
): { name: string; start: number; end: number }[] {
  const tokens: { name: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(/(^|\s)[/$]([A-Za-z0-9][A-Za-z0-9_.:-]*)(?=\s|$)/g)) {
    const start = match.index + match[1].length;
    if (isSkillInvocationPosition(text, start))
      tokens.push({ name: match[2], start, end: start + match[2].length + 1 });
  }
  return tokens;
}
