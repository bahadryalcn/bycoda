import { LoadingText } from "../../../shared/ui/LoadingText";
import { InlineError } from "../../../shared/ui/InlineError";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Heading } from "../../../shared/ui/Heading";
import { Text } from "../../../shared/ui/Text";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { useState } from "react";
import { formatNumber, t } from "../../../shared/i18n";
import { describeRemoteError, type RemoteErrorView } from "../../connections/public/remoteFailure";
import type { useProjectCrews } from "../model/crewClient";
import { memberPerformance, type CandidateReviewObservation } from "../model/memberPerformance";

type Candidate = CandidateReviewObservation & { imageGeneration?: boolean };
type Status = "idle" | "loading" | "ready" | "error";

const percent = (fraction: number) =>
  formatNumber(fraction, { style: "percent", maximumFractionDigits: 0 });

/**
 * One member's reviews: review history and what each candidate model can do, both read from one
 * Host inspection. `onOpen` loads it the first time the member's More options open, so closed
 * members cost nothing; `section` is the content for that disclosure.
 */
export function useMemberReviews(
  state: ReturnType<typeof useProjectCrews>,
  definitionId: string | undefined,
  memberId: string,
) {
  const [status, setStatus] = useState<Status>("idle");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [failure, setFailure] = useState<RemoteErrorView>({ message: "", details: "" });
  const load = () => {
    if (!definitionId) return;
    setStatus("loading");
    state.call<{ candidates?: Candidate[] }>("crews.inspect", { definitionId, memberId }).then(
      (result) => {
        setCandidates(result.candidates ?? []);
        setStatus("ready");
      },
      (reason: unknown) => {
        setFailure(describeRemoteError(reason));
        setStatus("error");
      },
    );
  };
  return {
    onOpen: () => {
      if (status === "idle") load();
    },
    section: definitionId ? (
      <MemberReviews status={status} candidates={candidates} failure={failure} onRetry={load} />
    ) : undefined,
  };
}

function imageGenerationLabel(value: boolean | undefined) {
  return value === true ? t("Available") : value === false ? t("Unavailable") : t("Unknown");
}

function MemberReviews({
  status,
  candidates,
  failure,
  onRetry,
}: {
  status: Status;
  candidates: Candidate[];
  failure: RemoteErrorView;
  onRetry: () => void;
}) {
  const { message: summary, details } = failure;
  const performance = memberPerformance(candidates);
  const byModel = new Map(performance.perModel.map((m) => [`${m.harness}/${m.model}`, m]));
  return (
    <section aria-label={t("Reviews")} className="flex min-w-0 flex-col gap-2">
      <Heading size="item" level={4}>
        {t("Reviews")}
      </Heading>
      {status === "idle" || status === "loading" ? (
        <LoadingText delay={false}>{t("Loading reviews…")}</LoadingText>
      ) : status === "error" ? (
        // The presented reason is the visible text; the raw Host message sits behind Details.
        <InlineError details={details} retry={{ onRetry }}>
          {summary}
        </InlineError>
      ) : candidates.length === 0 ? (
        <EmptyState size="inline" kind="empty" description={t("No reviewed work yet")} />
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          {performance.reviewed > 0 ? (
            <ul className="flex flex-col gap-1">
              <li>{t("Reviewed assignments: {p0}", { p0: formatNumber(performance.reviewed) })}</li>
              {performance.firstPassRate !== undefined ? (
                <li>{t("First-pass review: {p0}", { p0: percent(performance.firstPassRate) })}</li>
              ) : null}
              {performance.acceptedRate !== undefined ? (
                <li>{t("Accepted: {p0}", { p0: percent(performance.acceptedRate) })}</li>
              ) : null}
            </ul>
          ) : (
            <Text as="p">{t("No reviewed work yet")}</Text>
          )}
          <ul className="flex min-w-0 flex-col gap-1">
            {candidates.map((candidate) => {
              const model = byModel.get(`${candidate.harness}/${candidate.model}`);
              return (
                <li
                  key={`${candidate.harness}/${candidate.model}`}
                  className="flex min-w-0 flex-wrap justify-between gap-x-3"
                >
                  <span className="min-w-0 break-all">
                    <ModelLabel model={candidate.model} harness={candidate.harness} />
                  </span>
                  <Text size="inherit">
                    {t("Image generation")}: {imageGenerationLabel(candidate.imageGeneration)}
                    {model
                      ? ` · ${
                          model.firstPassRate !== undefined
                            ? t("{p0} reviewed · {p1} first-pass", {
                                p0: formatNumber(model.count),
                                p1: percent(model.firstPassRate),
                              })
                            : t("{p0} reviewed", { p0: formatNumber(model.count) })
                        }`
                      : ""}
                  </Text>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
