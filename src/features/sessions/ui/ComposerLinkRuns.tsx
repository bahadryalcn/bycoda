import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ExternalLink } from "../../../shared/ui/icons";
import { UserLinkIcon } from "./UserLinkIcon";
import { cachedUserLinkRanges, type UserLinkRange } from "../model/linkPreview";
import { openExternal } from "../../../platform/tauri/openExternal";
import { observeResize } from "../../../shared/lib/observeResize";
import { createLinkWrapRegistry, type LinkWrapRegistry } from "./composerLinkWrap";
import styles from "./ComposerHighlight.module.css";

/** The link under the textarea's caret or selection, read from the field itself. */
function editedLinkAt(field: HTMLTextAreaElement): string | null {
  if (document.activeElement !== field) return null;
  const { selectionStart: start, selectionEnd: end, value } = field;
  const range = cachedUserLinkRanges(value).find((link) => start <= link.end && end >= link.start);
  return range ? value.slice(range.start, range.end) : null;
}

/**
 * The draft text of the link holding the caret or selection, which then shows in full.
 * The state is that text, not the selection, so a caret moving through plain text or
 * within one link changes nothing and re-renders nothing; tokenization is reused by the
 * draft's text, so only an edit tokenizes again.
 */
export function useEditedLink(text: string, field?: RefObject<HTMLTextAreaElement | null>) {
  const [edited, setEdited] = useState<string | null>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- mirrors the textarea caret via DOM selection and focus listeners; re-syncs when the draft changes without a selection event
  useEffect(() => {
    const el = field?.current;
    if (!el) return;
    const sync = () => setEdited(editedLinkAt(el));
    sync();
    document.addEventListener("selectionchange", sync);
    el.addEventListener("focus", sync);
    el.addEventListener("blur", sync);
    el.addEventListener("input", sync);
    return () => {
      document.removeEventListener("selectionchange", sync);
      el.removeEventListener("focus", sync);
      el.removeEventListener("blur", sync);
      el.removeEventListener("input", sync);
    };
  }, [field, text]);
  return edited;
}

/**
 * One wrap registry for the overlay's links. They are measured together after every
 * draft change that reaches the DOM and whenever the textarea resizes, never per link.
 */
export function useLinkWrap(draft: string, field?: RefObject<HTMLTextAreaElement | null>) {
  const [registry] = useState(createLinkWrapRegistry);
  // Both orders of a link hold the same characters, so they wrap alike; measuring whichever
  // is shown after each draft edit and field resize keeps the choice stable. The links' own
  // layout effects have already registered by the time this one runs.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- measures the rendered link spans after each commit that changed the draft or added a link
  useLayoutEffect(() => registry.settle(draft));
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- observes the textarea's size while mounted
  useLayoutEffect(() => {
    const el = field?.current;
    return el ? observeResize(el, registry.measure) : undefined;
  }, [field, registry]);
  return registry;
}

/**
 * Boxes each web link with an open badge at its end. The textarea underneath keeps the
 * raw text, so the box only rearranges its own characters: the hidden `https://` gives
 * the box its padding and the badge its room. A link being edited, or one that wraps
 * across lines, shows in source order: a rearranged link would break at a different
 * character than the textarea and push the caret off every character after it.
 */
export function LinkRuns({
  text,
  edited,
  wrap,
  renderText,
}: {
  text: string;
  edited: string | null;
  wrap: LinkWrapRegistry;
  renderText: (text: string) => ReactNode;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const range of cachedUserLinkRanges(text)) {
    parts.push(<Fragment key={`t${last}`}>{renderText(text.slice(last, range.start))}</Fragment>);
    const link = text.slice(range.start, range.end);
    parts.push(
      <LinkToken
        key={`l${range.start}`}
        link={link}
        url={range.link}
        editing={link === edited}
        wrap={wrap}
      />,
    );
    last = range.end;
  }
  parts.push(<Fragment key={`t${last}`}>{renderText(text.slice(last))}</Fragment>);
  return parts;
}

function LinkToken({
  link,
  url,
  editing,
  wrap,
}: {
  link: string;
  url: UserLinkRange["link"];
  editing: boolean;
  wrap: LinkWrapRegistry;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [wrapped, setWrapped] = useState(false);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- registers the rendered link span with the overlay's shared wrap measurement while mounted
  useLayoutEffect(() => {
    const el = ref.current;
    return el ? wrap.add(el, setWrapped) : undefined;
  }, [wrap]);
  const source = editing || wrapped;
  const scheme = link.indexOf("://") + 3;
  // The same span in both orders, so the measured element survives a switch.
  return (
    <>
      <span ref={ref} className={styles.link} data-composer-link-token="">
        {source ? (
          link
        ) : (
          <>
            <span className={styles.linkPrefix}>
              <span className={styles.hidden}>{link[0]}</span>
              <span className={styles.linkMark} data-composer-link-icon="" aria-hidden="true">
                <UserLinkIcon link={url} />
              </span>
            </span>
            {link.slice(scheme)}
            <span className={styles.badge}>
              {link.slice(1, scheme - 1)}
              {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Pointer shortcut in the aria-hidden overlay; the link stays editable text in the textarea. */}
              <span
                className={styles.open}
                data-composer-link-open=""
                // Keeps focus, and so the caret, in the message box.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  openExternal(url.url).catch((error: unknown) =>
                    console.error("Failed to open composer link:", error),
                  )
                }
              >
                <ExternalLink className={styles.openIcon} strokeWidth={2} />
              </span>
            </span>
          </>
        )}
      </span>
      {source ? null : <span className={styles.hidden}>{link[scheme - 1]}</span>}
    </>
  );
}
