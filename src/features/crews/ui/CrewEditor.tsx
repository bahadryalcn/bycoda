import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { Heading } from "../../../shared/ui/Heading";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Modal } from "../../../shared/ui/Modal";
import { Plus } from "../../../shared/ui/icons";
import {
  defaultCrewPolicy,
  type CrewAgent,
  type CrewDefinition,
  type CrewPolicy,
  type CrewRole,
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
  libraryGroups,
  memberFromLibrary,
  saveLibraryProfile,
} from "../model/crewRoster";
import { CrewAccessRow } from "./CrewAccessRow";
import { CrewAppearancePicker } from "./CrewAppearancePicker";
import { CrewEditorBulkBar } from "./CrewEditorBulkBar";
import { CrewEditorAddFooter, CrewEditorAddPage, liveAdditions } from "./CrewEditorAdd";
import { CrewEditorFooter } from "./CrewEditorFooter";
import { CrewEditorBanners, CrewEditorHeader, CrewMaintenance } from "./CrewEditorParts";
import { CrewMemberDetail, type CrewBusyAction, type CrewInspection } from "./CrewMemberDetail";
import { CrewMemberTable, crewIssueSummary, crewSections } from "./CrewMemberTable";
import { CrewWorkingSettings } from "./CrewWorkingSettings";
import { useCrewAdditions } from "./useCrewAdditions";
import { useCrewAutosave } from "./useCrewAutosave";
import { useCrewRebase } from "./useCrewRebase";
import { usePageFocus } from "./usePageFocus";
import { useCrewLook } from "./useCrewLook";

export { emptyCrew };

export type CrewEditorPage = "team" | "settings" | "add";

type Page = { kind: "team" } | { kind: "add"; role?: CrewRole };

type EditorFocus = {
  crewId?: string;
  /** Opens an unsaved crew in this scope. */
  createScope?: "project" | "global";
  /** Opens an unsaved copy of a crew in the given scope. */
  copyOf?: { crewId: string; scope: "project" | "global" };
  /** "settings" opens with Advanced expanded; "add" opens Add members. */
  initialPage?: CrewEditorPage;
  /** Offered when the owner chooses New work; the caller opens the start dialog. */
  onStart?: (crewId: string) => void;
  onClose: () => void;
};

