import { InlineError } from "../../../shared/ui/InlineError";
import { useContext, useId, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { NumberField } from "../../../shared/ui/NumberField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Sparkles } from "../../../shared/ui/icons";
import { HARNESS_TITLE } from "../../sessions/model/session";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialAccount, SocialPolicy, SocialProjectProfile, SocialRule } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { socialQueryScope } from "../model/socialQuery";
import type {
  RuleChange,
  RuleDraft,
  RuleSimplifyInput,
  RuleSimplifyProposal,
  RuleSimplifySuggestion,
} from "../model/socialSuggestions";
import { SocialBusyContext } from "./socialContext";
import { ComposerActions, Notice, StatusBadge, type Run } from "./socialShared";
import "./social-rules.css";

/**
 * Review of the Host's `rules.simplify` proposals. The Host only proposes narrower versions;
 * there is no rule update operation, so accepting a proposal CREATES a new reply rule through
 * `automations.create` (always saved paused). The original rule is never changed here, and the
 * optional "pause the original too" runs `automations.pause` only after the create succeeded.
 */

export const ruleModeLabel = (mode: string) =>
  mode === "approval"
    ? t("Send with user approval")
    : mode === "automatic"
      ? t("Automatic within the rules")
      : t("Draft only");

const MAX_RULE_NAME = 200;
const MAX_STOP_PHRASES = 30;
const MAX_INSTRUCTIONS = 2000;

/** What the owner may change in one proposal. Every control is limited to the original rule's values. */
export type SimplifyEdit = {
  name: string;
  dailyLimit: string;
  topics: string[];
  answerKeys: string[];
  /** Extra stop phrases, comma separated. The rule's current ones are always kept. */
  extraStops: string;
};

type ItemState = {
  edit: SimplifyEdit;
  rejected: boolean;
  /** Held with the proposal so a retry after an unclear result returns the first receipt. */
  requestId: string;
  create: "idle" | "pending" | "created" | "failed";
  createError: string;
  createdId?: string;
  pauseOriginal: boolean;
  pause: "idle" | "pending" | "done" | "failed";
  pauseError: string;
};

type Answer = SocialRule["answers"][number];
export const answerKey = (answer: Answer) => JSON.stringify([answer.keyword, answer.factId]);
const splitPhrases = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((item) => b.includes(item));
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const agentText = (agent?: { provider: string; model?: string }) =>
  agent
    ? `${HARNESS_TITLE[agent.provider as keyof typeof HARNESS_TITLE] ?? agent.provider}${agent.model ? ` · ${agent.model}` : ""}`
    : "";

function initialEdit(proposal: RuleSimplifyProposal): SimplifyEdit {
  return {
    name: proposal.proposed.name,
    dailyLimit: String(proposal.proposed.dailyLimit),
    topics: [...proposal.proposed.topics],
    answerKeys: proposal.proposed.answers.map(answerKey),
    extraStops: "",
  };
}

/** Extra phrases the owner typed that the proposal does not already have (case-insensitive). */
function newStopPhrases(proposal: RuleSimplifyProposal, edit: SimplifyEdit) {
  const known = new Set(proposal.proposed.stopWords.map((word) => word.toLocaleLowerCase()));
  const added: string[] = [];
  for (const word of splitPhrases(edit.extraStops)) {
    const key = word.toLocaleLowerCase();
    if (known.has(key)) continue;
    known.add(key);
    added.push(word);
  }
  return added;
}

/**
 * The exact `automations.create` input after the owner's edits. Untouched fields stay the proposal's
 * own values (same arrays, same order); edited topics/answers are subsets of the ORIGINAL rule.
 */
