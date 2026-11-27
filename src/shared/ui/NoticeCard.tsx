import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useT } from "../i18n";
import { Button } from "./Button";
import { RefreshCw, X } from "./icons";
import { NoticeGlyph, noticeEnterClass, type NoticeTone } from "./Notice";
import styles from "./Notice.module.css";
import { Spinner } from "./Spinner";
import { Text } from "./Text";

/**
 * `retry` is dashed and transparent, `error` carries a danger tint, `warning` a warning tint (usage
 * limit, unconfirmed delivery), `success` and `info` their own, `neutral` is a settled outcome.
 */
export type NoticeCardKind = "retry" | "error" | "warning" | "success" | "info" | "neutral";

/** The shared glyph tone of each kind; a retry reads as information. */
const TONE: Record<NoticeCardKind, NoticeTone> = {
  retry: "info",
  error: "danger",
  warning: "warning",
  success: "success",
  info: "info",
  neutral: "neutral",
};

export type NoticeCardProps = Omit<
  ComponentPropsWithoutRef<"section">,
  "title" | "role" | "children"
> & {
  kind?: NoticeCardKind;
  /** Replaces the kind glyph; `null` drops it. */
  icon?: ReactNode | null;
  /** The short, strong line. */
  title: ReactNode;
  /** The quieter line under the title. */
  detail?: ReactNode;
  /** Controls under the detail (a Details trigger, a menu, links). */
  extra?: ReactNode;
  /** Right-hand actions; they wrap under the text in a narrow pane. */
  actions?: ReactNode;
  /** More body under the detail and `extra` (decision buttons, a sub-error). */
  children?: ReactNode;
  /** Shows the dismiss control. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** A retry is in flight: the glyph becomes a spinner. */
  trying?: boolean;
  /** An opaque ground and the floating shadow, for a notice over scrolling content. */
  elevated?: boolean;
  /** `off` renders no live role, for a notice that is present when its surface opens. */
  live?: "assertive" | "polite" | "off";
};

/**
 * A boxed notice card with a toned glyph column, a strong short title, a quieter detail line,
 * extra controls, right-hand actions (under the text in a narrow container) and an optional
 * dismiss control. The kind sets border, fill and glyph; the copy stays neutral. `retry` is a
 * dashed provisional note, `elevated` gives an opaque floating ground. Error announces
 * assertively, other kinds politely; `live="off"` renders no live role.
 * @group feedback
 * @use A notice with a title, detail and actions inside a pane or transcript (provider retry, turn error, interruption, usage limit, delivery, reminders).
 * @avoid One line of status: InlineMessage. A page-level or modal notice: Alert. A transient message: Toast. An empty list: EmptyState.
 */
export function NoticeCard({
  kind = "neutral",
  icon,
  title,
  detail,
  extra,
  actions,
  children,
  onDismiss,
  dismissLabel,
  trying,
  elevated,
  live,
  className,
  ...props
}: NoticeCardProps) {
  const t = useT();
  const mode = live ?? (kind === "error" ? "assertive" : "polite");
  return (
    <section
      {...props}
      role={mode === "assertive" ? "alert" : mode === "polite" ? "status" : undefined}
      data-notice-kind={kind}
      className={[
        styles.card,
        styles[kind],
        elevated && styles.elevated,
        noticeEnterClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.box} data-dismissible={onDismiss ? "" : undefined}>
        <NoticeGlyph
          tone={TONE[kind]}
          size="box"
          icon={
            icon === null ? null : trying ? (
              <Spinner size="md" />
            ) : (
              (icon ??
              (kind === "retry" ? <RefreshCw className="icon-md" aria-hidden /> : undefined))
            )
          }
        />
        <div className={styles.body}>
          <Text as="strong" size="secondary" tone="neutral" weight="medium" className="block">
            {title}
          </Text>
          {detail ? (
            <Text as="div" size="caption" tone="secondary" className="tabular-nums">
              {detail}
            </Text>
          ) : null}
          {extra ? (
            <Text as="div" size="caption" tone="inherit">
              <div className={styles.extra}>{extra}</div>
            </Text>
          ) : null}
          {children}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
        {onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            className={styles.dismiss}
            label={
              dismissLabel ??
              (typeof title === "string" ? `${t("Dismiss")}: ${title}` : t("Dismiss"))
            }
            onClick={onDismiss}
          >
            <X className="icon-md" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </section>
  );
}
