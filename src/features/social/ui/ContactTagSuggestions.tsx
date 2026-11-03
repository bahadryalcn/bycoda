import { InlineError } from "../../../shared/ui/InlineError";
import { useContext, useRef, useState } from "react";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Sparkles } from "../../../shared/ui/icons";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialAccount } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { proposalRequestId } from "../model/socialAssistant";
import {
  contactTagBlockedReason,
  contactTagInput,
  contactTagRequestRefs,
  contactTagScopes,
  initialTagReview,
  keepAllValid,
  keptTags,
  mergeTags,
  tagIssue,
  type ContactTagSubject,
  type TagReviewState,
} from "../model/socialContactTags";
import {
  CONTACT_TAG_MAX_LENGTH,
  CONTACT_TAG_REQUEST_MAX,
  type ContactTagInput,
  type ContactTagResult,
} from "../model/socialSuggestions";
import { SocialBusyContext } from "./socialContext";
import { agentLabel, usePlanTextAgent } from "./PlanSuggestion";
import { useSocialPending } from "./useSocialPending";
import { ComposerActions, Notice, SocialDialog, StatusBadge, type Run } from "./socialShared";
import "./social-assistant.css";
import "./social-tags.css";

const INSTRUCTIONS_MAX = 2000;

type Phase = "ask" | "working" | "review";
type Attempt = { id: string; key: string; input: ContactTagInput };

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * Review of the Host's `contacts.suggestTags`. The answer is a draft only: it stores nothing and
 * never touches consent, opt-out or eligibility. Accepted tags reach the contacts only through the
 * existing paths: the import draft (rows not saved yet) or `contacts.upsert` (saved contacts).
 */
