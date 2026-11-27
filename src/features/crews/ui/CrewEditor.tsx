import { useEffect, useRef, useState } from "react";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Heading } from "../../../shared/ui/Heading";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Modal } from "../../../shared/ui/Modal";
import { Text } from "../../../shared/ui/Text";
import { Plus } from "../../../shared/ui/icons";
import {
  defaultCrewPolicy,
  type CrewAgent,
  type CrewDefinition,
  type CrewPolicy,
} from "../model/crew";
import { useProjectCrews, type ProjectCrews } from "../model/crewClient";
import { handleErrorsFromHost } from "../model/crewLink";
import { teamTraits } from "../model/memberAvatars";
import {
  blankMember,
  rememberCrewDraft,
  emptyCrew,
  forgetCrewDraft,
  forgetSentCrewDraft,
  initialCrewDraft,
  policyErrors,
  starterRoster,
} from "../model/crewEditorDraft";
import {
  crewRosterIssues,
  crewRosterValid,
  memberFromLibrary,
  saveLibraryProfile,
} from "../model/crewRoster";
import { CrewAccessRow } from "./CrewAccessRow";
import { InlineError } from "../../../shared/ui/InlineError";
import { CrewAppearancePicker } from "./CrewAppearancePicker";
import { CrewEditorBulkBar } from "./CrewEditorBulkBar";
import { CrewEditorAddFooter, CrewEditorAddPage, liveAdditions } from "./CrewEditorAdd";
import { CrewEditorFooter } from "./CrewEditorFooter";
import { CrewEditorBanners, CrewEditorHeader } from "./CrewEditorParts";
import { CrewMemberDetail, type CrewBusyAction } from "./CrewMemberDetail";
import {
  CrewMemberTable,
  crewIssueSummary,
  crewSections,
  rosterSearchable,
} from "./CrewMemberTable";
import { CrewWorkingSettings } from "./CrewWorkingSettings";
import { useCrewAdditions } from "./useCrewAdditions";
import { useCrewAutosave } from "./useCrewAutosave";
import { useCrewRebase } from "./useCrewRebase";
import { usePageFocus } from "./usePageFocus";
import { useCrewLook } from "./useCrewLook";
import { describeRemoteError } from "../../connections/public/remoteFailure";

export { emptyCrew };

type Page = { kind: "team" } | { kind: "add" };

type EditorFocus = {
  crewId?: string;
  /** Opens an unsaved crew in this scope. */
  createScope?: "project" | "global";
  /** Opens an unsaved copy of a crew in the given scope. */
  copyOf?: { crewId: string; scope: "project" | "global" };
  onClose: () => void;
};

/** Creating and editing a crew share one autosaving dialog: look, name, access and the roster. */
export function CrewEditDialog({ cwd, ...focus }: { cwd: string } & EditorFocus) {
  useLocale();
  const state = useProjectCrews(cwd);
  if (!state.data)
    return (
      <Modal title={t("Crew")} size="sm" onClose={focus.onClose}>
        <div>
          {state.visibleError ? (
            <InlineError
              details={state.visibleError}
              retry={{ onRetry: () => void state.refetch(), label: t("Retry") }}
            />
          ) : (
            <Alert tone="info">{t("Loading crews…")}</Alert>
          )}
        </div>
      </Modal>
    );
  const draftKey = JSON.stringify([state.data.machine.id, state.data.project.id]);
  return (
    <ConnectedCrewEditor
      key={draftKey}
      cwd={cwd}
      draftKey={draftKey}
      state={state}
      data={state.data}
      {...focus}
    />
  );
}

