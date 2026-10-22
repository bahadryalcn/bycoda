import { useId, useState, type ReactNode } from "react";
import { t, useLocale } from "../i18n";
import { Button } from "./Button";
import styles from "./FailureState.module.css";

export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|loading (?:chunk|css chunk) .+ failed|outdated optimize dep/i.test(
    message,
  );
}

/** Shared recovery presentation. Keep imports independent of application surfaces. */
export function FailureState({
  title,
  description,
  error,
  onRetry,
  retryLabel = t("Try again"),
  secondaryAction,
  fullScreen = false,
}: {
  title: string;
  description: string;
  error: unknown;
  onRetry: () => void;
  retryLabel?: string;
  secondaryAction?: ReactNode;
  fullScreen?: boolean;
}) {
  useLocale();
  const detailsId = useId();
  const titleId = useId();
  const [details, setDetails] = useState(false);
  const [copy, setCopy] = useState<"idle" | "pending" | "done" | "failed">("idle");
  const message = (error instanceof Error ? error.message : String(error ?? "")).slice(0, 8000);
  async function copyDetails() {
    setCopy("pending");
    try {
      await navigator.clipboard.writeText(`${title}\n\n${message}`);
      setCopy("done");
    } catch {
      setCopy("failed");
    }
  }
  return (
    <section className={styles.surface} data-fullscreen={fullScreen || undefined}>
      <div className={styles.content} role="alert" aria-labelledby={titleId}>
        <h1 id={titleId} className={styles.title}>
          {title}
        </h1>
        <p className={styles.description}>{description}</p>
        <div className={styles.actions}>
          <Button variant="primary" motion="none" onClick={onRetry}>
            {retryLabel}
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
            <pre tabIndex={0} aria-label={t("Error details")}>
              {message}
            </pre>
            <div className={styles.actions}>
              <Button motion="none" onClick={() => void copyDetails()} loading={copy === "pending"}>
                {copy === "done" ? t("Copied") : t("Copy details")}
              </Button>
              {copy === "failed" && (
                <span role="status">
                  {t("Could not copy. Select the details and copy them manually.")}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
