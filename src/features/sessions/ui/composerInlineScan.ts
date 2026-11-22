import { markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, language } from "@codemirror/language";
import type { ChangeSet, EditorState } from "@codemirror/state";
import { TreeFragment, type Tree } from "@lezer/common";
import { fileMentionParts } from "../../files/public/fileMentions";
import { findTokens, splitNamedAttachmentReferences } from "../model/attachmentTokens";
import { attachmentPresentation, formatAttachmentSize } from "../model/attachmentPresentation";
import { cachedUserLinkRanges, type UserLink } from "../model/linkPreview";
import { mcpTagParts } from "../model/mcpPicker";
import { splitCitationTokens } from "../model/citationTokens";
import type { InlineReference, InlineReferenceContext } from "./composerInlineReferences";

/** Scanner order is the tie-break between candidates with the same range: earlier wins. */
const LINK = 0;
const ATTACHMENT = 1;
const MISSING = 2;
const URL = 3;
const SKILL = 4;
const FILE = 5;
const MCP = 6;
const QUOTE = 7;
const SCANNERS = 8;

const NO_CODE: readonly (readonly [number, number])[] = [];
const CODE_NODES = new Set(["InlineCode", "FencedCode", "CodeBlock"]);
/**
 * Characters a skill invocation depends on beyond its own word: the token marks, and the
 * code fence / inline code / blockquote state that decides whether it counts (skillTokens.ts).
 * A change to lines with none of them cannot create, remove or re-qualify a skill token.
 */
