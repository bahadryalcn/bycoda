import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Button } from "../../../shared/ui/Button";
import type { HostTask } from "../model/hostTasks";
import { readTaskAcceptanceReport } from "../model/taskAcceptance";
import { readTaskInstructions } from "../model/taskInstructions";

type Props = {
  task: Pick<HostTask, "prompt" | "verification">;
  onOpenReview: (sessionId: string) => void;
  isOpeningSession?: (sessionId: string) => boolean;
};

/** Reviewer evidence is a recorded result, never a live check of the working copy. */
export function TaskAcceptanceEvidence({ task, onOpenReview, isOpeningSession }: Props) {
  useLocale();
  const expected = readTaskInstructions(task.prompt)?.acceptance ?? [];
  if (!expected.length) return null;
  const report = readTaskAcceptanceReport(task.verification?.acceptance);
  const matches =
    report?.criteria.length === expected.length &&
    report.criteria.every(
      (row, index) => row.criterionIndex === index && row.criterion === expected[index],
    );
  const rows = expected.map((criterion, index) => {
    const record = matches ? report?.criteria[index] : undefined;
    // A legacy PASS or a report for earlier instructions cannot verify a criterion.
    const verdict =
      record?.verdict === "verified" && !record.evidence.some((item) => item.trim())
        ? "unresolved"
        : (record?.verdict ?? "unresolved");
    return { criterion, record, verdict };
  });
  const verified = rows.filter((row) => row.verdict === "verified").length;
  const failed = rows.filter((row) => row.verdict === "failed").length;
  const unresolved = rows.length - verified - failed;
  return (
    <div className="min-w-0 space-y-2">
      <Disclosure
        className="min-w-0"
        variant="row"
        summary={
          <>
            <span className="font-medium">
              {t("Acceptance evidence · {p0}/{p1} verified", {
                p0: verified,
                p1: rows.length,
              })}
            </span>
            {failed ? (
              <span className="ml-2 text-(--ui-tone-danger-fg)">
                {t("{p0} failed", { p0: failed })}
              </span>
            ) : null}
            {unresolved ? (
              <span className="ml-2 text-(--ui-tone-warning-fg)">
                {t("{p0} unresolved", { p0: unresolved })}
              </span>
            ) : null}
          </>
        }
      >
        {report && matches ? (
          <div className="flex flex-wrap items-center justify-between gap-1 text-ui-micro text-(--ui-text-secondary)">
            <Timestamp
              value={report.checkedAt}
              format="datetime-seconds"
              prefix={t("Reviewed")}
              tooltip={false}
            />
            {report.sessionId ? (
              <Button
                variant="ghost"
                loading={isOpeningSession?.(report.sessionId)}
                onClick={() => onOpenReview(report.sessionId)}
              >
                {t("Open review session")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <p className="text-ui-micro text-(--ui-text-secondary)">
          {report && !matches
            ? t(
                "The recorded evidence does not match the current acceptance criteria. Recheck the task.",
              )
            : report
              ? t("Recorded reviewer evidence. Files may have changed since this review.")
              : t(
                  "No criterion evidence recorded. A passing review alone does not verify these criteria.",
                )}
        </p>
        <ol className="space-y-3 text-ui-caption">
          {rows.map(({ criterion, record, verdict }, index) => (
            <li key={index} className="min-w-0 space-y-1" data-acceptance-verdict={verdict}>
              <div className="flex min-w-0 flex-wrap items-start gap-2">
                <Badge
                  tone={
                    verdict === "verified" ? "success" : verdict === "failed" ? "danger" : "warning"
                  }
                >
                  {verdict === "verified"
                    ? t("Verified")
                    : verdict === "failed"
                      ? t("Failed")
                      : record
                        ? t("Unresolved")
                        : t("Not verified")}
                </Badge>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-(--ui-tone-neutral-fg)">
                  {criterion}
                </span>
              </div>
              {record?.note ? (
                <p className="whitespace-pre-wrap break-words text-(--ui-text-secondary)">
                  {record.note}
                </p>
              ) : null}
              {record?.evidence.length ? (
                <ul className="space-y-1 text-ui-micro text-(--ui-text-secondary)">
                  {record.evidence.map((evidence, evidenceIndex) => (
                    <li key={evidenceIndex} className="whitespace-pre-wrap break-all">
                      {evidence}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </Disclosure>
      {report && matches && !report.workspaceFingerprint ? (
        <p role="status" className="text-ui-micro text-(--ui-tone-warning-fg)">
          {t(
            "File freshness could not be checked. Recheck changed outputs before relying on this evidence.",
          )}
        </p>
      ) : null}
    </div>
  );
}
