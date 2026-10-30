import { useEffect, useRef } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { ComposerActions } from "./socialShared";
import type { FactCandidate, FactSuggestResult } from "../model/socialSuggestions";

export const FACT_TOPIC_MAX = 200;
export const FACT_TEXT_MAX = 4000;
/** The profile holds at most this many verified facts; accepted candidates count against it. */
export const FACT_LIMIT = 100;

/**
 * One answer of `facts.suggest` plus the owner's review state. The review lives in the product
 * knowledge component so unaccepted candidates survive closing the dialog; accepting only adds a
 * row to the editor draft, nothing here writes to the Host.
 */
export type FactReview = {
  result: FactSuggestResult;
  /** Owner edits by candidate id; the supporting quote is never editable. */
  edits: Record<string, { topic?: string; text?: string }>;
  /** Rejected (or already saved) candidates; they disappear for this result only. */
  hidden: string[];
  /** Candidates added to the editor draft and waiting for the owner's save. */
  accepted: string[];
};

export const candidateTopic = (review: FactReview, candidate: FactCandidate) =>
  review.edits[candidate.id]?.topic ?? candidate.topic;
export const candidateText = (review: FactReview, candidate: FactCandidate) =>
  review.edits[candidate.id]?.text ?? candidate.text;

/** Why a candidate cannot be accepted right now; empty when it can. */
export function candidateBlock(
  review: FactReview,
  candidate: FactCandidate,
  slotsLeft: number,
  duplicateTopic?: (factId: string) => string,
) {
  if (candidate.duplicateOfFactId)
    return t("Already a verified fact: {p0}", {
      p0: duplicateTopic?.(candidate.duplicateOfFactId) ?? candidate.duplicateOfFactId,
    });
  const topic = candidateTopic(review, candidate).trim();
  const text = candidateText(review, candidate).trim();
  if (!topic || !text) return t("Fill in the topic and the fact text first.");
  if (topic.length > FACT_TOPIC_MAX || text.length > FACT_TEXT_MAX)
    return t("The topic or the fact text is too long.");
  if (slotsLeft <= 0) return t("This project already has the most facts it can hold.");
  return "";
}

/** Candidates still listed for the owner (not rejected, not already saved). */
export const visibleCandidates = (review: FactReview) =>
  review.result.suggestions.filter((candidate) => !review.hidden.includes(candidate.id));

/** Candidates "Accept all valid" would add, capped by the room left in the profile. */
export function acceptableCandidates(
  review: FactReview,
  slotsLeft: number,
  duplicateTopic?: (factId: string) => string,
) {
  return visibleCandidates(review)
    .filter(
      (candidate) =>
        !review.accepted.includes(candidate.id) &&
        !candidateBlock(review, candidate, slotsLeft, duplicateTopic),
    )
    .slice(0, Math.max(0, slotsLeft));
}

/**
 * Review list for `facts.suggest`. It is deliberately separate from the verified facts list:
 * its own surface, its own heading and no shared counts. Candidates are editable, show the
 * supporting quote read-only, and can be accepted into the draft or rejected.
 */