const SKILL_SENSITIVE = /[/$`~\\>]/;

type Span = { from: number; to: number };

/** What one scan of a draft produced, kept so the next edit only rescans what it touched. */
export type InlineScan = {
  text: string;
  context: InlineReferenceContext;
  tree: Tree;
  /** Candidates per scanner before code exclusion and overlap resolution, ascending by start. */
  found: readonly (readonly InlineReference[])[];
  references: InlineReference[];
  /** Destination → resolved link, so a draft full of links parses each URL once. */
  links: ReadonlyMap<string, UserLink | null>;
};

/**
 * Parse the draft as Markdown. An installed Markdown language supplies its own incremental
 * tree; otherwise the previous tree's unchanged blocks are reused through tree fragments.
 */
function parseMarkdown(
  text: string,
  previous?: { tree: Tree; changes: ChangeSet },
  state?: EditorState,
): Tree {
  if (state && state.facet(language) === markdownLanguage) {
    const installed = ensureSyntaxTree(state, text.length, 50);
    if (installed) return installed;
  }
  if (!previous) return markdownLanguage.parser.parse(text);
  const edits: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
  previous.changes.iterChangedRanges((fromA, toA, fromB, toB) =>
    edits.push({ fromA, toA, fromB, toB }),
  );
  return markdownLanguage.parser.parse(
    text,
    TreeFragment.applyChanges(TreeFragment.addTree(previous.tree), edits),
  );
}

/** Links and code, read from the whole tree: a cheap walk, and always consistent with the parse. */
function readTree(tree: Tree, text: string, memo: ReadonlyMap<string, UserLink | null>) {
  const code: [number, number][] = [];
  const links: InlineReference[] = [];
  const resolved = new Map<string, UserLink | null>();
  tree.iterate({
    enter(node) {
      if (CODE_NODES.has(node.name)) {
        code.push([node.from, node.to]);
        return false;
      }
      if (node.name !== "Link") return;
      const destination = node.node.getChild("URL");
      if (!destination) return;
      const address = text.slice(destination.from, destination.to);
      let link = resolved.has(address) ? resolved.get(address) : memo.get(address);
      if (link === undefined)
        link =
          cachedUserLinkRanges(address).find(
            (range) => range.start === 0 && range.end === address.length,
          )?.link ?? null;
      resolved.set(address, link);
      if (link)
        links.push({
          start: node.from,
          end: node.to,
          kind: "url",
          value: link.url,
          label: text.slice(node.from + 1, text.indexOf("]", node.from)) || link.host,
        });
    },
  });
  return { code, links, resolved };
}

/** Skill tokens of the whole draft, exactly as the full scan finds them. */
function scanSkills(text: string, context: InlineReferenceContext): InlineReference[] {
  const found: InlineReference[] = [];
  const { names, skillParts, skillGroups, modeEnd } = context;
  const groups = new Map(skillGroups?.map((group) => [group.invocation, group]));
  let start = modeEnd;
  for (const part of skillParts(text.slice(modeEnd), names)) {
    const end = start + part.text.length;
    if (part.skill) {
      const name = part.text.slice(1);
      const group = groups.get(name);
      found.push({
        start,
        end,
        kind: group ? "group" : "skill",
        value: name,
        label: group?.name ?? name,
        detail: group && String(group.members.length),
      });
    }
    start = end;
  }
  return found;
}

/**
 * Every scanner except skills and Markdown links over `text.slice(from, to)`, which must be whole
 * lines: none of their tokens spans a line break or looks past it, so a line is scanned alone.
 * Code exclusion is applied later from the tree, so no scanner parses Markdown itself here.
 */
function scanLines(
  text: string,
  from: number,
  to: number,
  context: InlineReferenceContext,
  found: InlineReference[][],
) {
  const { attachments, mentions, mcpTags, citations } = context;
  const slice = text.slice(from, to);
  for (const match of findTokens(slice, attachments, NO_CODE)) {
    const file = attachments[match.index];
    found[ATTACHMENT]!.push({
      start: from + match.start,
      end: from + match.end,
      kind: "attachment",
      value: file.id,
      label: file.name,
      detail: formatAttachmentSize(file.size) ?? undefined,
      tone: attachmentPresentation(file).kind,
    });
  }
  if (slice.includes("; ref=")) {
    let offset = from;
    for (const part of splitNamedAttachmentReferences(slice, NO_CODE)) {
      if ("token" in part) {
        found[MISSING]!.push({
          start: offset,
          end: offset + part.token.length,
          kind: "missing",
          value: part.name,
          label: part.name,
        });
        offset += part.token.length;
      } else offset += part.text.length;
    }
  }
  for (const { start, end, link } of cachedUserLinkRanges(slice)) {
    const parts = link.displayUrl.split(/[?#]/, 1)[0].split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    found[URL]!.push({
      start: from + start,
      end: from + end,
      kind: "url",
      value: link.url,
      label: last && last !== link.host ? `${link.host} · ${last}` : link.host,
    });
  }
  let start = from;
  for (const part of fileMentionParts(slice, mentions)) {
    const end = start + part.text.length;
    if (part.file && !part.file.isDir)
      found[FILE]!.push({ start, end, kind: "file", value: part.file.path, label: part.file.name });
    start = end;
  }
  start = from;
  for (const part of mcpTagParts(slice, mcpTags)) {
    const end = start + part.text.length;
    if (part.tag)
      found[MCP]!.push({
        start,
        end,
        kind: "mcp",
        value: part.tag.token,
        label: part.tag.server.name,
      });
    start = end;
  }
  start = from;
  for (const part of splitCitationTokens(slice, citations, NO_CODE)) {
    if ("token" in part) {
      const end = start + part.token.length;
      found[QUOTE]!.push({
        start,
        end,
        kind: "quote",
        value: part.token,
        label: part.token.slice(1, -1),
      });
      start = end;
    } else start += part.text.length;
  }
}

/** Whether a code range overlaps `[start, end)`; `code` is ascending and disjoint. */
function overlapsCode(code: readonly (readonly [number, number])[], start: number, end: number) {
  let low = 0;
  let high = code.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (code[middle]![1] <= start) low = middle + 1;
    else high = middle;
  }
  return low < code.length && code[low]![0] < end;
}

function resolveReferences(
  found: readonly (readonly InlineReference[])[],
  code: readonly (readonly [number, number])[],
  modeEnd: number,
): InlineReference[] {
  const ranges: InlineReference[] = [];
  let reach = 0;
  for (const item of found.flat().sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (item.start < modeEnd || item.start < reach || overlapsCode(code, item.start, item.end))
      continue;
    ranges.push(item);
    reach = item.end;
  }
  return ranges;
}

/** Whole lines around every changed range, in the new text, merged where they overlap. */
function changedLines(text: string, changes: ChangeSet): Span[] {
  const spans: Span[] = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const from = fromB === 0 ? 0 : text.lastIndexOf("\n", fromB - 1) + 1;
    const end = text.indexOf("\n", toB);
    const to = end < 0 ? text.length : end;
    const last = spans[spans.length - 1];
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else spans.push({ from, to });
  });
  return spans;
}

function intersects(spans: readonly Span[], start: number, end: number) {
  return spans.some((span) => start < span.to && end > span.from);
}

/**
 * Scan a draft from scratch. Pass `tree` when the caller already has the Markdown tree
 * (an editor with the Markdown language installed).
 */
export function scanInlineReferences(
  text: string,
  context: InlineReferenceContext,
  tree: Tree = markdownLanguage.parser.parse(text),
): InlineScan {
  return rescan(text, context, tree, undefined);
}

function rescan(
  text: string,
  context: InlineReferenceContext,
  tree: Tree,
  previous: { scan: InlineScan; changes: ChangeSet } | undefined,
): InlineScan {
  const { code, links, resolved } = readTree(tree, text, previous?.scan.links ?? new Map());
  const found: InlineReference[][] = Array.from({ length: SCANNERS }, () => []);
  found[LINK] = links;
  const whole = [{ from: 0, to: text.length }];
  // A change at one place only touches lines it covers: the scanners are line-local, and
  // code exclusion comes from the whole tree above, which already reflects the edit.
  const incremental =
    previous &&
    previous.scan.context === context &&
    context.mcpTags.every((tag) => !/\n/.test(tag.token))
      ? previous
      : undefined;
  const spans = incremental ? changedLines(text, incremental.changes) : whole;
  if (incremental) {
    const { scan, changes } = incremental;
    const inverse = changes.invertedDesc;
    const oldSpans = spans.map((span) => ({
      from: inverse.mapPos(span.from, -1),
      to: inverse.mapPos(span.to, 1),
    }));
    for (const index of [ATTACHMENT, MISSING, URL, FILE, MCP, QUOTE]) {
      for (const item of scan.found[index]!) {
        if (intersects(oldSpans, item.start, item.end)) continue;
        const start = changes.mapPos(item.start, 1);
        const end = changes.mapPos(item.end, -1);
        found[index]!.push(
          start === item.start && end === item.end ? item : { ...item, start, end },
        );
      }
    }
    // A skill token also depends on code fences and quotes elsewhere in the draft, and on the
    // text before the mode prefix: only a change that touches none of those keeps the old tokens.
    const unchanged = spans.every((span, index) => {
      const old = oldSpans[index]!;
      return (
        span.from >= context.modeEnd &&
        old.from >= context.modeEnd &&
        !SKILL_SENSITIVE.test(text.slice(span.from, span.to)) &&
        !SKILL_SENSITIVE.test(scan.text.slice(old.from, old.to))
      );
    });
    if (unchanged)
      for (const item of scan.found[SKILL]!) {
        const start = changes.mapPos(item.start, 1);
        const end = changes.mapPos(item.end, -1);
        found[SKILL]!.push(
          start === item.start && end === item.end ? item : { ...item, start, end },
        );
      }
    else found[SKILL] = scanSkills(text, context);
  } else found[SKILL] = scanSkills(text, context);
  for (const span of spans) scanLines(text, span.from, span.to, context, found);
  for (const list of found) list.sort((a, b) => a.start - b.start);
  return {
    text,
    context,
    tree,
    found,
    references: resolveReferences(found, code, context.modeEnd),
    links: resolved,
  };
}

/**
 * The scan of `text` after `changes` turned `previous.text` into it: only lines the changes
 * touched are rescanned, the Markdown tree reuses its unchanged blocks, and every other
 * candidate is carried over with its position mapped. The result equals `scanInlineReferences`.
 */
export function updateInlineScan(
  previous: InlineScan,
  text: string,
  changes: ChangeSet,
  context: InlineReferenceContext,
  state?: EditorState,
): InlineScan {
  if (changes.empty && previous.context === context) return previous;
  const tree = changes.empty
    ? previous.tree
    : parseMarkdown(text, { tree: previous.tree, changes }, state);
  return rescan(text, context, tree, { scan: previous, changes });
}

/** The first scan of an editor's document, using its own Markdown tree when it has one. */
export function createInlineScan(state: EditorState, context: InlineReferenceContext): InlineScan {
  const text = state.doc.toString();
  return scanInlineReferences(text, context, parseMarkdown(text, undefined, state));
}
