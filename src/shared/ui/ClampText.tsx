import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type ComponentPropsWithRef,
} from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { optionalTextAttributes, type TextRoles } from "./Text";
import styles from "./ClampText.module.css";

export type ClampTextProps = Omit<ComponentPropsWithRef<"span">, "children"> &
  Omit<TextRoles, "truncate"> & {
    /** Element for a silent clamp. Default div. */
    as?: "span" | "p" | "div" | "li";
    /** Visible lines while collapsed. Default 4. */
    lines?: number;
    /** The long text or block content. It stays mounted and readable while clamped. */
    children: ReactNode;
    /** Translated label of the expand action. Default "Show more". */
    moreLabel?: string;
    /** Translated label of the collapse action. Default "Show less". */
    lessLabel?: string;
    /**
     * Show the "Show more / Show less" action when the content overflows. Default true. With
     * `false` the text is only cut at `lines` and no control is rendered: use it where the full
     * text is reachable elsewhere (a detail view, a tooltip, the row's own page).
     */
    expandable?: boolean;
    /** Initial state, for content that should open in full. */
    defaultExpanded?: boolean;
    className?: string;
  };

/**
 * Long text clamped to a few lines with a "Show more / Show less" action. The toggle appears
 * only when the content really overflows, so short text renders without any control. Text
 * stays in the DOM, so selection, search and screen readers read it in full either way.
 * `expandable={false}` renders one clamped element; `as` selects its tag and Text roles
 * set its typography. The expandable form keeps its original wrapper and toggle.
 * @group layout
 * @use A comment, description, prompt or summary whose length is unknown and that belongs in a timeline or card.
 * @avoid A hidden section of controls, logs or lists: Disclosure. Text with a different collapsed and expanded form.
 * @example
 * <ClampText lines={3}>{comment.body}</ClampText>
 * <ClampText as="p" lines={2} expandable={false} size="caption">{card.summary}</ClampText>
 */
export function ClampText({
  lines = 4,
  children,
  moreLabel,
  lessLabel,
  expandable = true,
  defaultExpanded = false,
  className,
  as = "div",
  size,
  tone,
  weight,
  leading,
  tracking,
  wrap,
  ...props
}: ClampTextProps) {
  const t = useT();
  const body = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = body.current;
    if (!el || expanded || !expandable) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, expandable, lines, children]);

  if (!expandable) {
    const Tag = as as "span";
    const roles = {
      size: size ?? (weight || leading ? "inherit" : undefined),
      tone,
      weight,
      leading,
      tracking,
      wrap,
    } as const;
    return (
      <Tag
        {...props}
        {...optionalTextAttributes(roles, [styles.silent, className].filter(Boolean).join(" "))}
        data-clamped=""
        style={{ ...props.style, "--clamp-lines": lines } as CSSProperties}
      >
        {children}
      </Tag>
    );
  }

  return (
    <div
      {...optionalTextAttributes(
        { size, tone, weight, leading, tracking, wrap },
        [styles.root, className].filter(Boolean).join(" "),
      )}
    >
      <div
        ref={body}
        className={styles.body}
        data-clamped={expanded ? undefined : ""}
        style={{ "--clamp-lines": lines } as CSSProperties}
      >
        {children}
      </div>
      {expandable && (overflows || expanded) ? (
        <Button
          variant="link"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (lessLabel ?? t("Show less")) : (moreLabel ?? t("Show more"))}
        </Button>
      ) : null}
    </div>
  );
}