export function ruleDraftFromReview(
  proposal: RuleSimplifyProposal,
  original: SocialRule,
  edit: SimplifyEdit,
): RuleDraft {
  const proposed = proposal.proposed;
  const topics = sameSet(edit.topics, proposed.topics)
    ? proposed.topics
    : original.topics.filter((topic) => edit.topics.includes(topic));
  const answers = sameSet(edit.answerKeys, proposed.answers.map(answerKey))
    ? proposed.answers
    : original.answers.filter((answer) => edit.answerKeys.includes(answerKey(answer)));
  const extra = newStopPhrases(proposal, edit);
  return {
    ...proposed,
    name: edit.name.trim(),
    topics,
    dailyLimit: Number(edit.dailyLimit),
    stopWords: extra.length ? [...proposed.stopWords, ...extra] : proposed.stopWords,
    answers,
  };
}

/** Why the proposal cannot be created as edited; empty means valid. */
export function simplifyProblems(
  proposal: RuleSimplifyProposal,
  original: SocialRule | undefined,
  edit: SimplifyEdit,
  factTopic: (factId: string) => string | undefined,
): string[] {
  if (!original) return [t("The original rule no longer exists.")];
  const problems: string[] = [];
  const name = edit.name.trim();
  if (!name || name.length > MAX_RULE_NAME)
    problems.push(t("Enter a rule name of at most {p0} characters.", { p0: MAX_RULE_NAME }));
  const max = Math.min(100, original.dailyLimit);
  const limit = Number(edit.dailyLimit);
  if (!edit.dailyLimit.trim() || !Number.isInteger(limit) || limit < 1 || limit > max)
    problems.push(t("The daily limit must be a whole number from 1 to {p0}.", { p0: max }));
  if (!edit.topics.length) problems.push(t("Keep at least one topic."));
  const draft = ruleDraftFromReview(proposal, original, edit);
  if (!draft.answers.length) problems.push(t("Keep at least one answer."));
  for (const answer of draft.answers) {
    const topic = factTopic(answer.factId);
    if (!topic) problems.push(t("An answer uses a fact that is no longer verified."));
    else if (!draft.topics.includes(topic))
      problems.push(t("The answer “{p0}” needs the topic “{p1}”.", { p0: answer.keyword, p1: topic }));
  }
  if (draft.stopWords.length > MAX_STOP_PHRASES)
    problems.push(t("A rule can have at most {p0} stop phrases.", { p0: MAX_STOP_PHRASES }));
  return [...new Set(problems)];
}

export type RuleSimplifyContext = {
  client: SocialClient;
  rules: SocialRule[];
  accounts: SocialAccount[];
  profiles: SocialProjectProfile[];
  projects: HostProject[];
  hostOnline: boolean;
  /** The rule the owner is looking at: its account and project are the default scope. */
  preferred?: SocialRule;
  run: Run;
};

/**
 * One state owner for the whole simplify flow (ask, review, per-proposal edits and results). It
 * lives in the rules page, so closing the dialog never loses an unfinished review.
 */
