import { errorText } from "../lib/errors";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocale, useT } from "../i18n";
import {
  EmptyState as ArcEmptyState,
  type EmptyStateProps as ArcEmptyStateProps,
} from "./arc/empty-state/empty-state";
import { InlineError } from "./InlineError";
import { NoticeButton, NoticeGlyph, type NoticeAction } from "./Notice";
import { CircleAlert } from "./icons";
import { Button } from "./Button";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import styles from "./FailureState.module.css";
import { useConnectionErrorShownCentrally } from "./connectionErrorGate";

const moduleLoadFailures = new WeakSet<object>();

/** Preserve the original diagnostic while remembering an actual rejected loader. */
export function markModuleLoadError(error: unknown) {
  const reason =
    (typeof error === "object" && error !== null) || typeof error === "function"
      ? error
      : new Error(String(error));
  moduleLoadFailures.add(reason);
  return reason;
}

export function isModuleLoadError(error: unknown): boolean {
  if (
    ((typeof error === "object" && error !== null) || typeof error === "function") &&
    moduleLoadFailures.has(error)
  )
    return true;
  const message = errorText(error);
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|loading (?:chunk|css chunk) .+ failed|outdated optimize dep/i.test(
    message,
  );
}

/** Waits for a retry the caller owns; its own failure is reported by the caller. */
async function settled(promise: Promise<unknown>) {
  try {
    await promise;
  } catch {
    // The caller owns the operation and reports its own failure.
  }
}

/** The readable preview is bounded; copying always uses the complete diagnostic. */
export const FAILURE_PREVIEW_CHARS = 8000;

/**
 * Alert-role recovery surface for a region or whole screen that failed to load: title, one sentence,
 * Try again (promise-aware, blocks double press), structured `action` / `secondaryAction` and a
 * Show/Copy details area for the error text (preview capped, copy always complete). `fullScreen`
 * makes the title an h1. Inline form is an InlineError with the same structured actions.
 * @group feedback
 * @use Replaces EmptyState kind="unavailable". An unavailable pane, route or app boot. Optional error adds copyable diagnostics; promise-aware retry blocks double activation.
 * @replaces EmptyState
 * @avoid Nothing to show or filtered list: EmptyState. Inline failure: InlineError. One-line message: InlineError. Boxed notice with a title: Alert. Never a Button in `action`.
 * @action Pass `action={{ label, onClick }}` and `onRetry`; the component renders them.
 */
