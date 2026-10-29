import { useContext, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Sparkles } from "../../../shared/ui/icons";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialAccount, SocialPolicy, SocialProjectProfile } from "../model/social";
import {
  assistantBaseConfig,
  assistantEligibleAccounts,
  proposalChangedKeys,
  proposalRequestId,
  proposalRisks,
  weeklyPostBound,
} from "../model/socialAssistant";
import type { SocialClient } from "../model/socialClient";
import { socialQueryScope } from "../model/socialQuery";
import type { ProgramConfig, SocialProgram } from "../model/socialProgram";
import {
  PROGRAM_SUGGESTION_FIELD_LABELS,
  programConfigFromProgram,
  summarizeProgramSuggestion,
} from "../model/socialProgramForm";
import { SocialBusyContext } from "./socialContext";
import { SocialMultiSelect } from "./SocialMultiSelect";
import { Notice, names, type Run } from "./socialShared";
import "./social-assistant.css";

type Proposal = {
  config: ProgramConfig;
  base: ProgramConfig;
  questions: string[];
  requestId: string;
  /** Revision the suggestion was prepared against (refinement only). */
  revision?: number;
};
type Phase = "idle" | "working" | "proposal" | "saved";

/**
 * Natural-language preparation bound to the owner's selected Host/project/accounts. It reuses the
 * Host's `programs.suggest` (read-only, nothing stored) and `programs.configure` (always saved
 * paused). Accepting creates or revises a real campaign record that continues in the manual
 * screens; it never activates, sends or changes credentials.
 */
