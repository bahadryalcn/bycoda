import { useState } from "react";
import { formatNumber, t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import type { useProjectCrews } from "../model/crewClient";
import {
  type CandidateReviewObservation,
  type MemberPerformance as Performance,
  memberPerformance,
} from "../model/memberPerformance";

type Status = "idle" | "loading" | "ready" | "error";

const percent = (fraction: number) =>
  formatNumber(fraction, { style: "percent", maximumFractionDigits: 0 });

/**
 * Review history of one crew member, read from the Host's inspection of its candidates.
 * Loads the first time the section opens, so closed members cost nothing.
 */
export function MemberPerformance({
  state,
  definitionId,
  memberId,
}: {
  state: ReturnType<typeof useProjectCrews>;
  definitionId: string;
  memberId: string;
}) {
  useLocale();
  const [status, setStatus] = useState<Status>("idle");
  const [performance, setPerformance] = useState<Performance>();
  const load = () => {
    setStatus("loading");
    state
      .call<{ candidates?: CandidateReviewObservation[] }>("crews.inspect", {
        definitionId,
        memberId,
      })
      .then(
        (result) => {
          setPerformance(memberPerformance(result.candidates ?? []));
          setStatus("ready");
        },
        () => setStatus("error"),
      );
  };

  return (
    <Disclosure
      size="sm"
      summary={t("Performance")}
      onOpenChange={(open) => {
        if (open && status === "idle") load();
      }}
    >
      {status === "loading" || status === "idle" ? (
        <p className="text-ui-caption text-(--ui-text-secondary)">{t("Loading performance…")}</p>
      ) : status === "error" ? (
        <Alert tone="danger">
          <p>{t("Could not load performance")}</p>
          <Button variant="secondary" onClick={load}>
            {t("Retry")}
          </Button>
        </Alert>
      ) : performance && performance.reviewed > 0 ? (
        <div className="flex min-w-0 flex-col gap-2">
          <ul className="flex flex-col gap-1">
            <li>{t("Reviewed assignments: {p0}", { p0: formatNumber(performance.reviewed) })}</li>
            {performance.firstPassRate !== undefined ? (
              <li>{t("First-pass review: {p0}", { p0: percent(performance.firstPassRate) })}</li>
            ) : null}
            {performance.acceptedRate !== undefined ? (
              <li>{t("Accepted: {p0}", { p0: percent(performance.acceptedRate) })}</li>
            ) : null}
          </ul>
          <p className="text-ui-caption text-(--ui-text-secondary)">{t("By model")}</p>
          <ul className="flex min-w-0 flex-col gap-1">
            {performance.perModel.map((model) => (
              <li
                key={`${model.harness}/${model.model}`}
                className="flex min-w-0 flex-wrap justify-between gap-x-3"
              >
                <span className="min-w-0 break-all">
                  {model.model} <span className="text-(--ui-text-secondary)">{model.harness}</span>
                </span>
                <span className="text-(--ui-text-secondary)">
                  {model.firstPassRate !== undefined
                    ? t("{p0} reviewed · {p1} first-pass", {
                        p0: formatNumber(model.count),
                        p1: percent(model.firstPassRate),
                      })
                    : t("{p0} reviewed", { p0: formatNumber(model.count) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-ui-caption text-(--ui-text-secondary)">{t("No reviewed work yet")}</p>
      )}
    </Disclosure>
  );
}
