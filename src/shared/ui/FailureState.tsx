import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocale, useT } from "../i18n";
import { Button } from "./Button";
import styles from "./FailureState.module.css";

export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|loading (?:chunk|css chunk) .+ failed|outdated optimize dep/i.test(
    message,
  );
}

/** The readable preview is bounded; copying always uses the complete diagnostic. */
export const FAILURE_PREVIEW_CHARS = 8000;

/**
 * Alert-role recovery surface for a region or whole screen that failed to load: title, description,
 * Try again (promise-aware, blocks double press), optional secondary action and a Show/Copy details
 * area for the error text (preview capped, copy always complete). `fullScreen` makes the title an h1.
 * @group feedback
 * @use A pane, route or app boot that failed and needs retry plus copyable diagnostics.
 * @avoid Nothing to show, filtered or unreadable list: EmptyState `kind`. One-line message: InlineError. Boxed notice with a title: Alert.
 */
export function FailureState({
  title,
  description,
  error,
  onRetry,
  retrying = false,
  retryLabel,
  secondaryAction,
  fullScreen = false,
}: {
  title: string;
  description: string;
  error: unknown;
  /** Retry stays with the caller. Returning a promise shows progress and blocks a second activation until it settles. */
  onRetry: () => void | Promise<unknown>;
  /** Marks a retry the caller already runs, for example one started elsewhere. */
  retrying?: boolean;
  retryLabel?: string;
  secondaryAction?: ReactNode;
  fullScreen?: boolean;
}) {
  // Subscribed locale reads keep this component compilable; module t()/formatNumber are not reactive.
  const t = useT();
  const locale = useLocale();
  const formatCount = (value: number) => new Intl.NumberFormat(locale).format(value);
  const detailsId = useId();
  const titleId = useId();
  const [details, setDetails] = useState(false);
  const [copy, setCopy] = useState<"idle" | "pending" | "done" | "failed">("idle");
  const [retryPending, setRetryPending] = useState(false);
  const retryGuard = useRef(false);
  const copyGuard = useRef(false);
  const preview = useRef<HTMLPreElement>(null);
  const full = error instanceof Error ? error.message : String(error ?? "");
  const truncated = full.length > FAILURE_PREVIEW_CHARS;
  // After a failed copy the whole text is shown, so a manual selection includes everything.
  const showAll = truncated && copy === "failed";
  const shown = truncated && !showAll ? full.slice(0, FAILURE_PREVIEW_CHARS) : full;
  const retryBusy = retrying || retryPending;
  const Heading = fullScreen ? "h1" : "h2";

  async function copyDetails() {
    if (copyGuard.current) return;
    copyGuard.current = true;
    setCopy("pending");
    try {
      await navigator.clipboard.writeText(`${title}\n\n${full}`);
      setCopy("done");
    } catch {
      setCopy("failed");
    } finally {
      copyGuard.current = false;
    }
  }
  async function retry() {
    if (retryGuard.current || retrying) return;
    retryGuard.current = true;
    let result: void | Promise<unknown>;
    try {
      result = onRetry();
    } catch (cause) {
      retryGuard.current = false;
      throw cause;
    }
    if (!result || typeof result.then !== "function") {
      retryGuard.current = false;
      return;
    }
    setRetryPending(true);
    try {
      await result;
    } catch {
      // The caller owns the operation and reports its own failure.
    } finally {
      retryGuard.current = false;
      setRetryPending(false);
    }
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

  return (
    <section
      className={styles.surface}
      data-fullscreen={fullScreen || undefined}
      aria-labelledby={titleId}
    >
      <div className={styles.content}>
        <div className={styles.message} role="alert">
          <Heading id={titleId} className={styles.title}>
            {title}
          </Heading>
          <p className={styles.description}>{description}</p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            motion="none"
            loading={retryBusy || undefined}
            onClick={() => void retry()}
          >
            {retryLabel ?? t("Try again")}
          </Button>
          {secondaryAction}
          <Button
            variant="ghost"
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
                motion="none"
                onClick={() => void copyDetails()}
                loading={copy === "pending" || undefined}
              >
                {copy === "done" ? t("Copied") : t("Copy details")}
              </Button>
              {/* Always mounted so the polite live region exists before its text changes. */}
              <span role="status" className={styles.copyStatus} data-state={copy}>
                {copy === "failed" ? (
                  t("Could not copy. Select the details and copy them manually.")
                ) : copy === "done" ? (
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