export function SocialAssistant({
  client,
  accounts,
  projects,
  profiles,
  machineLabel,
  projectId,
  program,
  run,
  collapsible = false,
  onOpenProgram,
  onOpenSettings,
}: {
  client: SocialClient;
  accounts: SocialAccount[];
  projects: HostProject[];
  profiles: SocialProjectProfile[];
  machineLabel: string;
  /** The owner's current project; the assistant never picks another one on its own. */
  projectId: string;
  /** A selected saved campaign the request refines instead of creating a new one. */
  program?: SocialProgram;
  run: Run;
  collapsible?: boolean;
  onOpenProgram: (id: string) => void;
  onOpenSettings?: () => void;
}) {
  const locale = useLocale();
  const locked = useContext(SocialBusyContext);
  const [open, setOpen] = useState(!collapsible);
  const [request, setRequest] = useState("");
  const [project, setProject] = useState(program?.projectId ?? projectId);
  const [picked, setPicked] = useState<string[] | undefined>();
  const [useFacts, setUseFacts] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<Proposal>();
  const [saved, setSaved] = useState<{ id: string; name: string }>();
  const token = useRef(0);
  const effectiveProject = program?.projectId ?? project;
  const eligible = assistantEligibleAccounts(accounts, effectiveProject);
  const accountIds = program
    ? program.accountIds
    : (picked ?? (eligible.length === 1 ? [eligible[0].id] : [])).filter((id) =>
        eligible.some((account) => account.id === id),
      );
  const profile = profiles.find((item) => item.projectId === effectiveProject);
  const projectName =
    projects.find((item) => item.id === effectiveProject)?.name ?? t("No project selected");
  const accountName = (id: string) => accounts.find((item) => item.id === id)?.name ?? t("Removed account");
  // The text agent the Host will use is the effective policy of the first selected account.
  const policyQuery = useQuery({
    queryKey: [...socialQueryScope(client), "assistant-policy", accountIds[0] ?? ""],
    queryFn: () =>
      client.request<{ effective: SocialPolicy }>("policy.get", { accountId: accountIds[0] }),
    enabled: open && accountIds.length > 0 && !!request.trim(),
    staleTime: 30_000,
  });
  const agent = policyQuery.data?.effective.agent;
  const agentReady = !!agent;
  const agentLabel = agent
    ? `${agent.provider}${agent.model ? ` · ${agent.model}` : ""}`
    : !request.trim()
      ? t("Checked when you ask")
      : policyQuery.isPending && accountIds.length
        ? t("Checking…")
        : t("Not set");
  const reasonBlocked = !request.trim()
    ? ""
    : !effectiveProject
      ? t("Select a project first.")
      : !accountIds.length
        ? t("Select at least one account with draft access.")
        : policyQuery.isSuccess && !agentReady
          ? t("Choose a text agent in Settings before the assistant can draft.")
          : "";
  const canAsk = !!request.trim() && !reasonBlocked && phase !== "working" && !locked;

  const ask = async () => {
    const current = ++token.current;
    setPhase("working");
    setError("");
    setSaved(undefined);
    try {
      const base = program
        ? programConfigFromProgram(program)
        : assistantBaseConfig({
            request,
            context: {
              machineLabel,
              projectId: effectiveProject,
              projectName,
              accountIds,
              profile,
            },
            language: getLocale().slice(0, 2),
            useFacts: useFacts && !!profile?.facts.length,
          });
      const result = await client.request<{ config: ProgramConfig; questions?: string[] }>(
        "programs.suggest",
        { config: base, instructions: request.trim() },
      );
      if (current !== token.current) return;
      setProposal({
        config: result.config,
        base,
        questions: result.questions ?? [],
        requestId: proposalRequestId(),
        revision: program?.revision,
      });
      setPhase("proposal");
    } catch (cause) {
      if (current !== token.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("idle");
    }
  };
  // Stops waiting. `programs.suggest` stores nothing, so a late answer is simply ignored.
  const cancel = () => {
    token.current++;
    setPhase("idle");
    setError("");
  };
  const discard = () => {
    token.current++;
    setProposal(undefined);
    setPhase("idle");
  };
  const edit = (change: (config: ProgramConfig) => ProgramConfig) =>
    setProposal((current) => (current ? { ...current, config: change(current.config) } : current));
  const accept = async () => {
    if (!proposal) return;
    let result: SocialProgram | undefined;
    const ok = await run(async () => {
      // One request id per proposal: a retry after an unclear result returns the first receipt.
      result = await client.request<SocialProgram>(
        "programs.configure",
        {
          config: proposal.config,
          ...(program ? { id: program.id, expectedRevision: proposal.revision } : {}),
        },
        proposal.requestId,
      );
    }, program ? t("Campaign revised from the AI suggestion. It is paused until you review it.") : t("Paused campaign saved from the AI suggestion. Review it before activating."));
    if (ok && result) {
      setSaved({ id: result.id, name: result.name });
      setProposal(undefined);
      setPhase("saved");
      setRequest("");
    }
  };
  const risks = proposal ? proposalRisks(proposal.config, proposal.base) : [];
  const changedKeys = proposal
    ? proposalChangedKeys(proposal.config, program ? proposal.base : undefined).filter(
        (key) => !["limits", "textAgent", "poolCampaignIds", "mediaOverrides", "youtube"].includes(key),
      )
    : [];
  const summaryContext = { locale, snapshot: { accounts, profiles, campaigns: [] }, projects };
  const weekly = proposal ? weeklyPostBound(proposal.config) : undefined;

  if (!open)
    return (
      <div className="social-assistant" data-collapsed="">
        <Button variant="secondary" size="sm" type="button" disabled={locked} onClick={() => setOpen(true)} startIcon={<Sparkles aria-hidden="true" />}>
          {program ? t("Ask AI to change this campaign") : t("Ask AI to prepare content")}
        </Button>
      </div>
    );
  return (
    <section
      className="social-assistant"
      aria-label={program ? t("AI help for this campaign") : t("AI content assistant")}
    >
      <form
        className="social-assistant-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canAsk) void ask();
        }}
      >
        <TextareaField
          label={program ? t("What should change in this campaign?") : t("What should the AI prepare?")}
          rows={1}
          value={request}
          disabled={locked || phase === "working"}
          maxLength={2000}
          placeholder={
            program
              ? t("E.g. move posts to the evening and shorten the text")
              : t("E.g. a week of posts introducing the new release")
          }
          onChange={(event) => setRequest(event.target.value)}
        />
        <p className="social-assistant-context" aria-label={t("What the AI will use")}>
          <span>
            {t("Computer")}: <strong>{machineLabel}</strong>
          </span>
          <span>
            {t("Project")}: <strong>{projectName}</strong>
          </span>
          <span>
            {t("Accounts")}:{" "}
            <strong>
              {accountIds.length ? accountIds.map(accountName).join(", ") : t("None selected")}
            </strong>
          </span>
          <span>
            {t("Text model")}: <strong>{agentLabel}</strong>
          </span>
        </p>
        {!program ? (
          <details className="social-assistant-scope">
            <summary>{t("Change project or accounts")}</summary>
            <div className="social-assistant-scope-fields">
              <SearchableSelect
                label={t("Project")}
                value={project}
                disabled={locked || phase === "working"}
                options={projects.map((item) => ({ value: item.id, label: item.name || item.cwd }))}
                onChange={(value) => {
                  setProject(value);
                  setPicked(undefined);
                }}
                searchLocale={getLocale()}
              />
              <SocialMultiSelect
                label={t("Accounts")}
                selected={accountIds}
                onChange={setPicked}
                options={accounts.map((account) => ({
                  value: account.id,
                  label: `${names[account.platform]} · ${account.name}`,
                  description: account.grants[effectiveProject]?.includes("draft")
                    ? undefined
                    : t("Draft access to the selected project is required."),
                  disabled: !account.grants[effectiveProject]?.includes("draft"),
                }))}
              />
              <label className="social-assistant-check">
                <Checkbox
                  checked={useFacts && !!profile?.facts.length}
                  disabled={locked || !profile?.facts.length}
                  onChange={(event) => setUseFacts(event.target.checked)}
                />
                {profile?.facts.length
                  ? t("Use the {p0} verified facts of this project", { p0: profile.facts.length })
                  : t("No verified facts saved for this project")}
              </label>
            </div>
          </details>
        ) : null}
        {reasonBlocked ? (
          <p className="social-assistant-reason" role="status">
            {reasonBlocked}{" "}
            {onOpenSettings && policyQuery.isSuccess && !agentReady ? (
              <Button variant="link" type="button" onClick={onOpenSettings}>
                {t("Open settings")}
              </Button>
            ) : null}
          </p>
        ) : null}
        <div className="social-assistant-actions">
          <Button type="submit" loading={phase === "working"} disabled={!canAsk} startIcon={<Sparkles aria-hidden="true" />}>
{program ? t("Suggest changes") : t("Prepare proposal")}
          </Button>
          {phase === "working" ? (
            <>
              <Button variant="ghost" type="button" onClick={cancel}>
                {t("Stop waiting")}
              </Button>
              <span role="status" className="social-assistant-progress">
                {t("Asking {p0}… nothing is saved yet.", { p0: agentLabel })}
              </span>
            </>
          ) : collapsible ? (
            <Button variant="ghost" type="button" disabled={locked} onClick={() => setOpen(false)}>
              {t("Close")}
            </Button>
          ) : null}
        </div>
        <p className="social-assistant-note">
          {t("The AI only proposes. Nothing is sent or activated, and credentials and approvals are not touched.")}
        </p>
      </form>
      {error ? (
        <Notice kind="error" title={t("The AI could not prepare a proposal")}>
          <p>{error}</p>
          <Button variant="secondary" size="sm" type="button" disabled={!canAsk} onClick={() => void ask()}>
            {t("Try again")}
          </Button>
        </Notice>
      ) : null}
      {saved ? (
        <Notice kind="success" title={t("Saved as a paused campaign")}>
          <p>{t("“{p0}” is saved and still paused. Review it, generate a sample and activate it from the campaign screen.", { p0: saved.name })}</p>
          <Button size="sm" type="button" onClick={() => onOpenProgram(saved.id)}>
            {t("Open campaign")}
          </Button>
        </Notice>
      ) : null}
      {proposal ? (
        <div className="social-assistant-review" role="group" aria-label={t("AI proposal review")}>
          <h3>{program ? t("Proposed changes") : t("Proposed paused campaign")}</h3>
          <p className="social-assistant-note">
            {program
              ? t("Saving replaces the unsent draft slots of “{p0}” and keeps it paused.", { p0: program.name })
              : t("Saving creates one campaign record in {p0}. It stays paused and nothing is sent.", { p0: projectName })}
          </p>
          {program ? null : <dl className="social-assistant-facts">
            <div>
              <dt>{t("Project")}</dt>
              <dd>{summarizeProgramSuggestion("projectId", proposal.config, summaryContext)}</dd>
            </div>
            <div>
              <dt>{t("Accounts")}</dt>
              <dd>
                {proposal.config.accountIds.length} · {summarizeProgramSuggestion("accountIds", proposal.config, summaryContext)}
              </dd>
            </div>
            <div>
              <dt>{t("Posts")}</dt>
              <dd>
                {proposal.config.totalPosts === null ? t("Unlimited") : proposal.config.totalPosts}
                {weekly !== undefined ? ` · ${t("up to {p0} per week", { p0: weekly })}` : ""}
              </dd>
            </div>
            <div>
              <dt>{t("When")}</dt>
              <dd className="whitespace-pre-line">{summarizeProgramSuggestion("schedule", proposal.config, summaryContext)}</dd>
            </div>
            <div>
              <dt>{t("Review steps")}</dt>
              <dd>{summarizeProgramSuggestion("approval", proposal.config, summaryContext)}</dd>
            </div>
          </dl>}
          {program ? (
            <dl className="social-assistant-facts" aria-label={t("Changed settings")}>
              {changedKeys.map((key) => (
                <div key={key}>
                  <dt>{t(PROGRAM_SUGGESTION_FIELD_LABELS[key] ?? key)}</dt>
                  <dd className="whitespace-pre-line">
                    <span className="social-assistant-before">
                      {summarizeProgramSuggestion(key, proposal.base, summaryContext)}
                    </span>
                    {"\n→ "}
                    {summarizeProgramSuggestion(key, proposal.config, summaryContext)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {risks.map((risk) => (
            <Notice key={risk.id} kind="warning">
              {risk.text}
            </Notice>
          ))}
          {proposal.questions.length ? (
            <Notice kind="info" title={t("The AI needs more information")}>
              <ul>
                {proposal.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <details className="social-assistant-edit">
            <summary>{t("Edit before saving")}</summary>
            <TextField
              label={t("Campaign name")}
              value={proposal.config.name}
              maxLength={200}
              disabled={locked}
              onChange={(event) => edit((config) => ({ ...config, name: event.target.value }))}
            />
            <TextField
              label={t("Topic")}
              value={proposal.config.brief.topic}
              maxLength={1000}
              disabled={locked}
              onChange={(event) =>
                edit((config) => ({ ...config, brief: { ...config.brief, topic: event.target.value } }))
              }
            />
            <TextareaField
              label={t("Description")}
              rows={4}
              value={proposal.config.brief.description}
              disabled={locked}
              onChange={(event) =>
                edit((config) => ({
                  ...config,
                  brief: { ...config.brief, description: event.target.value },
                }))
              }
            />
            <p className="social-assistant-note">
              {t("All other settings can be changed in the campaign screen after saving.")}
            </p>
          </details>
          <div className="social-assistant-actions">
            <Button
              type="button"
              disabled={locked || !proposal.config.name.trim() || !proposal.config.brief.topic.trim()}
              onClick={() => void accept()}
            >
              {program ? t("Save changes (stays paused)") : t("Save as paused campaign")}
            </Button>
            <Button variant="ghost" type="button" disabled={locked} onClick={discard}>
              {t("Discard proposal")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