export function useRuleSimplify(context: RuleSimplifyContext) {
  const { client, rules, accounts, profiles, projects, hostOnline, preferred, run } = context;
  const [scopeKey, setScopeKey] = useState("");
  const [unticked, setUnticked] = useState<string[]>([]);
  const [instructions, setInstructionsState] = useState("");
  const [phase, setPhase] = useState<"idle" | "asking" | "review">("idle");
  const [error, setError] = useState("");
  // Set only after a failed ask: Try again reuses it; any change of the ask or a new ask drops it.
  const [retryId, setRetryId] = useState<string>();
  const [suggestion, setSuggestion] = useState<RuleSimplifySuggestion>();
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const token = useRef(0);

  const scopes: { key: string; accountId: string; projectId: string }[] = [];
  for (const rule of rules) {
    const key = JSON.stringify([rule.accountId, rule.projectId]);
    if (
      scopes.some((scope) => scope.key === key) ||
      !accounts.some((account) => account.id === rule.accountId) ||
      !projects.some((project) => project.id === rule.projectId)
    )
      continue;
    scopes.push({ key, accountId: rule.accountId, projectId: rule.projectId });
  }
  const scope =
    scopes.find((item) => item.key === scopeKey) ??
    scopes.find(
      (item) => item.accountId === preferred?.accountId && item.projectId === preferred?.projectId,
    ) ??
    scopes[0];
  const scopeRules = scope
    ? rules.filter((rule) => rule.accountId === scope.accountId && rule.projectId === scope.projectId)
    : [];
  const picked = scopeRules.filter((rule) => !unticked.includes(rule.id)).map((rule) => rule.id);
  const account = accounts.find((item) => item.id === scope?.accountId);
  const project = projects.find((item) => item.id === scope?.projectId);

  const policy = useQuery({
    queryKey: [...socialQueryScope(client), "rules-simplify-policy", scope?.accountId ?? ""],
    queryFn: () =>
      client.request<{ effective: SocialPolicy }>("policy.get", { accountId: scope?.accountId }),
    enabled: hostOnline && !!scope,
    staleTime: 30_000,
  });
  const agent = policy.data?.effective.agent;
  const noAgent = policy.isSuccess && !agent;
  const blocked = !hostOnline
    ? t("The computer is offline.")
    : !rules.length
      ? t("Create a reply rule first.")
      : !scope
        ? t("No rule belongs to an account and project available here.")
        : noAgent
          ? t("Choose a text agent in Settings first.")
          : "";

  const patch = (ruleId: string, change: Partial<ItemState>) =>
    setItems((current) =>
      current[ruleId] ? { ...current, [ruleId]: { ...current[ruleId], ...change } } : current,
    );
  const askChanged = () => setRetryId(undefined);

  const factTopic = (projectId: string) => (factId: string) =>
    profiles.find((profile) => profile.projectId === projectId)?.facts.find((fact) => fact.id === factId)
      ?.topic;
  const problemsFor = (proposal: RuleSimplifyProposal, item: ItemState) =>
    simplifyProblems(
      proposal,
      rules.find((rule) => rule.id === proposal.ruleId),
      item.edit,
      factTopic(proposal.proposed.projectId),
    );
  const creatable = (proposal: RuleSimplifyProposal) => {
    const item = items[proposal.ruleId];
    return (
      !!item &&
      !item.rejected &&
      (item.create === "idle" || item.create === "failed") &&
      problemsFor(proposal, item).length === 0
    );
  };

  const ask = async () => {
    if (!scope || blocked || !picked.length || phase === "asking") return;
    const current = ++token.current;
    const requestId = retryId ?? crypto.randomUUID();
    setPhase("asking");
    setError("");
    try {
      const text = instructions.trim();
      const input: RuleSimplifyInput = {
        accountId: scope.accountId,
        projectId: scope.projectId,
        ...(picked.length < scopeRules.length ? { ruleIds: picked } : {}),
        ...(text ? { instructions: text } : {}),
      };
      const result = await client.request<RuleSimplifySuggestion>("rules.simplify", input, requestId);
      if (current !== token.current) return;
      setItems(
        Object.fromEntries(
          result.proposals.map((proposal) => [
            proposal.ruleId,
            {
              edit: initialEdit(proposal),
              rejected: false,
              requestId: crypto.randomUUID(),
              create: "idle",
              createError: "",
              pauseOriginal: false,
              pause: "idle",
              pauseError: "",
            } satisfies ItemState,
          ]),
        ),
      );
      setSuggestion(result);
      setRetryId(undefined);
      setPhase("review");
    } catch (cause) {
      if (current !== token.current) return;
      setRetryId(requestId);
      setError(errorText(cause));
      setPhase("idle");
    }
  };
  // Stops waiting. `rules.simplify` stores nothing, so a late answer is ignored; a new ask is a new ask.
  const stop = () => {
    token.current++;
    setRetryId(undefined);
    setPhase("idle");
    setError("");
  };
  const restart = () => {
    token.current++;
    setRetryId(undefined);
    setSuggestion(undefined);
    setItems({});
    setPhase("idle");
    setError("");
  };

  const pauseOriginal = async (ruleId: string) => {
    patch(ruleId, { pause: "pending", pauseError: "" });
    let message = "";
    const ok = await run(async () => {
      try {
        await client.request("automations.pause", { id: ruleId });
      } catch (cause) {
        message = errorText(cause);
        throw cause;
      }
    }, t("The original rule is paused."));
    patch(ruleId, {
      pause: ok ? "done" : "failed",
      pauseError: ok ? "" : message || t("Another operation is in progress. Try again in a moment."),
    });
  };
  const create = async (proposal: RuleSimplifyProposal, item: ItemState) => {
    const original = rules.find((rule) => rule.id === proposal.ruleId);
    if (!original || !creatable(proposal)) return false;
    const payload = ruleDraftFromReview(proposal, original, item.edit);
    patch(proposal.ruleId, { create: "pending", createError: "" });
    const out: { id?: string } = {};
    let message = "";
    const ok = await run(async () => {
      try {
        const rule = await client.request<{ id?: string }>("automations.create", payload, item.requestId);
        out.id = rule?.id;
      } catch (cause) {
        message = errorText(cause);
        throw cause;
      }
    }, t("Paused rule “{p0}” created. The original rule is unchanged.", { p0: payload.name }));
    if (!ok) {
      patch(proposal.ruleId, {
        create: "failed",
        createError: message || t("Another operation is in progress. Try again in a moment."),
      });
      return false;
    }
    patch(proposal.ruleId, { create: "created", createdId: out.id });
    if (item.pauseOriginal) await pauseOriginal(proposal.ruleId);
    return true;
  };

  return {
    phase,
    error,
    suggestion,
    items,
    scopes: scopes.map((item) => ({
      ...item,
      label: `${accounts.find((entry) => entry.id === item.accountId)?.name ?? ""} · ${projects.find((entry) => entry.id === item.projectId)?.name || projects.find((entry) => entry.id === item.projectId)?.cwd || ""}`,
      count: rules.filter(
        (rule) => rule.accountId === item.accountId && rule.projectId === item.projectId,
      ).length,
    })),
    scope,
    scopeRules,
    picked,
    account,
    project,
    agent,
    agentChecking: policy.isPending && !!scope && hostOnline,
    noAgent,
    /** Empty when asking is possible. */
    blocked,
    instructions,
    retrying: !!retryId,
    rules,
    accounts,
    projects,
    profiles,
    setScope: (key: string) => {
      askChanged();
      setScopeKey(key);
      setUnticked([]);
    },
    setPicked: (ruleId: string, on: boolean) => {
      askChanged();
      setUnticked(
        on ? unticked.filter((id) => id !== ruleId) : [...new Set([...unticked, ruleId])],
      );
    },
    setInstructions: (text: string) => {
      askChanged();
      setInstructionsState(text);
    },
    ask,
    stop,
    restart,
    edit: (ruleId: string, change: Partial<SimplifyEdit>) =>
      setItems((current) =>
        current[ruleId]
          ? { ...current, [ruleId]: { ...current[ruleId], edit: { ...current[ruleId].edit, ...change } } }
          : current,
      ),
    reject: (ruleId: string, rejected: boolean) => patch(ruleId, { rejected }),
    setPauseOriginal: (ruleId: string, on: boolean) => patch(ruleId, { pauseOriginal: on }),
    problemsFor,
    creatable,
    accept: (proposal: RuleSimplifyProposal) => {
      const item = items[proposal.ruleId];
      return item ? create(proposal, item) : Promise.resolve(false);
    },
    acceptAll: async () => {
      for (const proposal of suggestion?.proposals ?? []) {
        const item = items[proposal.ruleId];
        if (item && creatable(proposal)) await create(proposal, item);
      }
    },
    retryPause: (ruleId: string) => pauseOriginal(ruleId),
    validCount: (suggestion?.proposals ?? []).filter(creatable).length,
  };
}

