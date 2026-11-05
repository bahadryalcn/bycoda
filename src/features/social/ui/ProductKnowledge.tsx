import { InlineError } from "../../../shared/ui/InlineError";
import { useContext as useSocialContext, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Select } from "../../../shared/ui/Select";
import { Sparkles } from "../../../shared/ui/icons";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialClient } from "../model/socialClient";
import type { SocialAccount, SocialPolicy, SocialProjectProfile } from "../model/social";
import { assistantEligibleAccounts } from "../model/socialAssistant";
import { socialQueryScope } from "../model/socialQuery";
import type { FactSuggestResult } from "../model/socialSuggestions";
import {
  FACT_LIMIT,
  FactSuggestions,
  candidateBlock,
  candidateText,
  candidateTopic,
  visibleCandidates,
  type FactReview,
} from "./FactSuggestions";
import { Notice, SocialDialog, field, time, type Run } from "./socialShared";
import { useSocialPending } from "./useSocialPending";
import "./social-knowledge.css";

type ProfileDraft = {
  productName?: string;
  voice?: string;
  topic?: string;
  text?: string;
  source?: string;
  factId?: string;
  /** Source text, label and account of the "Suggest facts" form, kept per project like the other drafts. */
  sourceText?: string;
  sourceLabel?: string;
  accountId?: string;
  /** Accepted suggestions: draft rows that are not verified until the owner saves them. */
  added?: AddedFact[];
};

/** A fact row in the editor draft; it becomes a saved, verified fact only through `profiles.save`. */
type AddedFact = { id: string; candidateId: string; topic: string; text: string; source: string };

/** State of the "Suggest facts from text" flow for one project. */
type Suggest = {
  projectId: string;
  working: boolean;
  error: string;
  /** One request id per ask; a retry after an error with unchanged input reuses it. */
  attempt?: { id: string; key: string };
  review?: FactReview;
};
const SOURCE_TEXT_MAX = 20000;
const SOURCE_LABEL_MAX = 200;

/**
 * Product profile, brand voice and verified facts as one managed knowledge area. The daily
 * content screen shows only a summary row; the forms open on demand, keep their drafts while
 * closed, and a project intent (from an account or a rule blocker) opens them in context.
 */