export function FactSuggestions({
  review,
  projectName,
  accountName,
  locked,
  slotsLeft,
  duplicateTopic,
  onEdit,
  onAccept,
  onAcceptAll,
  onReject,
  onRejectAll,
}: {
  review: FactReview;
  projectName: string;
  accountName: string;
  locked: boolean;
  /** Room left for facts in the profile: saved facts and accepted rows already count. */
  slotsLeft: number;
  duplicateTopic?: (factId: string) => string;
  onEdit: (id: string, change: { topic?: string; text?: string }) => void;
  onAccept: (ids: string[]) => void;
  onAcceptAll: (ids: string[]) => void;
  onReject: (id: string) => void;
  onRejectAll: () => void;
}) {
  useLocale();
  const { result } = review;
  const section = useRef<HTMLElement>(null);
  // A new answer lands below the ask form: bring it into view, its actions are in the dialog footer.
  useEffect(() => {
    section.current?.scrollIntoView?.({ block: "nearest" });
  }, [result]);
  const shown = visibleCandidates(review);
  const open = shown.filter((candidate) => !review.accepted.includes(candidate.id));
  const acceptable = acceptableCandidates(review, slotsLeft, duplicateTopic);
  const agent = `${result.agent.provider}${result.agent.model ? ` · ${result.agent.model}` : ""}`;
  const label = result.sourceLabel;
  return (
    <section
      ref={section}
      className="social-fact-suggestions"
      aria-label={t("Suggestions - not verified yet")}
      data-testid="fact-suggestions"
    >
      <header className="social-fact-suggestions-header">
        <h3>{t("Suggestions - not verified yet")}</h3>
        <p>
          <strong>
            {shown.length === 1
              ? t("1 suggestion from “{p0}”", { p0: label })
              : t("{p0} suggestions from “{p1}”", { p0: shown.length, p1: label })}
          </strong>
        </p>
        <p className="social-fact-suggestions-meta">
          {t("Project")}: {projectName} · {t("Account")}: {accountName} · {t("Agent")}: {agent}
        </p>
        {result.skipped > 0 ? (
          <p className="social-fact-suggestions-meta" data-testid="fact-skipped">
            {result.skipped === 1
              ? t("1 statement was dropped because the text does not support it.")
              : t("{p0} statements were dropped because the text does not support them.", {
                  p0: result.skipped,
                })}
          </p>
        ) : null}
        <p className="social-fact-suggestions-meta">
          {t("Accepting only adds a fact to your draft. It becomes verified when you save it.")}
        </p>
      </header>
      {!result.suggestions.length ? (
        <p className="social-muted" role="status">
          {t("The text did not support any fact.")}
        </p>
      ) : !shown.length ? (
        <p className="social-muted" role="status">
          {t("No suggestions left to review.")}
        </p>
      ) : (
        <>
          <ComposerActions className="social-fact-suggestions-actions">
            {open.length && !acceptable.length ? (
              <small className="social-muted">{t("No suggestion can be accepted yet.")}</small>
            ) : null}
            <Button type="button" variant="ghost" disabled={locked} onClick={onRejectAll}>
              {t("Reject all")}
            </Button>
            <Button
              type="button"
              disabled={locked || !acceptable.length}
              onClick={() => onAcceptAll(acceptable.map((candidate) => candidate.id))}
            >
              {t("Accept all valid")}
            </Button>
          </ComposerActions>
          <ul className="social-fact-suggestions-list">
            {shown.map((candidate, index) => {
              const topic = candidateTopic(review, candidate);
              const text = candidateText(review, candidate);
              if (review.accepted.includes(candidate.id))
                return (
                  <li
                    key={candidate.id}
                    aria-label={topic || `${t("Suggestion")} ${index + 1}`}
                    data-state="added"
                  >
                    <div className="social-fact-suggestions-head">
                      <strong>{topic}</strong>
                      <Badge tone="success" appearance="subtle">
                        {t("Added - save to verify")}
                      </Badge>
                    </div>
                  </li>
                );
              const block = candidateBlock(review, candidate, slotsLeft, duplicateTopic);
              return (
                <li
                  key={candidate.id}
                  aria-label={topic || `${t("Suggestion")} ${index + 1}`}
                  data-state={candidate.duplicateOfFactId ? "duplicate" : "open"}
                >
                  <div className="social-fact-suggestions-head">
                    <Badge tone="info" appearance="subtle">
                      {t("Suggestion")}
                    </Badge>
                    {candidate.duplicateOfFactId ? (
                      <Badge tone="warning" appearance="subtle">
                        {t("Duplicate")}
                      </Badge>
                    ) : null}
                  </div>
                  <TextField
                    label={t("Topic")}
                    fieldVariant="compact"
                    disabled={locked}
                    maxLength={FACT_TOPIC_MAX}
                    value={topic}
                    onChange={(event) => onEdit(candidate.id, { topic: event.target.value })}
                  />
                  <TextareaField
                    label={t("Fact text")}
                    fieldVariant="compact"
                    disabled={locked}
                    maxLength={FACT_TEXT_MAX}
                    value={text}
                    onChange={(event) => onEdit(candidate.id, { text: event.target.value })}
                  />
                  <figure className="social-fact-suggestions-quote">
                    <figcaption>{t("Supporting quote from the source")}</figcaption>
                    <blockquote>{candidate.quote}</blockquote>
                  </figure>
                  {block ? (
                    <p className="social-fact-suggestions-reason" role="status">
                      {block}
                    </p>
                  ) : null}
                  <div className="social-fact-suggestions-actions">
                    <Button
                      size="sm"
                      type="button"
                      variant="secondary"
                      disabled={locked || !!block}
                      onClick={() => onAccept([candidate.id])}
                    >
                      {t("Accept")}
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      disabled={locked}
                      onClick={() => onReject(candidate.id)}
                    >
                      {t("Reject")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
