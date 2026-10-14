import { t, useLocale } from "../../../shared/i18n/git";
import { Loader } from "../../../shared/ui/icons";

export function GitLoading({ text }: { text: string }) {
  useLocale();
  return (
    <p role="status" className="flex items-center gap-2 px-3 py-2 text-[12px] text-content/55">
      <Loader aria-hidden className="size-3.5 shrink-0 animate-spin" />
      {text}
    </p>
  );
}

export function GitFeedback({
  kind = "error",
  title,
  detail,
  stale,
  onRetry,
  onDismiss,
}: {
  kind?: "error" | "warning" | "success" | "info";
  title: string;
  detail?: string;
  stale?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  useLocale();
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="mx-2 my-1.5 shrink-0 rounded-md border border-stroke bg-content/5 px-2.5 py-2 text-[12px]"
    >
      <p
        className={
          kind === "error"
            ? "text-danger"
            : kind === "warning"
              ? "text-warning"
              : "text-content/80"
        }
      >
        {title}
      </p>
      {stale ? <p className="mt-1 text-content/55">{t("Showing what was last loaded.")}</p> : null}
      {detail ? (
        <details className="mt-1 text-content/60">
          <summary className="cursor-pointer">{t("Details")}</summary>
          <p className="mt-1 break-words whitespace-pre-wrap">{detail}</p>
        </details>
      ) : null}
      {onRetry || onDismiss ? (
        <div className="mt-1.5 flex gap-2">
          {onRetry ? (
            <button
              type="button"
              className="rounded bg-content/10 px-2 py-0.5 hover:bg-content/15"
              onClick={onRetry}
            >
              {t("Retry")}
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              className="rounded px-2 py-0.5 text-content/60 hover:bg-content/10"
              onClick={onDismiss}
            >
              {t("Dismiss")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
