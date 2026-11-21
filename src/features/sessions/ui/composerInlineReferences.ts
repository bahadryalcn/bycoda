import { markdownLanguage } from "@codemirror/lang-markdown";
import { fileMentionParts } from "../../files/public/fileMentions";
import { findTokens, splitNamedAttachmentReferences } from "../model/attachmentTokens";
import { attachmentPresentation, formatAttachmentSize } from "../model/attachmentPresentation";
import { cachedUserLinkRanges } from "../model/linkPreview";
import { mcpTagParts } from "../model/mcpPicker";
import { splitCitationTokens } from "../model/citationTokens";
import type { ComposerReferenceContext } from "./ComposerHighlight";
import type { Attachment } from "../model/session";

export type InlineReferenceKind =
  | "attachment"
  | "missing"
  | "file"
  | "url"
  | "skill"
  | "group"
  | "quote"
  | "mcp";
export type InlineReference = {
  start: number;
  end: number;
  kind: InlineReferenceKind;
  value: string;
  label: string;
  detail?: string;
  tone?: string;
};

export type InlineReferenceContext = ComposerReferenceContext & {
  attachments: Attachment[];
  citations: number;
  modeEnd: number;
};

/** Resolve display ranges against the original draft. Widgets never rewrite the document. */
export function composerInlineReferences(
  text: string,
  context: InlineReferenceContext,
): InlineReference[] {
  const { attachments, names, skillParts, skillGroups, mentions, mcpTags, citations, modeEnd } =
    context;
  const found: InlineReference[] = [];
  const excluded: { from: number; to: number }[] = [];
  markdownLanguage.parser.parse(text).iterate({
    enter(node) {
      if (["InlineCode", "FencedCode", "CodeBlock"].includes(node.name)) {
        excluded.push({ from: node.from, to: node.to });
        return false;
      }
      if (node.name !== "Link") return;
      const destination = node.node.getChild("URL");
      if (!destination) return;
      const address = text.slice(destination.from, destination.to);
      const link = cachedUserLinkRanges(address).find(
        (range) => range.start === 0 && range.end === address.length,
      )?.link;
      if (link)
        found.push({
          start: node.from,
          end: node.to,
          kind: "url",
          value: link.url,
          label: text.slice(node.from + 1, text.indexOf("]", node.from)) || link.host,
        });
    },
  });
  for (const match of findTokens(text, attachments)) {
    const file = attachments[match.index];
    const presentation = attachmentPresentation(file);
    found.push({
      start: match.start,
      end: match.end,
      kind: "attachment",
      value: file.id,
      label: file.name,
      detail: formatAttachmentSize(file.size) ?? undefined,
      tone: presentation.kind,
    });
  }
  if (text.includes("; ref=")) {
    let offset = 0;
    for (const part of splitNamedAttachmentReferences(text)) {
      if ("token" in part) {
        found.push({
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
  for (const { start, end, link } of cachedUserLinkRanges(text)) {
    const parts = link.displayUrl.split(/[?#]/, 1)[0].split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    found.push({
      start,
      end,
      kind: "url",
      value: link.url,
      label: last && last !== link.host ? `${link.host} · ${last}` : link.host,
    });
  }
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
  start = 0;
  for (const part of fileMentionParts(text, mentions)) {
    const end = start + part.text.length;
    if (part.file && !part.file.isDir)
      found.push({ start, end, kind: "file", value: part.file.path, label: part.file.name });
    start = end;
  }
  start = 0;
  for (const part of mcpTagParts(text, mcpTags)) {
    const end = start + part.text.length;
    if (part.tag)
      found.push({ start, end, kind: "mcp", value: part.tag.token, label: part.tag.server.name });
    start = end;
  }
  start = 0;
  for (const part of splitCitationTokens(text, citations)) {
    if ("token" in part) {
      const end = start + part.token.length;
      found.push({ start, end, kind: "quote", value: part.token, label: part.token.slice(1, -1) });
      start = end;
    } else start += part.text.length;
  }
  const ranges: InlineReference[] = [];
  for (const item of found.sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (
      item.start < modeEnd ||
      item.start < (ranges[ranges.length - 1]?.end ?? 0) ||
      excluded.some(({ from, to }) => item.start < to && item.end > from)
    )
      continue;
    ranges.push(item);
  }
  return ranges;
}
