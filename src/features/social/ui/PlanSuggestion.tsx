import { useContext, useId, useRef, useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Sparkles } from "../../../shared/ui/icons";
import type { SocialAccount, SocialAgent, SocialCampaign, SocialPolicy } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { proposalRequestId } from "../model/socialAssistant";
import { socialQueryScope } from "../model/socialQuery";
import type { PlanSuggestInput, PlanSuggestion } from "../model/socialSuggestions";
import {
  PLAN_SUGGEST_INSTRUCTIONS_MAX,
  movePoolEntry,
  planSuggestBlockedReason,
  publishingSchedule,
  publishingScheduleSummary,
  scheduleFields,
  type PlanAgentState,
  type PublishingScheduleFields,
} from "../model/publishingPlanForm";
import { SocialBusyContext } from "./socialContext";
import { SocialMultiSelect } from "./SocialMultiSelect";
import { ComposerActions, Notice, StatusBadge, names } from "./socialShared";
import "./social-assistant.css";
import "./social-plans.css";

/** The values the plan dialog holds while a plan is being prepared (never saved from here). */
export type PlanDraftValues = {
  name: string;
  accountId: string;
  projectId: string;
  campaignIds: string[];
  schedule: PublishingScheduleFields;
};

export function agentLabel(agent?: SocialAgent) {
  return agent ? `${agent.provider}${agent.model ? ` · ${agent.model}` : ""}` : "";
}

/**
 * The text agent the Host will use is the account's effective policy agent. The read starts only
 * when `enabled`, so an idle plans view does not ask the Host anything.
 */
export function usePlanTextAgent(client: SocialClient, accountId: string, enabled: boolean) {
  const policy = useQuery({
    queryKey: [...socialQueryScope(client), "plan-policy", accountId],
    queryFn: () => client.request<{ effective?: SocialPolicy }>("policy.get", { accountId }),
    enabled: enabled && !!accountId,
    staleTime: 30_000,
  });
  const agent = policy.data?.effective?.agent;
  const state: PlanAgentState = policy.isSuccess
    ? agent
      ? "ready"
      : "missing"
    : policy.isError
      ? "unknown"
      : "checking";
  return { agent, state };
}

const presets: { label: () => string; change: Partial<PublishingScheduleFields> }[] = [
  {
    label: () => t("09:00–18:00 · every 2–5 hours"),
    change: { startTime: "09:00", endTime: "18:00", minHours: "2", maxHours: "5" },
  },
  {
    label: () => t("09:00–22:00 · every 3 hours"),
    change: { startTime: "09:00", endTime: "22:00", minHours: "3", maxHours: "3" },
  },
  { label: () => t("All day"), change: { startTime: "00:00", endTime: "00:00" } },
];

/** The schedule inputs shared by the plan dialog and the AI suggestion review. */
export function PlanScheduleFields({
  value,
  onChange,
  disabled = false,
}: {
  value: PublishingScheduleFields;
  onChange: (change: Partial<PublishingScheduleFields>) => void;
  disabled?: boolean;
}) {
  const zones = useId();
  return (
    <>
      <div className="social-actions" aria-label={t("Schedule presets")}>
        {presets.map((preset) => (
          <Button
            key={preset.change.maxHours ?? "all-day"}
            disabled={disabled}
            variant="secondary"
            type="button"
            onClick={() => onChange(preset.change)}
          >
            {preset.label()}
          </Button>
        ))}
      </div>
      <div className="social-form-grid">
        <TextField
          disabled={disabled}
          label={t("Start time")}
          type="time"
          value={value.startTime}
          onChange={(event) => onChange({ startTime: event.target.value })}
          required
        />
        <TextField
          disabled={disabled}
          label={t("End time")}
          type="time"
          value={value.endTime}
          onChange={(event) => onChange({ endTime: event.target.value })}
          required
        />
        <TextField
          disabled={disabled}
          label={t("Shortest interval · hours")}
          type="number"
          step="any"
          min="0"
          max="168"
          value={value.minHours}
          onChange={(event) => onChange({ minHours: event.target.value })}
          required
        />
        <TextField
          disabled={disabled}
          label={t("Longest interval · hours")}
          type="number"
          step="any"
          min="0"
          max="168"
          value={value.maxHours}
          onChange={(event) => onChange({ maxHours: event.target.value })}
          required
        />
      </div>
      <div>
        <TextField
          disabled={disabled}
          label={t("Time zone")}
          value={value.timeZone}
          onChange={(event) => onChange({ timeZone: event.target.value })}
          placeholder="Europe/Istanbul"
          required
          list={zones}
        />
        <datalist id={zones}>
          <option value="Europe/Istanbul" />
          <option value="Europe/London" />
          <option value="Europe/Berlin" />
          <option value="America/New_York" />
          <option value="UTC" />
        </datalist>
      </div>
    </>
  );
}