export type RuleSimplifySession = ReturnType<typeof useRuleSimplify>;

function Check({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="social-rule-check">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

/** Ask (scope, rules, optional instruction) and, once answered, the per-proposal review. */
export function RuleSimplifyReview({
  session,
  onClose,
  onOpenSettings,
}: {
  session: RuleSimplifySession;
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  useLocale();
  return session.phase === "review" && session.suggestion ? (
    <SimplifyResults session={session} suggestion={session.suggestion} onClose={onClose} />
  ) : (
    <SimplifyAsk session={session} onClose={onClose} onOpenSettings={onOpenSettings} />
  );
}

function SimplifyAsk({
  session,
  onClose,
  onOpenSettings,
}: {
  session: RuleSimplifySession;
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const formId = useId();
  const locked = useContext(SocialBusyContext);
  const asking = session.phase === "asking";
  const canAsk = !session.blocked && !!session.picked.length && !asking && !locked;
  const agentLabel = session.agent
    ? agentText(session.agent)
    : session.agentChecking
      ? t("Checking…")
      : t("Not set");
  const reason =
    session.blocked || (!session.picked.length && session.scope ? t("Select at least one rule.") : "");
  return (
    <form
      id={formId}
      className="social-rule-ask"
      aria-label={t("Simplify rules with AI")}
      onSubmit={(event) => {
        event.preventDefault();
        if (canAsk) void session.ask();
      }}
    >
      {session.scopes.length > 1 ? (
        <label className="social-rule-field">
          {t("Account and project")}
          <SearchableSelect
            disabled={locked || asking}
            value={session.scope?.key ?? ""}
            label={t("Account and project")}
            options={session.scopes.map((item) => ({
              value: item.key,
              label: `${item.label} (${item.count})`,
            }))}
            onChange={session.setScope}
            searchLocale={getLocale()}
          />
        </label>
      ) : (
        <p className="social-rule-context">
          <span>
            {t("Account")}: <strong>{session.account?.name ?? "—"}</strong>
          </span>
          <span>
            {t("Project")}: <strong>{session.project?.name || session.project?.cwd || "—"}</strong>
          </span>
        </p>
      )}
      <fieldset className="social-rule-pick" disabled={locked || asking}>
        <legend>{t("Rules to review")}</legend>
        {session.scopeRules.map((rule) => (
          <Check
            key={rule.id}
            checked={session.picked.includes(rule.id)}
            onChange={(on) => session.setPicked(rule.id, on)}
          >
            {rule.name} <small>{ruleModeLabel(rule.mode)}</small>
          </Check>
        ))}
      </fieldset>
      <TextareaField
        label={t("Instructions (optional)")}
        rows={2}
        value={session.instructions}
        maxLength={MAX_INSTRUCTIONS}
        disabled={locked || asking}
        placeholder={t("E.g. keep only the pricing topics")}
        onChange={(event) => session.setInstructions(event.target.value)}
      />
      <p className="social-rule-context">
        <span>
          {t("Text model")}: <strong>{agentLabel}</strong>
        </span>
      </p>
      {reason ? (
        <p className="social-rule-note" role="status">
          {reason}{" "}
          {session.noAgent && onOpenSettings ? (
            <Button variant="link" type="button" onClick={onOpenSettings}>
              {t("Open settings")}
            </Button>
          ) : null}
        </p>
      ) : (
        <p className="social-rule-note">
          {t("The AI only proposes narrower rules. Nothing is changed, sent or activated.")}
        </p>
      )}
      {session.error ? (
        <Notice kind="error" title={t("The AI could not review the rules")}>
          <p>{session.error}</p>
        </Notice>
      ) : null}
      <ComposerActions className="social-rule-actions">
        {asking ? (
          <>
            <span role="status" className="social-rule-note">
              {t("Asking {p0}… nothing is changed yet.", { p0: agentLabel })}
            </span>
            <Button variant="ghost" type="button" onClick={session.stop}>
              {t("Stop waiting")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" type="button" disabled={locked} onClick={onClose}>
            {t("Close")}
          </Button>
        )}
        <Button
          form={formId}
          type="submit"
          loading={asking}
          disabled={!canAsk}
          startIcon={<Sparkles aria-hidden="true" />}
        >
          {session.error ? t("Try again") : t("Suggest simpler rules")}
        </Button>
      </ComposerActions>
    </form>
  );
}

function SimplifyResults({
  session,
  suggestion,
  onClose,
}: {
  session: RuleSimplifySession;
  suggestion: RuleSimplifySuggestion;
  onClose: () => void;
}) {
  const locked = useContext(SocialBusyContext);
  const account = session.accounts.find((item) => item.id === suggestion.accountId);
  const project = session.projects.find((item) => item.id === suggestion.projectId);
  const total = suggestion.proposals.length + suggestion.unchangedRuleIds.length;
  return (
    <div className="social-rule-review" role="group" aria-label={t("AI rule review")}>
      <p className="social-rule-context">
        <span>
          {t("Account")}: <strong>{account?.name ?? t("Account not found")}</strong>
        </span>
        <span>
          {t("Project")}: <strong>{project?.name || project?.cwd || t("Project not found")}</strong>
        </span>
        <span>
          {t("Reviewed by")}: <strong>{agentText(suggestion.agent) || t("Not set")}</strong>
        </span>
      </p>
      <Notice kind="info" title={t("Accepting creates a new paused rule")}>
        {t(
          "There is no way to edit a rule in place. Accepting a proposal saves a new reply rule, paused. The original rule is not changed or deleted and stays as it is until you pause it. Nothing is sent or activated.",
        )}
      </Notice>
      <div className="social-rule-count">
        <strong role="status">
          {t("{p0} of {p1} rules would change", { p0: suggestion.proposals.length, p1: total })}
        </strong>
      </div>
      {suggestion.proposals.length ? null : (
        <p className="social-rule-note">{t("Nothing to simplify. Your rules stay as they are.")}</p>
      )}
      {suggestion.proposals.map((proposal) => (
        <ProposalCard key={proposal.ruleId} session={session} proposal={proposal} locked={locked} />
      ))}
      {suggestion.unchangedRuleIds.length ? (
        <details className="social-rule-unchanged">
          <summary>
            {t("Rules that stay as they are · {p0}", { p0: suggestion.unchangedRuleIds.length })}
          </summary>
          <ul>
            {suggestion.unchangedRuleIds.map((id) => (
              <li key={id}>
                {session.rules.find((rule) => rule.id === id)?.name ?? t("Removed rule")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {suggestion.notes.length ? (
        <Notice kind="info" title={t("Notes from the AI")}>
          <ul>
            {suggestion.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <ComposerActions className="social-rule-actions">
        <Button variant="ghost" type="button" disabled={locked} onClick={onClose}>
          {t("Close")}
        </Button>
        <Button variant="secondary" type="button" disabled={locked} onClick={session.restart}>
          {t("Ask again")}
        </Button>
        {suggestion.proposals.length ? (
          <Button
            type="button"
            disabled={locked || !session.validCount}
            onClick={() => void session.acceptAll()}
          >
            {t("Accept all valid ({p0})", { p0: session.validCount })}
          </Button>
        ) : null}
      </ComposerActions>
    </div>
  );
}

const fieldLabel = (field: RuleChange["field"]) =>
  field === "name"
    ? t("Name")
    : field === "mode"
      ? t("Mode")
      : field === "topics"
        ? t("Topics")
        : field === "dailyLimit"
          ? t("Daily limit")
          : field === "stopWords"
            ? t("Stop phrases")
            : t("Answers");
const asStrings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const asAnswers = (value: unknown): Answer[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Answer =>
          !!item && typeof item.keyword === "string" && typeof item.factId === "string",
      )
    : [];

function ListDiff({
  before,
  after,
  label = (item) => item,
}: {
  before: string[];
  after: string[];
  label?: (item: string) => string;
}) {
  const removed = before.filter((item) => !after.includes(item));
  const added = after.filter((item) => !before.includes(item));
  return (
    <>
      <span>{t("{p0} → {p1}", { p0: before.length, p1: after.length })}</span>
      {removed.length ? (
        <span>
          {t("Removed")}: <s>{removed.map(label).join(", ")}</s>
        </span>
      ) : null}
      {added.length ? (
        <span>
          {t("Added")}: {added.map(label).join(", ")}
        </span>
      ) : null}
    </>
  );
}

function ChangeValue({
  change,
  factTopic,
}: {
  change: RuleChange;
  factTopic: (factId: string) => string | undefined;
}) {
  if (change.field === "topics" || change.field === "stopWords")
    return <ListDiff before={asStrings(change.before)} after={asStrings(change.after)} />;
  if (change.field === "answers") {
    const label = (key: string) => {
      const [keyword, factId] = JSON.parse(key) as [string, string];
      return `“${keyword}” → ${factTopic(factId) ?? factId}`;
    };
    return (
      <ListDiff
        before={asAnswers(change.before).map(answerKey)}
        after={asAnswers(change.after).map(answerKey)}
        label={label}
      />
    );
  }
  const show = (value: unknown) =>
    change.field === "mode" ? ruleModeLabel(String(value)) : String(value);
  return (
    <>
      <s>{show(change.before)}</s>
      <span>→ {show(change.after)}</span>
    </>
  );
}

function ProposalCard({
  session,
  proposal,
  locked,
}: {
  session: RuleSimplifySession;
  proposal: RuleSimplifyProposal;
  locked: boolean;
}) {
  const item = session.items[proposal.ruleId];
  const original = session.rules.find((rule) => rule.id === proposal.ruleId);
  if (!item) return null;
  const facts =
    session.profiles.find((profile) => profile.projectId === proposal.proposed.projectId)?.facts ?? [];
  const factTopic = (factId: string) => facts.find((fact) => fact.id === factId)?.topic;
  const problems = session.problemsFor(proposal, item);
  const settled = item.create === "pending" || item.create === "created";
  const frozen = locked || settled || item.rejected;
  const draft = original ? ruleDraftFromReview(proposal, original, item.edit) : undefined;
  const status =
    item.create === "created"
      ? { status: "succeeded", label: t("Created paused") }
      : item.create === "pending"
        ? { status: "running", label: t("Creating…") }
        : item.create === "failed"
          ? { status: "failed", label: t("Failed") }
          : item.rejected
            ? { status: "cancelled", label: t("Rejected") }
            : { status: "review", label: t("Needs your review") };
  const set = (change: Partial<SimplifyEdit>) => session.edit(proposal.ruleId, change);
  const maxLimit = original ? Math.min(100, original.dailyLimit) : 100;
  return (
    <article
      className="social-rule-proposal"
      data-state={item.rejected ? "rejected" : item.create}
      aria-label={t("Proposal for {p0}", { p0: proposal.ruleName })}
    >
      <header>
        <h4>{proposal.ruleName}</h4>
        <StatusBadge status={status.status} label={status.label} />
      </header>
      {proposal.reason ? <p className="social-rule-reason">{proposal.reason}</p> : null}
      <dl className="social-rule-diff" aria-label={t("Changes")}>
        {proposal.changes.map((change) => (
          <div key={change.field}>
            <dt>{fieldLabel(change.field)}</dt>
            <dd>
              <ChangeValue change={change} factTopic={factTopic} />
            </dd>
          </div>
        ))}
      </dl>
      {original && !item.rejected ? (
        <details className="social-rule-edit">
          <summary>{t("Edit before creating")}</summary>
          <TextField
            label={t("Name")}
            value={item.edit.name}
            maxLength={MAX_RULE_NAME}
            disabled={frozen}
            onChange={(event) => set({ name: event.target.value })}
          />
          <NumberField
            label={t("Daily limit")}
            min={1}
            max={maxLimit}
            value={item.edit.dailyLimit}
            disabled={frozen}
            description={t("At most {p0}, the current limit.", { p0: maxLimit })}
            onChange={(event) => set({ dailyLimit: event.target.value })}
          />
          <fieldset className="social-rule-pick" disabled={frozen}>
            <legend>{t("Topics to keep")}</legend>
            {original.topics.map((topic) => (
              <Check
                key={topic}
                checked={item.edit.topics.includes(topic)}
                onChange={(on) =>
                  set({
                    topics: on
                      ? [...item.edit.topics, topic]
                      : item.edit.topics.filter((entry) => entry !== topic),
                  })
                }
              >
                {topic}
              </Check>
            ))}
          </fieldset>
          <fieldset className="social-rule-pick" disabled={frozen}>
            <legend>{t("Answers to keep")}</legend>
            {original.answers.map((answer) => (
              <Check
                key={answerKey(answer)}
                checked={item.edit.answerKeys.includes(answerKey(answer))}
                onChange={(on) =>
                  set({
                    answerKeys: on
                      ? [...item.edit.answerKeys, answerKey(answer)]
                      : item.edit.answerKeys.filter((entry) => entry !== answerKey(answer)),
                  })
                }
              >
                {`“${answer.keyword}” → ${factTopic(answer.factId) ?? answer.factId}`}
              </Check>
            ))}
          </fieldset>
          <TextField
            label={t("Add stop phrases")}
            value={item.edit.extraStops}
            disabled={frozen}
            placeholder={t("Separate with commas")}
            description={t("All current stop phrases are kept.")}
            onChange={(event) => set({ extraStops: event.target.value })}
          />
        </details>
      ) : null}
      {draft && !item.rejected ? (
        <p className="social-rule-summary">
          {t("Accepting creates a new paused rule: {p0}", {
            p0: [
              draft.name,
              ruleModeLabel(draft.mode),
              t("up to {p0} a day", { p0: draft.dailyLimit }),
              draft.topics.join(", "),
              draft.answers.length === 1
                ? t("1 answer")
                : t("{p0} answers", { p0: draft.answers.length }),
              draft.stopWords.length === 1
                ? t("1 stop phrase")
                : t("{p0} stop phrases", { p0: draft.stopWords.length }),
            ].join(" · "),
          })}
        </p>
      ) : null}
      {problems.length && !item.rejected && item.create !== "created" ? (
        <p className="social-rule-problem" role="status">
          {problems.join(" ")}
        </p>
      ) : null}
      {item.create === "failed" ? (
        <InlineError>{item.createError}</InlineError>
      ) : null}
      {item.create === "created" ? (
        <p className="social-rule-note" role="status">
          {t("“{p0}” was created and is paused. Activate it from the rule list when you are ready.", {
            p0: item.edit.name.trim(),
          })}
          {item.pause === "pending" ? ` ${t("Pausing the original rule…")}` : ""}
          {item.pause === "done" ? ` ${t("The original rule is paused.")}` : ""}
        </p>
      ) : null}
      {item.pause === "failed" ? (
        <InlineError>{t("The original rule could not be paused: {p0}", { p0: item.pauseError })}</InlineError>
      ) : null}
      <div className="social-rule-actions">
        {item.create === "created" ? (
          item.pause === "failed" ? (
            <Button
              variant="secondary"
              type="button"
              disabled={locked}
              onClick={() => void session.retryPause(proposal.ruleId)}
            >
              {t("Retry pausing the original rule")}
            </Button>
          ) : null
        ) : item.rejected ? (
          <Button
            variant="ghost"
            type="button"
            disabled={locked}
            onClick={() => session.reject(proposal.ruleId, false)}
          >
            {t("Undo reject")}
          </Button>
        ) : (
          <>
            <Check
              checked={item.pauseOriginal}
              disabled={locked || item.create === "pending"}
              onChange={(on) => session.setPauseOriginal(proposal.ruleId, on)}
            >
              {t("Pause the original rule too")}
            </Check>
            <Button
              type="button"
              loading={item.create === "pending"}
              disabled={locked || !session.creatable(proposal)}
              onClick={() => void session.accept(proposal)}
            >
              {item.create === "failed" ? t("Retry") : t("Accept")}
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={locked || item.create === "pending"}
              onClick={() => session.reject(proposal.ruleId, true)}
            >
              {t("Reject")}
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