export function ProductKnowledge({
  client,
  profiles,
  projects,
  initialProject,
  projectIntent,
  run,
  accounts = [],
  hostOnline = true,
}: {
  client: SocialClient;
  profiles: SocialProjectProfile[];
  projects: HostProject[];
  initialProject?: string;
  projectIntent?: { projectId: string; token: number };
  run: Run;
  /** Accounts whose text agent may read pasted source text; only those with draft access to the project are offered. */
  accounts?: SocialAccount[];
  hostOnline?: boolean;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [projectId, setProjectId] = useState(initialProject ?? projects[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [seenIntent, setSeenIntent] = useState<number>();
  // A project intent is a one-shot request identified by its token.
  if (projectIntent && projectIntent.token !== seenIntent) {
    setSeenIntent(projectIntent.token);
    if (projects.some((project) => project.id === projectIntent.projectId)) {
      setProjectId(projectIntent.projectId);
      setOpen(true);
    }
  }
  const [drafts, setDrafts] = useState<Record<string, ProfileDraft>>({});
  const [addFact, setAddFact] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggest, setSuggest] = useState<Suggest>({ projectId: "", working: false, error: "" });
  const askToken = useRef(0);
  const closing = useRef(false);
  useEffect(() => {
    if (!open && closing.current) {
      closing.current = false;
      trigger.current?.focus();
    }
  }, [open]);
  const activeProject = projects.some((project) => project.id === projectId)
    ? projectId
    : (projects[0]?.id ?? "");
  const profile = profiles.find((item) => item.projectId === activeProject);
  const draft = drafts[activeProject] ?? {};
  const productName = draft.productName ?? profile?.productName ?? "";
  const voice = draft.voice ?? profile?.brandVoice ?? "";
  const updateDraft = (change: ProfileDraft) =>
    setDrafts((current) => ({
      ...current,
      [activeProject]: { ...current[activeProject], ...change },
    }));
  const save = (facts: SocialProjectProfile["facts"]) =>
    client.request("profiles.save", {
      projectId: activeProject,
      productName,
      brandVoice: voice,
      facts,
    });
  const projectName = projects.find((project) => project.id === activeProject)?.name;
  const factCount = profile?.facts.length ?? 0;
  const profileSet = !!profile?.productName.trim() && !!profile.brandVoice.trim();
  const editing = !!draft.factId;
  const unsavedProfile =
    (draft.productName !== undefined && draft.productName !== (profile?.productName ?? "")) ||
    (draft.voice !== undefined && draft.voice !== (profile?.brandVoice ?? ""));
  const added = draft.added ?? [];
  // Suggestions belong to one project: leaving it clears them (the typed source text is a draft and stays).
  if (suggest.projectId !== activeProject)
    setSuggest({ projectId: activeProject, working: false, error: "" });
  const review = suggest.projectId === activeProject ? suggest.review : undefined;
  const openSuggestions = review
    ? visibleCandidates(review).filter((candidate) => !review.accepted.includes(candidate.id))
        .length
    : 0;
  const sourceText = draft.sourceText ?? "";
  const sourceLabel = draft.sourceLabel ?? "";
  const eligible = assistantEligibleAccounts(accounts, activeProject);
  const accountId = eligible.some((account) => account.id === draft.accountId)
    ? (draft.accountId ?? "")
    : (eligible[0]?.id ?? "");
  const accountName =
    accounts.find((account) => account.id === accountId)?.name ?? t("Removed account");
  // The text agent the Host uses is the effective policy of the chosen account.
  const policy = useQuery({
    queryKey: [...socialQueryScope(client), "facts-policy", accountId],
    queryFn: () => client.request<{ effective: SocialPolicy }>("policy.get", { accountId }),
    enabled: open && !!accountId && hostOnline,
    staleTime: 30_000,
  });
  const agent = policy.data?.effective.agent;
  const agentLabel = agent
    ? `${agent.provider}${agent.model ? ` · ${agent.model}` : ""}`
    : policy.isPending && accountId && hostOnline
      ? t("Checking…")
      : t("Not set");
  const blocked = !activeProject
    ? t("Select a project first.")
    : !hostOnline
      ? t("The computer is offline.")
      : !eligible.length
        ? t("No account has draft access to this project. Grant it in Accounts first.")
        : policy.isSuccess && !agent
          ? t("Choose a text agent in Settings first.")
          : "";
  const canAsk =
    !blocked && !!sourceText.trim() && !!sourceLabel.trim() && !suggest.working && !socialLocked;
  const slotsLeft = FACT_LIMIT - factCount - added.length;
  const duplicateTopic = (factId: string) =>
    profile?.facts.find((fact) => fact.id === factId)?.topic ?? factId;
  const patchReview = (change: (value: FactReview) => FactReview) =>
    setSuggest((current) =>
      current.review ? { ...current, review: change(current.review) } : current,
    );
  const ask = async () => {
    const forProject = activeProject;
    const input = {
      accountId,
      projectId: forProject,
      sourceLabel: sourceLabel.trim(),
      sourceText: sourceText.trim(),
    };
    const key = JSON.stringify(input);
    // One request id per ask: a retry after an error with the same input reuses it, a new ask does not.
    const requestId =
      suggest.error && suggest.attempt?.key === key ? suggest.attempt.id : crypto.randomUUID();
    const mine = ++askToken.current;
    setSuggest({
      projectId: forProject,
      working: true,
      error: "",
      attempt: { id: requestId, key },
    });
    try {
      const result = await client.request<FactSuggestResult>("facts.suggest", input, requestId);
      if (mine !== askToken.current) return;
      setSuggest((current) =>
        current.projectId === forProject && current.working
          ? {
              projectId: forProject,
              working: false,
              error: "",
              review: {
                result: {
                  ...result,
                  suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
                },
                edits: {},
                hidden: [],
                accepted: [],
              },
            }
          : current,
      );
    } catch (cause) {
      if (mine !== askToken.current) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setSuggest((current) =>
        current.projectId === forProject && current.working
          ? { ...current, working: false, error: message }
          : current,
      );
    }
  };
  // Stops waiting. `facts.suggest` stores nothing, so a late answer is ignored.
  const stopWaiting = () => {
    askToken.current++;
    setSuggest((current) => ({ ...current, working: false, error: "", attempt: undefined }));
  };
  const acceptCandidates = (ids: string[]) => {
    if (!review) return;
    let room = slotsLeft;
    const rows: AddedFact[] = [];
    for (const id of ids) {
      const candidate = review.result.suggestions.find((item) => item.id === id);
      if (!candidate || review.accepted.includes(id) || review.hidden.includes(id)) continue;
      if (candidateBlock(review, candidate, room, duplicateTopic)) continue;
      rows.push({
        id: crypto.randomUUID(),
        candidateId: id,
        topic: candidateTopic(review, candidate).trim(),
        text: candidateText(review, candidate).trim(),
        source: `Suggested from "${review.result.sourceLabel.slice(0, SOURCE_LABEL_MAX)}"; accepted by owner`,
      });
      room--;
    }
    if (!rows.length) return;
    updateDraft({ added: [...added, ...rows] });
    patchReview((value) => ({
      ...value,
      accepted: [...value.accepted, ...rows.map((row) => row.candidateId)],
    }));
  };
  const removeAdded = (row: AddedFact) => {
    updateDraft({ added: added.filter((item) => item.id !== row.id) });
    patchReview((value) => ({
      ...value,
      accepted: value.accepted.filter((id) => id !== row.candidateId),
    }));
  };
  // The only write: the owner's explicit save sends the saved facts plus the added rows through profiles.save.
  const saveAdded = () => {
    const forProject = activeProject;
    const rows = added;
    void (async () => {
      const ok = await pendingUi.run("project-profile.save-added-facts", () =>
        run(
          () =>
            save([
              ...(profile?.facts ?? []),
              ...rows.map((row) => ({
                id: row.id,
                topic: row.topic,
                text: row.text,
                source: row.source,
                verifiedAt: Date.now(),
              })),
            ]),
          t("Added facts saved as verified product facts."),
        ),
      );
      if (!ok) return;
      setDrafts((current) => ({
        ...current,
        [forProject]: {
          ...current[forProject],
          added: (current[forProject]?.added ?? []).filter(
            (item) => !rows.some((row) => row.id === item.id),
          ),
        },
      }));
      setSuggest((current) =>
        current.projectId === forProject && current.review
          ? {
              ...current,
              review: {
                ...current.review,
                accepted: current.review.accepted.filter(
                  (id) => !rows.some((row) => row.candidateId === id),
                ),
                hidden: [...current.review.hidden, ...rows.map((row) => row.candidateId)],
              },
            }
          : current,
      );
    })();
  };
  return (
    <>
      <div className="social-knowledge-row" aria-label={t("Product knowledge")}>
        <div>
          <strong>{t("Product knowledge")}</strong>
          <small>
            {!projects.length
              ? t("No project found")
              : profile
                ? `${projectName ?? ""} · ${profile.productName || t("No product name")} · ${t("Verified facts")}: ${factCount}${profileSet ? "" : ` · ${t("Brand voice or name missing")}`}`
                : `${projectName ?? ""} · ${t("No product profile yet. AI and automatic replies have no verified facts to use.")}`}
            {unsavedProfile || editing || added.length ? ` · ${t("Unsaved changes")}` : ""}
            {openSuggestions
              ? ` · ${t("{p0} suggestions to review", { p0: openSuggestions })}`
              : ""}
          </small>
        </div>
        <Button
          ref={trigger}
          variant="secondary"
          size="sm"
          type="button"
          disabled={socialLocked || !projects.length}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {t("Manage")}
        </Button>
      </div>
      {open ? (
        <SocialDialog
          title={t("Product knowledge")}
          description={t(
            "Verified product facts are the only facts AI drafts and automatic replies may rely on.",
          )}
          size="lg"
          onClose={() => {
            closing.current = true;
            setOpen(false);
          }}
        >
          <div className="social-view social-knowledge">
            <label className="social-knowledge-field">
              {t("Project")}
              <SearchableSelect
                value={activeProject}
                disabled={socialLocked || !projects.length}
                label={t("Project")}
                options={projects.map((project) => ({
                  value: project.id,
                  label: project.name || project.cwd,
                }))}
                onChange={(nextValue) => {
                  askToken.current++;
                  setProjectId(nextValue);
                }}
                searchLocale={getLocale()}
              />
            </label>
            <form
              className="social-form"
              onSubmit={(event) => {
                field(event);
                void pendingUi.run("project-profile.save-product-profile", () =>
                  run(() => save(profile?.facts ?? []), t("Product profile saved.")),
                );
              }}
            >
              <h3>{t("Product profile")}</h3>
              <TextField
                disabled={socialLocked}
                label={t("Product name")}
                required
                maxLength={200}
                value={productName}
                onChange={(event) => updateDraft({ productName: event.target.value })}
              />
              <TextField
                disabled={socialLocked}
                label={t("Brand voice")}
                required
                maxLength={1000}
                value={voice}
                placeholder={t("E.g. short, clear and friendly")}
                onChange={(event) => updateDraft({ voice: event.target.value })}
              />
              <div className="social-actions">
                <Button
                  loading={pendingUi.is("project-profile.save-product-profile")}
                  type="submit"
                  variant="secondary"
                  disabled={socialLocked || !activeProject}
                >
                  {t("Save product profile")}
                </Button>
              </div>
            </form>
            <section className="social-knowledge-facts" aria-label={t("Verified facts")}>
              <div className="social-knowledge-heading">
                <h3>
                  {t("Verified facts")} · {factCount}
                </h3>
                <div className="social-knowledge-heading-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={socialLocked || (!editing && factCount >= 100)}
                    aria-expanded={addFact || editing}
                    onClick={() => setAddFact(!addFact)}
                  >
                    {t("Add verified fact")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={socialLocked}
                    aria-expanded={suggestOpen}
                    startIcon={<Sparkles aria-hidden="true" />}
                    onClick={() => setSuggestOpen(!suggestOpen)}
                  >
                    {t("Suggest facts from text")}
                  </Button>
                </div>
              </div>
              {!profile?.facts.length ? (
                <p className="social-muted">
                  {t("No saved product facts. Add a verified fact to prepare automatic replies.")}
                </p>
              ) : (
                <ul className="social-knowledge-list">
                  {profile.facts.map((fact) => (
                    <li key={fact.id}>
                      <div>
                        <strong>{fact.topic}</strong>
                        <span>{fact.text}</span>
                        <small>
                          {fact.source} · {time(fact.verifiedAt)}
                        </small>
                      </div>
                      <Button
                        disabled={socialLocked}
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => {
                          setAddFact(true);
                          updateDraft({
                            factId: fact.id,
                            topic: fact.topic,
                            text: fact.text,
                            source: fact.source,
                          });
                        }}
                      >
                        {t("Edit fact")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {addFact || editing ? (
                <form
                  className="social-form"
                  onSubmit={(event) => {
                    field(event);
                    const fact = {
                      id: draft.factId ?? crypto.randomUUID(),
                      topic: draft.topic ?? "",
                      text: draft.text ?? "",
                      source: draft.source ?? "",
                      verifiedAt: Date.now(),
                    };
                    const facts = draft.factId
                      ? (profile?.facts ?? []).map((item) =>
                          item.id === draft.factId ? fact : item,
                        )
                      : [...(profile?.facts ?? []), fact];
                    void (async () => {
                      if (
                        await pendingUi.run("project-profile.save-public-fact", () =>
                          run(() => save(facts), t("Verified product fact saved.")),
                        )
                      ) {
                        updateDraft({ topic: "", text: "", source: "", factId: undefined });
                        setAddFact(false);
                      }
                    })();
                  }}
                >
                  <h3>{editing ? t("Edit verified fact") : t("Add verified fact")}</h3>
                  {!productName.trim() || !voice.trim() ? (
                    <Notice kind="info">
                      {t("Save the product name and brand voice above before adding facts.")}
                    </Notice>
                  ) : null}
                  <TextField
                    disabled={socialLocked}
                    label={t("Fact topic")}
                    required
                    maxLength={200}
                    value={draft.topic ?? ""}
                    onChange={(event) => updateDraft({ topic: event.target.value })}
                  />
                  <TextareaField
                    disabled={socialLocked}
                    label={t("Verified, announceable fact")}
                    required
                    maxLength={4000}
                    value={draft.text ?? ""}
                    onChange={(event) => updateDraft({ text: event.target.value })}
                  />
                  <TextField
                    disabled={socialLocked}
                    label={t("Verification source")}
                    required
                    maxLength={1000}
                    value={draft.source ?? ""}
                    onChange={(event) => updateDraft({ source: event.target.value })}
                  />
                  <div className="social-actions">
                    <Button
                      loading={pendingUi.is("project-profile.save-public-fact")}
                      type="submit"
                      variant="secondary"
                      disabled={
                        socialLocked ||
                        !activeProject ||
                        !productName.trim() ||
                        !voice.trim() ||
                        (!draft.factId && factCount >= 100)
                      }
                    >
                      {t("Save public fact")}
                    </Button>
                    <Button
                      disabled={socialLocked}
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        updateDraft({ topic: "", text: "", source: "", factId: undefined });
                        setAddFact(false);
                      }}
                    >
                      {editing ? t("Stop editing") : t("Cancel")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </section>
            {suggestOpen ? (
              <section
                className="social-knowledge-suggest"
                aria-label={t("Suggest facts from text")}
              >
                <form
                  className="social-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (canAsk) void ask();
                  }}
                >
                  <TextareaField
                    label={t("Source text")}
                    required
                    maxLength={SOURCE_TEXT_MAX}
                    disabled={socialLocked || suggest.working}
                    value={sourceText}
                    description={t("{p0} of {p1} characters", {
                      p0: sourceText.length,
                      p1: SOURCE_TEXT_MAX,
                    })}
                    onChange={(event) => updateDraft({ sourceText: event.target.value })}
                  />
                  <TextField
                    label={t("Source label")}
                    required
                    maxLength={SOURCE_LABEL_MAX}
                    disabled={socialLocked || suggest.working}
                    value={sourceLabel}
                    placeholder={t("E.g. Pricing page, pasted 2026-10-30")}
                    onChange={(event) => updateDraft({ sourceLabel: event.target.value })}
                  />
                  <Select
                    label={t("Account")}
                    visibleLabel
                    value={accountId}
                    disabled={socialLocked || suggest.working || !eligible.length}
                    options={eligible.map((account) => ({
                      value: account.id,
                      label: account.name,
                    }))}
                    onValueChange={(value) => updateDraft({ accountId: value })}
                  />
                  {blocked ? (
                    <p className="social-muted" role="status">
                      {blocked}
                    </p>
                  ) : suggest.working ? (
                    <p className="social-muted" role="status">
                      {t("Asking {p0}… nothing is saved yet.", { p0: agentLabel })}
                    </p>
                  ) : (
                    <p className="social-muted">
                      {agent
                        ? t("{p0} reads this text and proposes facts. Nothing is saved.", {
                            p0: agentLabel,
                          })
                        : t("The text agent is checked when you ask. Nothing is saved.")}
                    </p>
                  )}
                  {review && !suggest.working ? (
                    <p className="social-muted">
                      {t("Asking again replaces the suggestions below.")}
                    </p>
                  ) : null}
                  {suggest.error ? <InlineError>{suggest.error}</InlineError> : null}
                  <div className="social-actions">
                    <Button
                      type="submit"
                      loading={suggest.working}
                      disabled={!canAsk}
                      startIcon={<Sparkles aria-hidden="true" />}
                    >
                      {suggest.error ? t("Try again") : t("Suggest facts")}
                    </Button>
                    {suggest.working ? (
                      <Button variant="ghost" type="button" onClick={stopWaiting}>
                        {t("Stop waiting")}
                      </Button>
                    ) : null}
                  </div>
                </form>
                {review ? (
                  <FactSuggestions
                    review={review}
                    projectName={projectName ?? ""}
                    accountName={accountName}
                    locked={socialLocked}
                    slotsLeft={slotsLeft}
                    duplicateTopic={duplicateTopic}
                    onEdit={(id, change) =>
                      patchReview((value) => ({
                        ...value,
                        edits: { ...value.edits, [id]: { ...value.edits[id], ...change } },
                      }))
                    }
                    onAccept={acceptCandidates}
                    onAcceptAll={acceptCandidates}
                    onReject={(id) =>
                      patchReview((value) => ({ ...value, hidden: [...value.hidden, id] }))
                    }
                    onRejectAll={() =>
                      setSuggest((current) => ({ ...current, review: undefined, error: "" }))
                    }
                  />
                ) : null}
              </section>
            ) : null}
            {added.length ? (
              <section className="social-knowledge-added" aria-label={t("Added - save to verify")}>
                <div className="social-knowledge-heading">
                  <h3>
                    {t("Added - save to verify")} · {added.length}
                  </h3>
                  <Button
                    size="sm"
                    type="button"
                    loading={pendingUi.is("project-profile.save-added-facts")}
                    disabled={
                      socialLocked || !activeProject || !productName.trim() || !voice.trim()
                    }
                    onClick={saveAdded}
                  >
                    {t("Save added facts")}
                  </Button>
                </div>
                {!productName.trim() || !voice.trim() ? (
                  <Notice kind="info">
                    {t("Save the product name and brand voice above before adding facts.")}
                  </Notice>
                ) : null}
                <ul className="social-knowledge-added-list">
                  {added.map((row) => (
                    <li key={row.id}>
                      <div>
                        <strong>{row.topic}</strong>
                        <span>{row.text}</span>
                        <small>{row.source}</small>
                      </div>
                      <Button
                        disabled={socialLocked}
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => removeAdded(row)}
                      >
                        {t("Remove")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </SocialDialog>
      ) : null}
    </>
  );
}