type Review = {
  suggestion: PlanSuggestion;
  name: string;
  campaignIds: string[];
  schedule: PublishingScheduleFields;
};
type Attempt = { id: string; input: PlanSuggestInput };
type Phase = "ask" | "working" | "review";

/**
 * Review screen for the Host's `plans.suggest`. The answer is a proposal only: it stores nothing,
 * and accepting it just fills the plan dialog as an unsaved draft. Saving paused stays the owner's
 * explicit action in the dialog, and nothing here activates anything.
 */
export function PlanSuggestionPanel({
  client,
  account,
  projectId,
  projectName,
  eligible,
  hostOnline,
  agent,
  agentState,
  replacesDraft,
  onAccept,
  onClose,
  onOpenContent,
  onOpenSettings,
}: {
  client: SocialClient;
  account?: SocialAccount;
  projectId: string;
  projectName: string;
  /** Active campaigns with a variant for this account and project: the pool the AI may use. */
  eligible: SocialCampaign[];
  hostOnline: boolean;
  agent?: SocialAgent;
  agentState: PlanAgentState;
  /** The dialog already holds an unfinished plan that accepting would replace. */
  replacesDraft: boolean;
  onAccept: (draft: PlanDraftValues) => void;
  onClose: () => void;
  /** Leaving for another screen: the owner closes the dialog first (the click event identifies it). */
  onOpenContent?: (projectId: string | undefined, event: MouseEvent<HTMLElement>) => void;
  onOpenSettings?: (event: MouseEvent<HTMLElement>) => void;
}) {
  useLocale();
  const formId = useId();
  const locked = useContext(SocialBusyContext);
  const [phase, setPhase] = useState<Phase>("ask");
  const [instructions, setInstructions] = useState("");
  const [narrow, setNarrow] = useState<string[]>([]);
  const [attempt, setAttempt] = useState<Attempt>();
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review>();
  const token = useRef(0);
  const narrowed = narrow.filter((id) => eligible.some((campaign) => campaign.id === id));
  const blocked = planSuggestBlockedReason({
    hostOnline,
    accountFound: !!account,
    projectId,
    publishGranted: !!account?.grants[projectId]?.includes("publish"),
    agent: agentState,
    eligibleCount: eligible.length,
    narrowedCount: narrowed.length,
  });
  const working = phase === "working";
  const canAsk = !blocked && !working && !locked && instructions.length <= PLAN_SUGGEST_INSTRUCTIONS_MAX;

  const send = async (next: Attempt) => {
    const current = ++token.current;
    setAttempt(next);
    setPhase("working");
    setError("");
    try {
      // One id per ask: a retry after an error reuses it and gets the first receipt, not a second model call.
      const result = await client.request<PlanSuggestion>("plans.suggest", next.input, next.id);
      if (current !== token.current) return;
      if (!result || !Array.isArray(result.campaignIds) || !result.schedule)
        throw new Error(t("The AI answer was incomplete. Try again."));
      setReview({
        suggestion: result,
        name: result.name,
        campaignIds: [...result.campaignIds],
        schedule: scheduleFields(result.schedule),
      });
      setPhase("review");
    } catch (cause) {
      if (current !== token.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("ask");
    }
  };
  const ask = () => {
    if (!account) return;
    const text = instructions.trim();
    void send({
      id: proposalRequestId(),
      input: {
        accountId: account.id,
        projectId,
        ...(narrowed.length ? { campaignIds: narrowed } : {}),
        ...(text ? { instructions: text } : {}),
      },
    });
  };
  // Stops waiting. The suggestion is never stored, so a late answer is ignored.
  const stop = () => {
    token.current++;
    setPhase("ask");
    setError("");
  };
  const discard = () => {
    token.current++;
    setReview(undefined);
    setPhase("ask");
  };
  const edit = (change: Partial<Omit<Review, "suggestion">>) =>
    setReview((current) => (current ? { ...current, ...change } : current));

  if (phase === "review" && review) {
    const { suggestion } = review;
    const parsed = publishingSchedule(review.schedule);
    const unapproved = new Set(suggestion.unapprovedCampaignIds);
    const known = (id: string) => eligible.find((campaign) => campaign.id === id);
    const missing = review.campaignIds.some((id) => !known(id));
    const accountName = account?.name ?? t("Removed account");
    const reason = !review.name.trim()
      ? t("Enter a plan name.")
      : !review.campaignIds.length
        ? t("Keep at least one campaign in the pool.")
        : missing
          ? t("Remove campaigns that are no longer available.")
          : (parsed.error ?? "");
    const unapprovedCount = review.campaignIds.filter((id) => unapproved.has(id)).length;
    return (
      <div className="social-plan-suggest" role="group" aria-label={t("AI plan suggestion")}>
        <h3>{t("Suggested paused plan")}</h3>
        <dl className="social-assistant-facts">
          <div>
            <dt>{t("Account")}</dt>
            <dd>{account ? `${accountName} · ${names[account.platform]}` : accountName}</dd>
          </div>
          <div>
            <dt>{t("Project")}</dt>
            <dd>{projectName}</dd>
          </div>
          <div>
            <dt>{t("Text model")}</dt>
            <dd>{agentLabel(suggestion.agent) || t("Not set")}</dd>
          </div>
          <div>
            <dt>{t("Content pool")}</dt>
            <dd>{t("{p0} campaigns", { p0: review.campaignIds.length })}</dd>
          </div>
        </dl>
        <TextField
          label={t("Plan name")}
          value={review.name}
          maxLength={200}
          disabled={locked}
          onChange={(event) => edit({ name: event.target.value })}
        />
        <ol className="social-plan-pool" aria-label={t("Sharing order")}>
          {review.campaignIds.map((id, index) => (
            <li key={id}>
              <span className="social-plan-pool-name">
                {index + 1}. {known(id)?.name ?? t("Campaign not found")}
              </span>
              {unapproved.has(id) ? (
                <StatusBadge status="review" label={t("Approval needed")} />
              ) : (
                <StatusBadge status="approved" label={t("Approved")} />
              )}
              <div className="social-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={locked || index === 0}
                  aria-label={t("Move campaign {p0} up", { p0: index + 1 })}
                  onClick={() => edit({ campaignIds: movePoolEntry(review.campaignIds, index, -1) })}
                >
                  {t("Up")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={locked || index === review.campaignIds.length - 1}
                  aria-label={t("Move campaign {p0} down", { p0: index + 1 })}
                  onClick={() => edit({ campaignIds: movePoolEntry(review.campaignIds, index, 1) })}
                >
                  {t("Down")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={locked}
                  aria-label={t("Remove campaign {p0}", { p0: index + 1 })}
                  onClick={() =>
                    edit({ campaignIds: review.campaignIds.filter((item) => item !== id) })
                  }
                >
                  {t("Remove")}
                </Button>
              </div>
            </li>
          ))}
        </ol>
        {unapprovedCount ? (
          <Notice kind="warning">
            {t(
              "{p0} of {p1} campaigns are not approved for publishing. Approve them in Campaigns before enabling the plan.",
              { p0: unapprovedCount, p1: review.campaignIds.length },
            )}{" "}
            {onOpenContent ? (
              <Button variant="link" type="button" onClick={(event) => onOpenContent(projectId, event)}>
                {t("Open Campaigns")}
              </Button>
            ) : null}
          </Notice>
        ) : null}
        {suggestion.excluded.length ? (
          <details className="social-assistant-edit">
            <summary>{t("Left out · {p0}", { p0: suggestion.excluded.length })}</summary>
            <ul className="social-plan-excluded">
              {suggestion.excluded.map((entry) => (
                <li key={entry.campaignId}>
                  <strong>{known(entry.campaignId)?.name ?? t("Campaign not found")}</strong>
                  {" — "}
                  {entry.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="social-schedule-summary" aria-label={t("Sharing schedule")}>
          {parsed.schedule ? publishingScheduleSummary(parsed.schedule) : parsed.error}
        </p>
        <details className="social-assistant-edit">
          <summary>{t("Edit schedule")}</summary>
          <PlanScheduleFields
            value={review.schedule}
            disabled={locked}
            onChange={(change) => edit({ schedule: { ...review.schedule, ...change } })}
          />
        </details>
        {suggestion.rationale ? (
          <p className="social-plan-rationale">
            <strong>{t("Why this plan")}</strong> {suggestion.rationale}
          </p>
        ) : null}
        {suggestion.questions.length ? (
          <Notice kind="info" title={t("The AI needs more information")}>
            <ul>
              {suggestion.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <p className="social-assistant-note">
          {replacesDraft ? `${t("It replaces the unfinished plan draft in the form.")} ` : ""}
          {t(
            "Nothing is saved or enabled. “Use as plan draft” only fills the plan form; you review it there and save it paused yourself.",
          )}
        </p>
        {reason ? (
          <p className="social-assistant-reason" role="status">
            {reason}
          </p>
        ) : null}
        <ComposerActions>
          <Button variant="ghost" type="button" disabled={locked} onClick={discard}>
            {t("Discard suggestion")}
          </Button>
          <Button
            type="button"
            disabled={locked || !!reason || !account}
            onClick={() =>
              onAccept({
                name: review.name.trim(),
                accountId: suggestion.accountId,
                projectId: suggestion.projectId,
                campaignIds: review.campaignIds,
                schedule: review.schedule,
              })
            }
          >
            {t("Use as plan draft")}
          </Button>
        </ComposerActions>
      </div>
    );
  }

  return (
    <form
      id={formId}
      className="social-plan-suggest"
      aria-label={t("Ask AI to suggest a plan")}
      onSubmit={(event) => {
        event.preventDefault();
        if (canAsk) ask();
      }}
    >
      <p className="social-assistant-context" aria-label={t("What the AI will use")}>
        <span>
          {t("Account")}: <strong>{account?.name ?? t("None selected")}</strong>
        </span>
        <span>
          {t("Project")}: <strong>{projectName || t("No project selected")}</strong>
        </span>
        <span>
          {t("Text model")}:{" "}
          <strong>
            {agentLabel(agent) || (agentState === "checking" ? t("Checking…") : t("Not set"))}
          </strong>
        </span>
        <span>
          {t("Campaigns")}:{" "}
          <strong>
            {narrowed.length
              ? t("{p0} chosen", { p0: narrowed.length })
              : t("{p0} eligible", { p0: eligible.length })}
          </strong>
        </span>
      </p>
      <TextareaField
        label={t("What should the plan aim for? (optional)")}
        rows={2}
        value={instructions}
        disabled={locked || working}
        maxLength={PLAN_SUGGEST_INSTRUCTIONS_MAX}
        placeholder={t("E.g. one post a day on weekdays, newest content first")}
        onChange={(event) => setInstructions(event.target.value)}
      />
      <details className="social-assistant-scope">
        <summary>{t("Limit the campaigns the AI may use")}</summary>
        <div className="social-assistant-scope-fields">
          <SocialMultiSelect
            label={t("Campaigns the AI may use")}
            placeholder={t("All eligible campaigns")}
            searchPlaceholder={t("Search campaigns")}
            disabled={working}
            options={eligible.map((campaign) => ({ value: campaign.id, label: campaign.name }))}
            selected={narrowed}
            onChange={setNarrow}
          />
        </div>
      </details>
      {blocked ? (
        <p className="social-assistant-reason" role="status">
          {blocked}{" "}
          {agentState === "missing" && onOpenSettings ? (
            <Button variant="link" type="button" onClick={onOpenSettings}>
              {t("Open settings")}
            </Button>
          ) : null}
          {!eligible.length && onOpenContent ? (
            <Button variant="link" type="button" onClick={(event) => onOpenContent(projectId, event)}>
              {t("Open Campaigns")}
            </Button>
          ) : null}
        </p>
      ) : (
        <p className="social-assistant-note">
          {agent
            ? t("{p0} proposes a paused plan. Nothing is saved, sent or enabled.", {
                p0: agentLabel(agent),
              })
            : t("The AI proposes a paused plan. Nothing is saved, sent or enabled.")}
        </p>
      )}
      {error ? (
        <Notice kind="error" title={t("The AI could not suggest a plan")}>
          <p>{error}</p>
          {attempt ? (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={!canAsk}
              onClick={() => void send(attempt)}
            >
              {t("Try again")}
            </Button>
          ) : null}
        </Notice>
      ) : null}
      <ComposerActions>
        {working ? (
          <>
            <span role="status" className="social-assistant-progress">
              {t("Asking {p0}… nothing is saved yet.", {
                p0: agentLabel(agent) || t("the AI"),
              })}
            </span>
            <Button variant="ghost" type="button" onClick={stop}>
              {t("Stop waiting")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" type="button" disabled={locked} onClick={onClose}>
            {t("Back to the plan")}
          </Button>
        )}
        <Button
          form={formId}
          type="submit"
          loading={working}
          disabled={!canAsk}
          startIcon={<Sparkles aria-hidden="true" />}
        >
          {t("Suggest a plan")}
        </Button>
      </ComposerActions>
    </form>
  );
}