/** Creating and editing a crew share one dialog: access, bulk models and the roster on one page. */
export function CrewEditDialog({ cwd, ...focus }: { cwd: string } & EditorFocus) {
  useLocale();
  const state = useProjectCrews(cwd);
  if (!state.data)
    return (
      <Modal title={t("Crew")} size="sm" onClose={focus.onClose}>
        <div>
          <Alert tone={state.error ? "warning" : "info"}>
            {state.error ? state.error.message : t("Loading crews…")}
            {state.error ? (
              <Button variant="ghost" onClick={() => void state.refetch()}>
                {t("Retry")}
              </Button>
            ) : null}
          </Alert>
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
  initialPage = "team",
  onStart,
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
  const [page, setPage] = useState<Page>(
    initialPage === "add" ? { kind: "add" } : { kind: "team" },
  );
  const [advancedOpen, setAdvancedOpen] = useState(initialPage === "settings");
  const [pendingAction, setPendingAction] = useState<CrewBusyAction>(null);
  const pending = pendingAction !== null;
  const gate = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const body = useRef<HTMLFieldSetElement>(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const additions = useCrewAdditions(data);
  const [memberScope, setMemberScope] = useState<"project" | "global">("project");
  const [inspection, setInspection] = useState<Record<string, CrewInspection>>({});

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
    enabled: !conflict && pendingAction !== "delete" && pendingAction !== "save",
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
      setNotice("");
    },
  });

  const act = async (action: Exclude<CrewBusyAction, null>, operation: () => Promise<void>) => {
    if (gate.current) return;
    gate.current = true;
    setPendingAction(action);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
    setNotice("");
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
      if (!policyValid) setAdvancedOpen(true);
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
      setNotice(t("Crew created"));
    });
  };
  const start = () => {
    if (!valid) {
      setShowIssues(true);
      if (!policyValid) setAdvancedOpen(true);
      return;
    }
    void act("start", async () => {
      if ((await autosave.flush()) && onStart) onStart(draft.id);
    });
  };

  const openAdd = (role?: CrewRole) => {
    additions.open(role);
    setPage({ kind: "add", role });
  };
  const addPicked = () => {
    if (additions.mode === "library") {
      const added = livePicked.flatMap((id) => {
        const saved = data.agents.find((agent) => agent.id === id);
        return saved ? [memberFromLibrary(saved, additions.pickedFor)] : [];
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
    void act("add", async () => {
      let added: CrewAgent = memberDraft;
      if (additions.saveToLibrary) {
        const saved = await saveLibraryProfile(
          state.call,
          data.agents,
          additions.scope === "project" ? data.project.id : undefined,
          memberDraft,
        );
        added = {
          ...memberDraft,
          source: { id: saved.id, updatedAt: saved.updatedAt },
        };
      }
      update((current) => ({ agents: [...current.agents, added] }));
      additions.setNewMember(blankMember(data));
      additions.setSaveToLibrary(false);
      additions.setIssues(false);
      setPage({ kind: "team" });
    });
  };

  const expand = (id: string | null) => {
    setExpandedId(id);
    const agent = draft.agents.find((a) => a.id === id);
    if (!agent) return;
    // Save to library starts in the profile's own scope, so it updates rather than copies.
    const source = agent.source && data.agents.find((saved) => saved.id === agent.source!.id);
    setMemberScope((source ? !!source.projectId : !!draft.projectId) ? "project" : "global");
  };
  const inspect = (agent: CrewAgent) =>
    act("inspect", async () => {
      const result = await state.call<{ candidates?: CrewInspection }>("crews.inspect", {
        definitionId: draft.id,
        memberId: agent.id,
      });
      setInspection((current) => ({ ...current, [agent.id]: result.candidates ?? [] }));
    });
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
      setNotice(t("Saved to member library"));
    });

  const handleErrors = handleErrorsFromHost(autosave.error, draft.agents);
  const sections = crewSections(draft.agents, issues);
  const issueSummary = valid ? "" : crewIssueSummary(sections, issues, policyValid);
  const footerIssue = issueSummary && (showIssues || draft.agents.length) ? issueSummary : "";

  const scopeLabel = draft.projectId ? t("This project") : t("All projects on this host");
  const editLevel = [
    isNew ? t("New crew") : t("Edit crew"),
    page.kind === "add" ? t("Add members") : scopeLabel,
  ].join(" · ");

  const liveSelected = selected.filter((id) => draft.agents.some((agent) => agent.id === id));

  const roster = (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Heading size="section" level={3}>
          {t("Members")}
        </Heading>
        {draft.agents.length ? (
          <div className="flex min-w-0 items-center gap-2">
            {unfinished ? (
              <Text truncate className="min-w-0">
                {t("Unfinished additions are kept until you add or discard them.")}
              </Text>
            ) : null}
            <Button
              variant="secondary"
              className="shrink-0"
              data-crew-add
              startIcon={<Plus />}
              onClick={() => openAdd()}
            >
              {t("Add members")}
            </Button>
          </div>
        ) : null}
      </div>
      {draft.agents.length ? (
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
            crewSaved={!!draft.updatedAt}
            policy={draft.policy}
            agent={agent}
            groupNames={libraryGroups(data.agents)}
            scope={memberScope}
            onScopeChange={setMemberScope}
            pending={pending}
            pendingAction={pendingAction}
            showIssues={showIssues}
            inspection={inspection[agent.id]}
            onInspect={() => inspect(agent)}
            onSaveToLibrary={() => saveToLibrary(agent)}
            onChange={(patch) => member(agent.id, patch)}
          />
        )}
      />
    </>
  );

  const advanced = (
    <Disclosure
      variant="row"
      summary={t("Advanced")}
      open={advancedOpen || !policyValid}
      onOpenChange={setAdvancedOpen}
    >
      <CrewWorkingSettings
        agents={draft.agents}
        policy={draft.policy}
        errors={policy}
        onPolicyChange={updatePolicy}
        appearance={
          <CrewAppearancePicker
            crewId={draft.id}
            look={looks.look}
            onChange={looks.setLook}
            disabled={pending}
          />
        }
        appearanceSavedNow={!isNew && !data.identitySupported}
        appearanceOnHost={!isNew && data.identitySupported === true}
        maintenance={
          latest ? (
            <CrewMaintenance
              state={state}
              crew={latest}
              copyLabel={draft.projectId ? t("Copy to all projects") : t("Copy to this project")}
              pending={pending}
              onCopy={() => {
                autosave
                  .flush()
                  .then(() => {
                    looks.seedFrom(draft.id);
                    setDraft({
                      ...structuredClone(draft),
                      id: crypto.randomUUID(),
                      name: draft.projectId ? draft.name : t("{p0} copy", { p0: draft.name }),
                      projectId: draft.projectId ? undefined : data.project.id,
                      updatedAt: 0,
                    });
                    setPage({ kind: "team" });
                  })
                  .catch(() => {});
              }}
              onPendingChange={(busy) => {
                gate.current = busy;
                setPendingAction(busy ? "delete" : null);
              }}
              onDeleted={() => {
                forgetCrewDraft(draftKey, latest.id);
                onClose();
              }}
            />
          ) : null
        }
      />
    </Disclosure>
  );

  const footer =
    page.kind === "add" ? (
      <CrewEditorAddFooter
        data={data}
        additions={additions}
        role={page.role}
        pending={pending}
        adding={pendingAction === "add"}
        onAdd={addPicked}
      />
    ) : (
      <CrewEditorFooter
        isNew={isNew}
        issue={footerIssue}
        status={autosave.status}
        error={autosave.error}
        onRetry={autosave.retry}
        creating={pendingAction === "save"}
        starting={pendingAction === "start"}
        pending={pending}
        blocked={conflict}
        canStart={!!onStart}
        onCreate={create}
        onStart={start}
      />
    );

  return (
    <Modal
      title={isNew ? draft.name.trim() || t("New crew") : latest?.name || draft.name || t("Crew")}
      context={editLevel}
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
            onRetryCatalog={() => state.refetch().catch(() => {})}
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
          {notice ? <InlineMessage tone="success">{notice}</InlineMessage> : null}
          {page.kind === "add" ? (
            <CrewEditorAddPage
              cwd={cwd}
              data={data}
              additions={additions}
              role={page.role}
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
              />
              <CrewAccessRow
                policy={draft.policy}
                accessSupported={data.accessSupported === true}
                onChange={updatePolicy}
              />
              {roster}
              {advanced}
            </>
          )}
        </div>
      </FieldGroup>
    </Modal>
  );
}
