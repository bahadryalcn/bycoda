import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { UserLinkIcon } from "./UserLinkIcon";
import { cachedUserLinkRanges, type UserLinkRange } from "../model/linkPreview";
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
 * Paint a compact link over the original source advances. A link being edited or
 * wrapping across lines shows its source, with the same open target in either state.
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
  const label = url.displayUrl.split(/[?#]/, 1)[0];
  return (
    <span
      ref={ref}
      className={source ? styles.link : styles.linkLabelled}
      data-composer-link-token=""
      data-composer-reference="url"
      data-reference-value={url.url}
    >
      {source ? link : <span className={styles.hidden}>{link}</span>}
      {source ? null : (
        <span className={styles.linkFace} data-reference-face="" aria-hidden="true">
          <span data-composer-link-icon="">
            <UserLinkIcon link={url} />
          </span>
          <span className={styles.linkName} data-link-label={label} />
        </span>
      )}
    </span>
  );
}