export function ContactTagDialog({
  mode,
  subjects,
  client,
  accounts,
  projects,
  hostOnline,
  run,
  onApplyImport,
  onClose,
  onOpenSettings,
}: {
  mode: "import" | "contacts";
  subjects: ContactTagSubject[];
  client: SocialClient;
  accounts: SocialAccount[];
  projects: HostProject[];
  hostOnline: boolean;
  run: Run;
  /** Import mode: the kept tags per row, added to the import draft only. */
  onApplyImport: (tags: Record<string, string[]>) => void;
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  useLocale();
  return (
    <SocialDialog
      title={
        mode === "import"
          ? t("Suggest tags for this import")
          : t("Suggest tags for selected contacts")
      }
      description={
        mode === "import"
          ? t(
              "The AI proposes tags for the rows in your import draft. You decide which ones to add.",
            )
          : t("The AI proposes tags for the selected contacts. You decide which ones to save.")
      }
      size="lg"
      onClose={onClose}
    >
      <ContactTagReview
        mode={mode}
        subjects={subjects}
        client={client}
        accounts={accounts}
        projects={projects}
        hostOnline={hostOnline}
        run={run}
        onApplyImport={onApplyImport}
        onClose={onClose}
        onOpenSettings={onOpenSettings}
      />
    </SocialDialog>
  );
}

function ContactTagReview({
  mode,
  subjects,
  client,
  accounts,
  projects,
  hostOnline,
  run,
  onApplyImport,
  onClose,
  onOpenSettings,
}: Parameters<typeof ContactTagDialog>[0]) {
  const locked = useContext(SocialBusyContext);
  const pendingUi = useSocialPending();
  const projectName = (id: string) => {
    const project = projects.find((item) => item.id === id);
    return project?.name || project?.cwd || t("Project");
  };
  const scopes = contactTagScopes(
    subjects,
    projects.map((project) => project.id),
  );
  const [scopeKey, setScopeKey] = useState("");
  const scope = scopes.find((item) => item.key === scopeKey) ?? scopes[0];
  const account = accounts.find((item) => item.id === scope?.accountId);
  const { agent, state: agentState } = usePlanTextAgent(client, scope?.accountId ?? "", hostOnline);
  const [instructions, setInstructions] = useState("");
  const [phase, setPhase] = useState<Phase>("ask");
  const [attempt, setAttempt] = useState<Attempt>();
  const [error, setError] = useState("");
  const [result, setResult] = useState<ContactTagResult>();
  const [review, setReview] = useState<TagReviewState>({});
  const [applied, setApplied] = useState<string[]>([]);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [applyError, setApplyError] = useState("");
  const token = useRef(0);
  const asked = scope ? contactTagRequestRefs(scope) : [];
  const blocked = contactTagBlockedReason({
    hostOnline,
    account,
    projectId: scope?.projectId ?? "",
    agent: agentState,
    count: asked.length,
  });
  const working = phase === "working";
  const canAsk =
    !blocked && !working && !locked && instructions.length <= INSTRUCTIONS_MAX && !!scope;
  const model = agentLabel(agent) || (agentState === "checking" ? t("Checking…") : t("Not set"));

  const send = async (next: Attempt) => {
    const current = ++token.current;
    setAttempt(next);
    setPhase("working");
    setError("");
    try {
      // One id per ask: a retry after an error reuses it and gets the first receipt, not a second model call.
      const answer = await client.request<ContactTagResult>(
        "contacts.suggestTags",
        next.input,
        next.id,
      );
      if (current !== token.current) return;
      if (!answer || !Array.isArray(answer.proposals))
        throw new Error(t("The AI answer was incomplete. Try again."));
      setResult(answer);
      setReview(initialTagReview(answer));
      setApplied([]);
      setFailures({});
      setApplyError("");
      setPhase("review");
    } catch (cause) {
      if (current !== token.current) return;
      setError(errorText(cause));
      setPhase("ask");
    }
  };
  const ask = () => {
    if (!scope) return;
    const input = contactTagInput(mode, scope, subjects, instructions);
    const key = JSON.stringify(input);
    void send({
      id: attempt && attempt.key === key && error ? attempt.id : proposalRequestId(),
      key,
      input,
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
    setResult(undefined);
    setReview({});
    setPhase("ask");
  };

  const kept = result ? keptTags(result, review) : {};
  const pendingRefs = Object.keys(kept).filter((ref) => !applied.includes(ref));
  const pendingCount = pendingRefs.reduce((sum, ref) => sum + kept[ref].length, 0);
  const applying = pendingUi.is("contacts.apply-suggested-tags");

  const apply = () => {
    if (!result || !pendingRefs.length) return;
    if (mode === "import") {
      onApplyImport(Object.fromEntries(pendingRefs.map((ref) => [ref, kept[ref]])));
      onClose();
      return;
    }
    void (async () => {
      const failed: Record<string, string> = {};
      const done: string[] = [];
      const ok = await pendingUi.run("contacts.apply-suggested-tags", () =>
        run(
          async () => {
            for (const ref of pendingRefs) {
              const subject = subjects.find((item) => item.ref === ref);
              if (!subject) {
                failed[ref] = t("This contact is no longer in the selection.");
                continue;
              }
              try {
                // The normal contact update: only the tag list changes, consent and opt-out stay as they are.
                await client.request("contacts.upsert", {
                  accountId: subject.accountId,
                  platformId: subject.platformId,
                  tags: mergeTags(subject.tags, kept[ref]),
                });
                done.push(ref);
              } catch (cause) {
                failed[ref] = errorText(cause);
              }
            }
            if (Object.keys(failed).length)
              throw new Error(
                t("{p0} of {p1} contacts could not be updated.", {
                  p0: Object.keys(failed).length,
                  p1: pendingRefs.length,
                }),
              );
          },
          pendingRefs.length === 1
            ? t("Tags saved on 1 contact.")
            : t("Tags saved on {p0} contacts.", { p0: pendingRefs.length }),
        ),
      );
      setApplied((current) => [...current, ...done]);
      setFailures(failed);
      setApplyError(
        ok || Object.keys(failed).length
          ? ""
          : t("Another operation is in progress. Try again in a moment."),
      );
      if (ok) onClose();
    })();
  };

  if (phase === "review" && result) {
    const total = subjects.filter((subject) => asked.includes(subject.ref)).length;
    const proposed = result.proposals.length;
    return (
      <div className="social-tag-review" role="group" aria-label={t("AI tag suggestions")}>
        <dl className="social-assistant-facts">
          <div>
            <dt>{t("Account")}</dt>
            <dd>{account?.name ?? t("Account not found")}</dd>
          </div>
          <div>
            <dt>{t("Project")}</dt>
            <dd>{projectName(result.projectId)}</dd>
          </div>
          <div>
            <dt>{t("Text model")}</dt>
            <dd>{agentLabel(result.agent) || t("Not set")}</dd>
          </div>
          <div>
            <dt>{t("Contacts")}</dt>
            <dd>{t("Suggestions for {p0} of {p1} contacts", { p0: proposed, p1: total })}</dd>
          </div>
        </dl>
        <Notice
          kind="info"
          title={
            mode === "import"
              ? t("Added to the import draft only")
              : t("Saved on the contacts you choose")
          }
        >
          {mode === "import"
            ? t(
                "Chosen tags are added to the rows of this import. Nothing is saved until you import, and importing never grants permission to message anyone.",
              )
            : t(
                "Chosen tags are saved with the normal contact update. Consent, opt-out and eligibility are not changed.",
              )}
        </Notice>
        {applyError ? (
          <Notice kind="error" title={t("Tags were not saved")}>
            {applyError}
          </Notice>
        ) : null}
        {Object.keys(failures).length ? (
          <Notice kind="error" title={t("Some contacts could not be updated")}>
            {t("The tags of the other contacts were saved. Try the failed ones again.")}
          </Notice>
        ) : null}
        {proposed ? (
          <ul className="social-tag-list">
            {result.proposals.map((proposal) => {
              const edits = review[proposal.ref] ?? [];
              const done = applied.includes(proposal.ref);
              const failure = failures[proposal.ref];
              const change = (index: number, patch: Partial<(typeof edits)[number]>) =>
                setReview((current) => ({
                  ...current,
                  [proposal.ref]: edits.map((edit, other) =>
                    other === index ? { ...edit, ...patch } : edit,
                  ),
                }));
              return (
                <li
                  key={proposal.ref}
                  className="social-tag-contact"
                  data-state={done ? "done" : undefined}
                >
                  <div className="social-tag-contact-head">
                    <strong>{proposal.name}</strong>
                    {proposal.currentTags.length ? (
                      <BadgeList
                        label={t("Tags")}
                        size="xs"
                        className="min-w-0 flex-[1_1_8rem]"
                        items={proposal.currentTags.map((tag, index) => ({
                          id: `${index}:${tag}`,
                          label: tag,
                        }))}
                      />
                    ) : (
                      <span className="social-muted">{t("No tags yet")}</span>
                    )}
                    {done ? <StatusBadge status="succeeded" label={t("Saved")} /> : null}
                  </div>
                  <ul className="social-tag-suggestions">
                    {proposal.tags.map((entry, index) => {
                      const edit = edits[index];
                      if (!edit) return null;
                      const issue =
                        edit.use || !edit.text.trim()
                          ? tagIssue(proposal.currentTags, edits, index)
                          : "";
                      return (
                        <li key={index}>
                          <Checkbox
                            aria-label={t("Keep tag {p0} for {p1}", {
                              p0: edit.text,
                              p1: proposal.name,
                            })}
                            checked={edit.use}
                            disabled={locked || applying || done}
                            onChange={(event) => change(index, { use: event.target.checked })}
                          />
                          <TextField
                            hideLabel
                            fieldVariant="compact"
                            label={t("Tag for {p0}", { p0: proposal.name })}
                            value={edit.text}
                            maxLength={CONTACT_TAG_MAX_LENGTH + 20}
                            disabled={locked || applying || done}
                            onChange={(event) => change(index, { text: event.target.value })}
                          />
                          {entry.isNew ? (
                            <Badge tone="info" appearance="subtle">
                              {t("New tag")}
                            </Badge>
                          ) : null}
                          <small className="social-muted social-tag-reason">{entry.reason}</small>
                          {issue ? (
                            <small className="social-tag-issue" role="status">
                              {issue}
                            </small>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {proposal.segments.length ? (
                    <p className="social-muted social-tag-segments">
                      {t("Would also match: {p0}", {
                        p0: proposal.segments.map((segment) => segment.name).join(", "),
                      })}
                    </p>
                  ) : null}
                  {failure ? (
                    <InlineError className="social-tag-failure">
                      {t("Could not save: {p0}", { p0: failure })}
                    </InlineError>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="social-muted" role="status">
            {t("The AI found no tags to add. Your contacts stay as they are.")}
          </p>
        )}
        {result.unchangedRefs.length ? (
          <p className="social-muted">
            {result.unchangedRefs.length === 1
              ? t("1 contact has no suggestion.")
              : t("{p0} contacts have no suggestion.", { p0: result.unchangedRefs.length })}
          </p>
        ) : null}
        {result.notes.length ? (
          <Notice kind="info" title={t("Notes from the AI")}>
            <ul>
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <ComposerActions className="social-tag-actions">
          <Button variant="ghost" type="button" disabled={locked || applying} onClick={discard}>
            {t("Discard suggestions")}
          </Button>
          {proposed ? (
            <Button
              variant="secondary"
              type="button"
              disabled={locked || applying}
              onClick={() => setReview(keepAllValid(result, review))}
            >
              {t("Keep all valid")}
            </Button>
          ) : null}
          {proposed ? (
            <Button
              type="button"
              loading={applying}
              disabled={locked || !pendingCount}
              onClick={apply}
            >
              {mode === "import"
                ? pendingCount === 1
                  ? t("Add 1 tag to the import draft")
                  : t("Add {p0} tags to the import draft", { p0: pendingCount })
                : pendingCount === 1
                  ? t("Save 1 tag")
                  : t("Save {p0} tags", { p0: pendingCount })}
            </Button>
          ) : null}
        </ComposerActions>
      </div>
    );
  }

  const overCap = scope ? scope.refs.length > CONTACT_TAG_REQUEST_MAX : false;
  return (
    <form
      className="social-tag-ask"
      aria-label={t("Ask AI to suggest tags")}
      onSubmit={(event) => {
        event.preventDefault();
        if (canAsk) ask();
      }}
    >
      {scopes.length > 1 ? (
        <label className="social-tag-field">
          {t("Account and project")}
          <SearchableSelect
            disabled={locked || working}
            value={scope?.key ?? ""}
            label={t("Account and project")}
            options={scopes.map((item) => ({
              value: item.key,
              label: `${accounts.find((entry) => entry.id === item.accountId)?.name ?? t("Account not found")} · ${projectName(item.projectId)} (${item.refs.length})`,
            }))}
            onChange={setScopeKey}
            searchLocale={getLocale()}
          />
        </label>
      ) : (
        <p className="social-assistant-context" aria-label={t("What the AI will use")}>
          <span>
            {t("Account")}: <strong>{account?.name ?? t("None selected")}</strong>
          </span>
          <span>
            {t("Project")}:{" "}
            <strong>{scope ? projectName(scope.projectId) : t("No project selected")}</strong>
          </span>
        </p>
      )}
      <p className="social-assistant-context">
        <span>
          {t("Contacts")}: <strong>{asked.length}</strong>
        </span>
        <span>
          {t("Text model")}: <strong>{model}</strong>
        </span>
      </p>
      <TextareaField
        label={t("What should the tags describe? (optional)")}
        rows={2}
        value={instructions}
        disabled={locked || working}
        maxLength={INSTRUCTIONS_MAX}
        placeholder={t("E.g. mark journalists as press and use the language as a tag")}
        onChange={(event) => setInstructions(event.target.value)}
      />
      {overCap ? (
        <p className="social-assistant-note">
          {t("One request labels the first {p0} of {p1} contacts. Ask again for the rest.", {
            p0: CONTACT_TAG_REQUEST_MAX,
            p1: scope?.refs.length ?? 0,
          })}
        </p>
      ) : null}
      {blocked ? (
        <p className="social-assistant-reason" role="status">
          {blocked}{" "}
          {agentState === "missing" && onOpenSettings ? (
            <Button variant="link" type="button" onClick={onOpenSettings}>
              {t("Open settings")}
            </Button>
          ) : null}
        </p>
      ) : (
        <p className="social-assistant-note">
          {t(
            "The names, handles, languages and tags of these contacts are sent to {p0}. Nothing is saved, and consent and opt-out are not touched.",
            { p0: agent ? agentLabel(agent) : t("the text agent") },
          )}
        </p>
      )}
      {error ? (
        <Notice kind="error" title={t("The AI could not suggest tags")}>
          <p>{error}</p>
        </Notice>
      ) : null}
      <ComposerActions className="social-tag-actions">
        {working ? (
          <>
            <span role="status" className="social-assistant-progress">
              {t("Asking {p0}… nothing is saved yet.", { p0: model })}
            </span>
            <Button variant="ghost" type="button" onClick={stop}>
              {t("Stop waiting")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" type="button" disabled={locked} onClick={onClose}>
            {t("Close")}
          </Button>
        )}
        <Button
          type="button"
          loading={working}
          disabled={!canAsk}
          startIcon={<Sparkles aria-hidden="true" />}
          onClick={ask}
        >
          {error ? t("Try again") : t("Suggest tags")}
        </Button>
      </ComposerActions>
    </form>
  );
}