export function FailureState({
  title = "",
  description,
  error,
  onRetry,
  retrying = false,
  retryLabel,
  secondaryAction,
  fullScreen = false,
  brand,
  context = "panel",
  size = "block",
  action,
  extra,
  icon,
  className,
  label,
  descriptionText,
  role,
  ...props
}: Omit<ArcEmptyStateProps, "onRetry" | "action" | "help"> & {
  /** Technical diagnostic; omitted for an unavailable region with only plain copy. */
  error?: unknown;
  /** Inline failures use InlineError; block failures use the shared region layout. */
  size?: "block" | "inline";
  /** Retry stays with the caller. Returning a promise shows progress and blocks a second activation until it settles. */
  onRetry?: () => void | Promise<unknown>;
  /** Marks a retry the caller already runs, for example one started elsewhere. */
  retrying?: boolean;
  /** Omit for the shared "Try again" wording, the same label InlineError uses. */
  retryLabel?: string;
  /** Another recovery step (Open settings), rendered by the component. */
  action?: NoticeAction;
  secondaryAction?: NoticeAction;
  /** Escape for one non-button control beside the actions. */
  extra?: ReactNode;
  fullScreen?: boolean;
  /** Decorative identity shown above the message, outside the alert, for a whole-app failure. */
  brand?: ReactNode;
}) {
  // Subscribed locale reads keep this component compilable; module t()/formatNumber are not reactive.
  const t = useT();
  const locale = useLocale();
  const formatCount = (value: number) => new Intl.NumberFormat(locale).format(value);
  const detailsId = useId();
  const titleId = useId();
  const [details, setDetails] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const retryGuard = useRef(false);
  const preview = useRef<HTMLPreElement>(null);
  const full = errorText(error ?? "");
  const copyFeedback = useCopyFeedback({ resetKeys: [title, full] });
  const copy = copyFeedback.status;
  const truncated = full.length > FAILURE_PREVIEW_CHARS;
  // After a failed copy the whole text is shown, so a manual selection includes everything.
  const showAll = truncated && copy === "failed";
  const shown = truncated && !showAll ? full.slice(0, FAILURE_PREVIEW_CHARS) : full;
  const retryBusy = retrying || retryPending;
  const Heading = fullScreen ? "h1" : "h2";
  const shownCentrally = useConnectionErrorShownCentrally(fullScreen ? undefined : error);

  function copyDetails() {
    copyFeedback.copy(() => navigator.clipboard.writeText(`${title}\n\n${full}`));
  }
  async function retry() {
    if (retryGuard.current || retrying || !onRetry) return;
    retryGuard.current = true;
    let result: void | Promise<unknown>;
    try {
      result = onRetry();
    } catch {
      retryGuard.current = false;
      // The caller reports failed retries, including synchronous failures.
      return;
    }
    if (!result || typeof result.then !== "function") {
      retryGuard.current = false;
      return;
    }
    setRetryPending(true);
    await settled(result);
    retryGuard.current = false;
    setRetryPending(false);
  }
  // Manual fallback: put the complete text in the selection so a native copy works.
  useEffect(() => {
    const node = preview.current;
    if (copy !== "failed" || !node) return;
    node.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [copy]);

  const retryText = retryLabel ?? t("Try again");
  // The central connection notice explains an unreachable machine once, with its own Reconnect.
  if (shownCentrally) return null;
  if (size === "inline") {
    return (
      <InlineError
        {...props}
        aria-label={label ?? props["aria-label"]}
        text={descriptionText}
        className={className}
        live={role === "status" ? "polite" : role ? "off" : undefined}
        icon={icon}
        action={action}
        secondaryAction={secondaryAction}
        extra={extra}
        retry={
          onRetry
            ? { onRetry: () => void retry(), label: retryText, pending: retryBusy }
            : undefined
        }
      >
        {title ? <strong>{title} </strong> : null}
        {description}
      </InlineError>
    );
  }
  if (error === undefined && !fullScreen) {
    return (
      <ArcEmptyState
        {...props}
        label={label}
        descriptionText={descriptionText}
        title={title}
        description={description}
        context={context}
        role={role ?? "alert"}
        data-kind="unavailable"
        icon={icon === undefined ? <CircleAlert aria-hidden /> : icon}
        className={["bycoda-arc", className].filter(Boolean).join(" ")}
        action={
          action || secondaryAction || extra || onRetry ? (
            <>
              {action ? <NoticeButton action={action} /> : null}
              {secondaryAction ? <NoticeButton action={secondaryAction} /> : null}
              {extra}
              {onRetry ? (
                <NoticeButton
                  action={{ label: retryText, onClick: () => void retry(), pending: retryBusy }}
                />
              ) : null}
            </>
          ) : undefined
        }
      />
    );
  }
  return (
    <section
      className={[styles.surface, className].filter(Boolean).join(" ")}
      {...props}
      data-fullscreen={fullScreen || undefined}
      aria-labelledby={titleId}
    >
      <div className={styles.content}>
        {brand}
        <div className={styles.message} role="alert">
          <div className={styles.heading}>
            <NoticeGlyph tone="danger" size="box" />
            <Heading id={titleId} className={styles.title}>
              {title}
            </Heading>
          </div>
          <p className={styles.description}>{description}</p>
        </div>
        <div className={styles.actions}>
          {onRetry ? (
            <Button
              variant="secondary"
              size="sm"
              motion="none"
              loading={retryBusy || undefined}
              onClick={() => void retry()}
            >
              {retryText}
            </Button>
          ) : null}
          {action ? <NoticeButton action={action} /> : null}
          {secondaryAction ? <NoticeButton action={secondaryAction} /> : null}
          {extra}
          <Button
            variant="ghost"
            size="sm"
            motion="none"
            aria-expanded={details}
            aria-controls={detailsId}
            onClick={() => setDetails(!details)}
          >
            {details ? t("Hide details") : t("Show details")}
          </Button>
        </div>
        {details && (
          <div id={detailsId} className={styles.details}>
            <pre ref={preview} tabIndex={0} aria-label={t("Error details")}>
              {shown}
            </pre>
            {truncated && !showAll ? (
              <p className={styles.meta} data-preview-note="">
                {t("Showing the first {p0} of {p1} characters. Copy details includes all of it.", {
                  p0: formatCount(FAILURE_PREVIEW_CHARS),
                  p1: formatCount(full.length),
                })}
              </p>
            ) : null}
            <div className={styles.actions}>
              <Button
                variant="secondary"
                size="sm"
                motion="none"
                onClick={() => void copyDetails()}
                loading={copy === "pending" || undefined}
              >
                {copy === "copied" ? t("Copied") : t("Copy details")}
              </Button>
              {/* Always mounted so the polite live region exists before its text changes. */}
              <span role="status" className={styles.copyStatus} data-state={copy}>
                {copy === "failed" ? (
                  t("Could not copy. Select the details and copy them manually.")
                ) : copy === "copied" ? (
                  <span className="sr-only">{t("Copied")}</span>
                ) : null}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