function ConnectedCrewEditor({
  cwd,
  state,
  data,
  draftKey,
  crewId,
  createScope,
  copyOf,
  onClose,
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  data: ProjectCrews;
  draftKey: string;
} & EditorFocus) {
  useLocale();
  const [draft, setDraft] = useState<CrewDefinition | null>(() =>
    initialCrewDraft(data, draftKey, { crewId, createScope, copyOf }),
  );
  const [page, setPage] = useState<Page>({ kind: "team" });
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<CrewBusyAction>(null);
  const pending = pendingAction !== null;
  const gate = useRef(false);
  const [error, setError] = useState<{ summary: string; details: string } | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const body = useRef<HTMLFieldSetElement>(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const additions = useCrewAdditions(data);
  const [memberScope, setMemberScope] = useState<"project" | "global">("project");

  useEffect(() => {
    if (!draft) return;
    rememberCrewDraft(draftKey, draft, data.definitions, !!copyOf);
  }, [draftKey, draft, data.definitions, copyOf]);

  usePageFocus(page.kind, body);

  const latest = data.definitions.find((d) => d.id === draft?.id);
  useCrewRebase(draft, latest, setDraft);
  const missing = !!draft?.updatedAt && !latest;
  // Only a newer stored version is a conflict. Right after this editor saves, the listed
  // definition can still be the older copy until the crew list refetches.
  const conflict =
    !!draft?.updatedAt && (missing || (!!latest && latest.updatedAt > draft.updatedAt));
  const isNew = !!draft && !draft.updatedAt;
  const looks = useCrewLook({
    draft,
    setDraft,
    isNew,
    supported: data.identitySupported === true,
    copyOfId: copyOf?.crewId,
  });

  const issues = draft ? crewRosterIssues(draft) : undefined;
  const policy = policyErrors(draft?.policy ?? defaultCrewPolicy);
  const policyValid = !policy.maxParallel && !policy.maxAssignments && !policy.maxRunMinutes;
  const valid = !!issues && crewRosterValid(issues) && policyValid;

  const autosave = useCrewAutosave({
    draft,
    saved: latest,
    valid,
    enabled: !conflict && pendingAction !== "save",
    save: (definition) =>
      state.call<CrewDefinition>("crews.save", {
        definition: looks.outgoing(definition),
        expectedUpdatedAt: definition.updatedAt || undefined,
      }),
    onSaved: (returned, sent) => {
      setDraft((current) =>
        current?.id === returned.id ? looks.adopt(current, sent, returned) : current,
      );
      looks.saved(sent, returned);
      forgetSentCrewDraft(draftKey, sent);
    },
  });

  const act = async (action: Exclude<CrewBusyAction, null>, operation: () => Promise<void>) => {
    if (gate.current) return;
    gate.current = true;
    setPendingAction(action);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      const { message, details } = describeRemoteError(reason);
      setError({ summary: message, details });
    } finally {
      gate.current = false;
      setPendingAction(null);
    }
  };

  if (!draft || !issues)
    return (
      <Modal title={t("Crew")} size="sm" onClose={onClose}>
        <div>
          <Alert tone="info">{t("This crew is no longer available.")}</Alert>
        </div>
      </Modal>
    );

  const { livePicked, unfinished } = liveAdditions(data, additions);
  const update = (
    patch: Partial<CrewDefinition> | ((current: CrewDefinition) => Partial<CrewDefinition>),
  ) => {
    setDraft((current) =>
      current ? { ...current, ...(typeof patch === "function" ? patch(current) : patch) } : current,
    );
  };
  const updatePolicy = (patch: Partial<CrewPolicy>) =>
    update((current) => ({ policy: { ...current.policy, ...patch } }));
  const member = (id: string, patch: Partial<CrewAgent>) =>
    update((current) => ({
      agents: current.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  const removeMember = (id: string) => {
    update((current) => ({ agents: current.agents.filter((a) => a.id !== id) }));
    setSelected((ids) => ids.filter((item) => item !== id));
    setExpandedId((open) => (open === id ? null : open));
  };

  const create = () => {
    if (!valid) {
      setShowIssues(true);
      if (!policyValid) setMoreOpen(true);
      return;
    }
    void act("save", async () => {
      const definition = await state.call<CrewDefinition>("crews.save", {
        definition: looks.forCreate({ ...draft, name: draft.name.trim() }),
      });
      looks.afterCreate(definition);
      forgetCrewDraft(draftKey, draft.id);
      setDraft(definition);
      setShowIssues(false);
    });
  };

  const openAdd = () => {
    additions.open();
    setPage({ kind: "add" });
  };
  const addPicked = () => {
    if (additions.mode === "library") {
      const added = livePicked.flatMap((id) => {
        const saved = data.agents.find((agent) => agent.id === id);
        return saved ? [memberFromLibrary(saved)] : [];
      });
      update((current) => ({ agents: [...current.agents, ...added] }));
      additions.setPicked([]);
      setPage({ kind: "team" });
      return;
    }
    const memberDraft = { ...additions.newMember, name: additions.newMember.name.trim() };
    if (!memberDraft.name || !memberDraft.candidates.length) {
      additions.setIssues(true);
      return;
    }
    update((current) => ({ agents: [...current.agents, memberDraft] }));
    additions.setNewMember(blankMember(data));
    additions.setIssues(false);
    setPage({ kind: "team" });
  };

  const expand = (id: string | null) => {
    setExpandedId(id);
    const agent = draft.agents.find((a) => a.id === id);
    if (!agent) return;
    // Save to library starts in the profile's own scope, so it updates rather than copies.
    const source = agent.source && data.agents.find((saved) => saved.id === agent.source!.id);
    setMemberScope((source ? !!source.projectId : !!draft.projectId) ? "project" : "global");
  };
  const saveToLibrary = (agent: CrewAgent) =>
    act("library", async () => {
      const saved = await saveLibraryProfile(
        state.call,
        data.agents,
        memberScope === "project" ? data.project.id : undefined,
        agent,
      );
      member(agent.id, {
        source: { id: saved.id, updatedAt: saved.updatedAt },
        customized: undefined,
      });
    });

  const handleErrors = handleErrorsFromHost(autosave.error, draft.agents);
  const sections = crewSections(draft.agents, issues);
  // Roster problems show under their section or on their row; the footer names the rest.
  const issueSummary = valid ? "" : crewIssueSummary(issues, policyValid);
  const footerIssue =
    issueSummary && (showIssues || draft.agents.length) && !(showIssues && issues.name)
      ? issueSummary
      : "";
  const defaults = defaultCrewPolicy;
  const moreSummary = [
    draft.policy.maxParallel !== defaults.maxParallel &&
      t("{p0} at once", { p0: draft.policy.maxParallel }),
    draft.policy.maxAssignments !== defaults.maxAssignments &&
      t("{p0} assignments", { p0: draft.policy.maxAssignments }),
    draft.policy.maxRunMinutes !== defaults.maxRunMinutes &&
      t("{p0} min each", { p0: draft.policy.maxRunMinutes }),
    draft.policy.delegateApprovals === true && t("Coordinator answers permission requests"),
    draft.policy.allowSubagents !== defaults.allowSubagents && t("Allow provider sub-agents"),
  ]
    .filter(Boolean)
    .join(" · ");
  const longRoster = rosterSearchable(draft.agents.length, rosterQuery.trim().length > 0);

  const liveSelected = selected.filter((id) => draft.agents.some((agent) => agent.id === id));

  const roster = (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Heading size="section" level={3}>
          {t("Members")}
        </Heading>
        {draft.agents.length ? (
          <Button
            variant="secondary"
            className="shrink-0"
            data-crew-add
            startIcon={<Plus />}
            onClick={openAdd}
          >
            {t("Add members")}
          </Button>
        ) : null}
      </div>
      {longRoster ? (
        <CrewEditorBulkBar
          cwd={cwd}
          data={data}
          agents={draft.agents}
          selected={liveSelected}
          onSelectedChange={setSelected}
          onAgentsChange={(agents) => update({ agents })}
          disabled={pending}
        />
      ) : null}
      <CrewMemberTable
        cwd={cwd}
        data={data}
        agents={draft.agents}
        issues={issues}
        sections={sections}
        selected={liveSelected}
        onSelectedChange={setSelected}
        onChange={member}
        onRemove={removeMember}
        expandedId={expandedId}
        onExpandedChange={expand}
        onAdd={openAdd}
        onStarter={() => update({ agents: starterRoster(data) })}
        query={rosterQuery}
        onQueryChange={setRosterQuery}
        unfinishedNote={
          unfinished ? t("Unfinished additions are kept until you add or discard them.") : undefined
        }
        renderDetail={(agent) => (
          <CrewMemberDetail
            cwd={cwd}
            state={state}
            data={data}
            traits={teamTraits(draft.agents).get(agent.id)}
            handleError={handleErrors[agent.id]}
            agent={agent}
            scope={memberScope}
            onScopeChange={setMemberScope}
            pending={pending}
            pendingAction={pendingAction}
            showIssues={showIssues}
            onSaveToLibrary={() => saveToLibrary(agent)}
            onChange={(patch) => member(agent.id, patch)}
          />
        )}
      />
    </>
  );

  const more = (
    <Disclosure
      variant="compact"
      open={moreOpen || !policyValid}
      onOpenChange={setMoreOpen}
      summary={
        <>
          {t("More options")}
          {!moreOpen && moreSummary ? (
            <Text truncate size="caption" tone="muted">
              {" "}
              · {moreSummary}
            </Text>
          ) : null}
        </>
      }
    >
      <div className="pt-1">
        <CrewWorkingSettings policy={draft.policy} errors={policy} onPolicyChange={updatePolicy} />
      </div>
    </Disclosure>
  );

  const footer =
    page.kind === "add" ? (
      <CrewEditorAddFooter data={data} additions={additions} pending={pending} onAdd={addPicked} />
    ) : (
      <CrewEditorFooter
        isNew={isNew}
        issue={footerIssue}
        status={autosave.status}
        error={autosave.error}
        onRetry={autosave.retry}
        creating={pendingAction === "save"}
        pending={pending}
        blocked={conflict}
        onCreate={create}
      />
    );

  return (
    <Modal
      title={page.kind === "add" ? t("Add members") : isNew ? t("New crew") : t("Edit crew")}
      size="lg"
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <div className="@container/crew-footer w-full">
          <div className="grid min-w-0 items-center gap-2 @min-[36rem]/crew-footer:grid-cols-[minmax(0,1fr)_auto]">
            {footer}
          </div>
        </div>
      }
    >
      <FieldGroup ref={body} variant="bare" disabled={pending}>
        <div className="@container/crew-editor flex min-w-0 flex-col gap-4">
          <CrewEditorBanners
            error={error}
            catalogError={data.catalogError}
            pending={pending}
            onRetryCatalog={state.refreshCatalog}
            conflict={conflict ? (missing ? "missing" : "changed") : undefined}
            onKeepAsNew={() => {
              forgetCrewDraft(draftKey, draft.id);
              looks.seedFrom(draft.id);
              setDraft({ ...draft, id: crypto.randomUUID(), updatedAt: 0 });
            }}
            onLoadLatest={
              latest
                ? () => {
                    forgetCrewDraft(draftKey, latest.id);
                    setDraft(structuredClone(latest));
                    setPage({ kind: "team" });
                  }
                : undefined
            }
          />
          {page.kind === "add" ? (
            <CrewEditorAddPage
              cwd={cwd}
              data={data}
              additions={additions}
              onBack={() => setPage({ kind: "team" })}
            />
          ) : (
            <>
              <CrewEditorHeader
                draft={draft}
                projectId={data.project.id}
                isNew={isNew}
                nameError={showIssues && issues.name ? t("Name the crew.") : undefined}
                onChange={update}
                look={
                  <CrewAppearancePicker
                    crewId={draft.id}
                    look={looks.look}
                    onChange={looks.setLook}
                    busy={pending}
                  />
                }
                access={
                  <CrewAccessRow
                    policy={draft.policy}
                    accessSupported={data.accessSupported === true}
                    onChange={updatePolicy}
                  />
                }
              />
              {roster}
              {more}
            </>
          )}
        </div>
      </FieldGroup>
    </Modal>
  );
}
