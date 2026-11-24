import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { RefreshCw, X } from "../../../shared/ui/icons";
import { NoticeGlyph, noticeEnterClass, type NoticeTone } from "../../../shared/ui/Notice";
import { Spinner } from "../../../shared/ui/Spinner";
import { Text } from "../../../shared/ui/Text";
import styles from "./TranscriptNotice.module.css";

/**
 * `retry` is dashed and transparent, `error` carries a danger tint, `warning` a warning tint (usage
 * limit, unconfirmed delivery), `success` and `info` their own, `neutral` is a settled outcome.
 */
export type TranscriptNoticeKind = "retry" | "error" | "warning" | "success" | "info" | "neutral";

/** The shared glyph tone of each kind; a retry reads as information. */
const TONE: Record<TranscriptNoticeKind, NoticeTone> = {
  retry: "info",
  error: "danger",
  warning: "warning",
  success: "success",
  info: "info",
  neutral: "neutral",
};

export type TranscriptNoticeProps = Omit<
  ComponentPropsWithoutRef<"section">,
  "title" | "role" | "children"
> & {
  kind?: TranscriptNoticeKind;
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

/** An action of the notice: the shared small secondary button, `quiet` for the second choice. */
export { NoticeButton as NoticeActionButton } from "../../../shared/ui/Notice";

/**
 * The one anatomy for every notice in and around the transcript: provider retry, turn error,
 * interruption, usage limit, delivery, file revert, reminders, remote activity. The kind sets
 * border, fill and glyph; the copy stays neutral. Error announces assertively, other kinds politely.
 */
export function TranscriptNotice({
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
}: TranscriptNoticeProps) {
  const t = useT();
  const mode = live ?? (kind === "error" ? "assertive" : "polite");
  return (
    <section
      {...props}
      role={mode === "assertive" ? "alert" : mode === "polite" ? "status" : undefined}
      data-notice-kind={kind}
      className={[
        styles.notice,
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
