import { Text } from "../../../shared/ui/Text";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
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
    <Text as="div" size="micro" tone="secondary" className="mt-1.5 space-y-1">
      {command ? (
        <Disclosure
          defaultOpen={!passed}
          summary={
            <>
              {t("Check command")}{" "}
              <Text size="inherit" tone={passed ? "success" : "danger"}>
                {passed
                  ? t("passed")
                  : command.timedOut
                    ? t("timed out")
                    : command.exitCode === null
                      ? t("could not run")
                      : t("failed (exit code {p0})", { p0: command.exitCode })}
              </Text>
            </>
          }
        >
          <OutputBlock frame="card" scroll className="mt-1 max-h-40 break-words">
            {command.output.trim() || t("No output.")}
          </OutputBlock>
        </Disclosure>
      ) : null}
      {review ? (
        <p className="break-words">
          {t("Reviewer")}{" "}
          <Text size="inherit" tone={review.verdict === "pass" ? "success" : "danger"}>
            {review.verdict === "pass" ? t("passed") : t("failed")}
          </Text>
          {review.note ? ` · ${review.note}` : null}
        </p>
      ) : null}
    </Text>
  );
}
