import "./task-board.css";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { t, useLocale } from "../../../shared/i18n";
import type { TaskVerification } from "../model/hostTasks";

/** What the host checked before review: the check command's result, with its
 * output on demand, and the reviewer's verdict. */
export function VerificationSummary({ verification }: { verification: TaskVerification }) {
  useLocale();
  const { command, review } = verification;
  if (!command && !review) return null;
  const passed = command && !command.timedOut && command.exitCode === 0;
  return (
    <div className="mt-1.5 space-y-1 text-ui-micro text-(--ui-text-secondary)">
      {command ? (
        <Disclosure
          defaultOpen={!passed}
          summary={
            <>
              {t("Check command")}{" "}
              <span
                className={passed ? "text-(--ui-tone-success-fg)" : "text-(--ui-tone-danger-fg)"}
              >
                {passed
                  ? t("passed")
                  : command.timedOut
                    ? t("timed out")
                    : command.exitCode === null
                      ? t("could not run")
                      : t("failed (exit code {p0})", { p0: command.exitCode })}
              </span>
            </>
          }
        >
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-(--ui-radius-card) border border-(--ui-card-border) px-2 py-1 font-mono text-ui-caption text-(--ui-text-secondary)">
            {command.output.trim() || t("No output.")}
          </pre>
        </Disclosure>
      ) : null}
      {review ? (
        <p className="break-words">
          {t("Reviewer")}{" "}
          <span
            className={
              review.verdict === "pass"
                ? "text-(--ui-tone-success-fg)"
                : "text-(--ui-tone-danger-fg)"
            }
          >
            {review.verdict === "pass" ? t("passed") : t("failed")}
          </span>
          {review.note ? ` · ${review.note}` : null}
        </p>
      ) : null}
    </div>
  );
}
