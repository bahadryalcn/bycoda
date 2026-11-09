import type { ChatCitation } from "./chatCitation";
import { requestTranscriptJump } from "./transcriptJump";

const NAME = "bycoda-chat-citation";
let cleanup: (() => void) | undefined;

/** Resolve only within the original visible session, and only against the exact snapshot. */
export function chatCitationRange(citation: ChatCitation, document: Document): Range | null {
  const roots = document.querySelectorAll<HTMLElement>("[data-chat-citation-session]");
  for (const root of roots) {
    if (
      root.dataset.chatCitationSession !== citation.sessionId ||
      root.closest("[hidden], [aria-hidden='true']")
    )
      continue;
    for (const source of root.querySelectorAll<HTMLElement>("[data-selectable-agent-response]")) {
      if (source.dataset.selectableAgentResponse !== citation.blockId) continue;
      if (source.textContent !== citation.sourceText) return null;
      let offset = -citation.text.length;
      for (let index = 0; index <= citation.occurrence; index++) {
        offset = citation.sourceText.indexOf(citation.text, offset + citation.text.length);
        if (offset < 0) return null;
      }
      const end = offset + citation.text.length;
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let seen = 0;
      let started = false;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const size = node.textContent?.length ?? 0;
        if (!started && offset >= seen && offset < seen + size) {
          range.setStart(node, offset - seen);
          started = true;
        }
        if (started && end > seen && end <= seen + size) {
          range.setEnd(node, end - seen);
          return range;
        }
        seen += size;
      }
      return null;
    }
  }
  return null;
}

/** Hover/focus never moves the viewport. Clicking may reveal a virtualized source. */
export function highlightChatCitation(
  citation: ChatCitation,
  options?: { navigate?: boolean; onUnavailable?: () => void },
): boolean {
  if (
    typeof document === "undefined" ||
    !citation.text ||
    !Number.isSafeInteger(citation.occurrence) ||
    citation.occurrence < 0
  )
    return false;
  cleanup?.();
  const range = chatCitationRange(citation, document);
  const session = Array.from(
    document.querySelectorAll<HTMLElement>("[data-chat-citation-session]"),
  ).find(
    (root) =>
      root.dataset.chatCitationSession === citation.sessionId &&
      !root.closest("[hidden], [aria-hidden='true']"),
  );
  if (!session) return false;
  const sourceExists = Array.from(
    session.querySelectorAll<HTMLElement>("[data-selectable-agent-response]"),
  ).some((source) => source.dataset.selectableAgentResponse === citation.blockId);
  // A changed source is never replaced with a matching passage in another block.
  if (!range && sourceExists) return false;
  let observer: MutationObserver | undefined;
  let resolved = Boolean(range);
  const timers: ReturnType<typeof setTimeout>[] = [];
  const clear = () => {
    observer?.disconnect();
    timers.forEach(clearTimeout);
    if (typeof CSS !== "undefined" && "highlights" in CSS) CSS.highlights.delete(NAME);
    if (cleanup === clear) cleanup = undefined;
  };
  cleanup = clear;
  const paint = (target: Range) => {
    if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined")
      return;
    CSS.highlights.set(NAME, new Highlight(target));
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      timers.push(setTimeout(() => CSS.highlights.delete(NAME), 350));
      timers.push(setTimeout(() => CSS.highlights.set(NAME, new Highlight(target)), 500));
    }
    timers.push(setTimeout(clear, 1800));
  };
  if (options?.navigate) {
    requestTranscriptJump(citation.sessionId, citation.blockId);
    if (!range) {
      const alreadyRevealed = chatCitationRange(citation, document);
      if (alreadyRevealed) {
        paint(alreadyRevealed);
        return true;
      }
      observer = new MutationObserver(() => {
        const revealed = chatCitationRange(citation, document);
        if (revealed) {
          resolved = true;
          observer?.disconnect();
          paint(revealed);
        }
      });
      observer.observe(session, { subtree: true, childList: true, characterData: true });
      timers.push(
        setTimeout(() => {
          clear();
          if (!resolved) options.onUnavailable?.();
        }, 2500),
      );
    }
  }
  if (range) paint(range);
  else if (!options?.navigate) {
    clear();
    return false;
  }
  return true;
}
