import { memo, type ComponentPropsWithoutRef } from "react";
import styles from "./MiddleTruncate.module.css";

export type MiddleTruncateMode = "auto" | "path" | "text";

export type MiddleTruncateProps = Omit<ComponentPropsWithoutRef<"span">, "children" | "title"> & {
  /** The complete value; it stays in the accessibility tree and in `title`. */
  children: string;
  /** `path` keeps the final segment (including its separator), `text` keeps the last `tail` characters,
   *  `auto` picks `path` when the value contains a `/` or `\` separator. */
  mode?: MiddleTruncateMode;
  /** Maximum number of characters kept visible at the end. Defaults to 28 for a path segment and 10 for text. */
  tail?: number;
  /** Native tooltip. Defaults to the full value; pass `false` when the parent already provides one. */
  title?: string | false;
};

const PATH_TAIL = 28;
const TEXT_TAIL = 10;
/** Grapheme clusters rarely exceed a handful of UTF-16 units; this bounds segmentation work per call. */
const UNITS_PER_CLUSTER = 8;

type GraphemeSegmenter = { segment(value: string): Iterable<{ segment: string }> };
let segmenter: GraphemeSegmenter | null | undefined;

function graphemes(value: string): string[] {
  if (segmenter === undefined) {
    const Segmenter = (
      Intl as unknown as {
        Segmenter?: new (
          locale?: string,
          options?: { granularity: "grapheme" },
        ) => GraphemeSegmenter;
      }
    ).Segmenter;
    segmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;
  }
  return segmenter
    ? Array.from(segmenter.segment(value), (part) => part.segment)
    : Array.from(value);
}

/** The last `count` user-perceived characters of `value`, never splitting a surrogate pair or emoji sequence. */
function lastCharacters(value: string, count: number): string {
  if (count <= 0) return "";
  if (value.length <= count) return value;
  const window =
    value.length > count * UNITS_PER_CLUSTER ? value.slice(-count * UNITS_PER_CLUSTER) : value;
  return graphemes(window).slice(-count).join("");
}

/** Splits a value into the shrinking head and the always-visible tail. An empty tail means no truncation split. */
export function splitMiddle(
  value: string,
  { mode = "auto", tail }: { mode?: MiddleTruncateMode; tail?: number } = {},
): { head: string; tail: string } {
  const limit =
    tail !== undefined && Number.isFinite(tail) ? Math.max(0, Math.floor(tail)) : undefined;
  const textLimit = limit ?? TEXT_TAIL;
  if (!limit && limit !== undefined) return { head: value, tail: "" };
  if (value.length <= textLimit) return { head: value, tail: "" };
  const separator = Math.max(
    value.lastIndexOf("/", value.length - 2),
    value.lastIndexOf("\\", value.length - 2),
  );
  const path = mode === "path" || (mode === "auto" && separator > 0);
  if (path && separator > 0) {
    const pathLimit = limit ?? PATH_TAIL;
    const segment = value.slice(separator);
    const kept = segment.length <= pathLimit ? segment : lastCharacters(value, pathLimit);
    return kept
      ? { head: value.slice(0, value.length - kept.length), tail: kept }
      : { head: value, tail: "" };
  }
  const kept = lastCharacters(value, textLimit);
  return kept.length >= value.length || !kept
    ? { head: value, tail: "" }
    : { head: value.slice(0, value.length - kept.length), tail: kept };
}

/**
 * Long path, branch and model names keep their meaningful end (file name, branch tail, version suffix) while the
 * middle collapses into an ellipsis. Pure CSS flex layout does the fitting, so there is no observer, state or
 * layout read per row. Place it in a flex parent with `min-w-0` (or any bounded block) like any truncating text.
 */
export const MiddleTruncate = memo(function MiddleTruncate({
  children,
  mode = "auto",
  tail,
  title,
  className,
  ...props
}: MiddleTruncateProps) {
  const parts = splitMiddle(children, { mode, tail });
  const tooltip = title === false ? undefined : (title ?? children);
  // A tail wider than a very narrow container collapses in its own middle, so its last characters stay readable.
  const tailEnd = parts.tail ? lastCharacters(parts.tail, TEXT_TAIL) : "";
  const classes = [parts.tail ? styles.root : styles.plain, className].filter(Boolean).join(" ");
  if (!parts.tail)
    return (
      <span {...props} title={tooltip} className={classes}>
        {children}
      </span>
    );
  return (
    <span {...props} title={tooltip} className={classes} data-middle-truncate="">
      <span className={styles.full}>{children}</span>
      <span aria-hidden="true" className={styles.head}>
        {parts.head}
      </span>
      <span aria-hidden="true" className={styles.tail}>
        {tailEnd.length < parts.tail.length ? (
          <>
            <span className={styles.tailHead}>{parts.tail.slice(0, -tailEnd.length)}</span>
            <span className={styles.tailEnd}>{tailEnd}</span>
          </>
        ) : (
          parts.tail
        )}
      </span>
    </span>
  );
});
