import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { ChevronLeft, Plus, Trash2 } from "../../../shared/ui/icons";
import { Group, Row, Toggle } from "../../settings/ui/settingsControls";
import {
  defaultCrewPolicy,
  type CrewAgent,
  type CrewDefinition,
  type CrewPolicy,
  type CrewRole,
} from "../model/crew";
import { useProjectCrews, type ProjectCrews } from "../model/crewClient";
import {
  loadCrewAppearances,
  saveCrewAppearance,
  useCrewAppearances,
  type CrewAppearance,
} from "../model/crewAppearance";
import {
  COST_LEVELS,
  QUALITY_LEVELS,
  candidateLabel,
  catalogCandidate,
  catalogModels,
  crewRosterIssues,
  crewRosterValid,
  libraryGroups,
  libraryUpdate,
  memberFromLibrary,
  newCrewMember,
  saveLibraryProfile,
  type CrewRosterIssues,
} from "../model/crewRoster";
import { CrewAppearancePicker } from "./CrewAppearancePicker";
import { CrewDeleteButton } from "./CrewDeleteButton";
import { CrewMemberForm, roleLabel } from "./CrewMemberForm";
import { CrewMemberPicker, type MemberPickerMode } from "./CrewMemberPicker";

// Like note drafts, these survive closing the dialog for the lifetime of this window.
// Host + project identity prevents a draft leaking into another connection.
const crewDrafts = new Map<
  string,
  { newDraft: CrewDefinition | null; drafts: Record<string, CrewDefinition> }
>();

export type CrewEditorPage = "team" | "settings" | "add";

type Page =
  /** Focus returns to the member row a detail page was opened from. */
  | { kind: "team"; focus?: string }
  | { kind: "settings" }
  | { kind: "member"; id: string }
  | { kind: "add"; role?: CrewRole };

type EditorFocus = {
  crewId?: string;
  /** Opens an unsaved crew in this scope. */
  createScope?: "project" | "global";
  /** Opens an unsaved copy of a crew in the given scope. */
  copyOf?: { crewId: string; scope: "project" | "global" };
  initialPage?: CrewEditorPage;
  /** Offered after a successful save; the caller opens the start dialog. */
  onStart?: (crewId: string) => void;
  onClose: () => void;
};

export function emptyCrew(data: ProjectCrews, scope: "project" | "global"): CrewDefinition {
  return {
    id: crypto.randomUUID(),
    name: "",
    projectId: scope === "project" ? data.project.id : undefined,
    agents: [],
    policy: { ...defaultCrewPolicy },
    updatedAt: 0,
  };
}

/** An optional starting roster; its model is shown on every row before saving. */
function starterRoster(data: ProjectCrews): CrewAgent[] {
  const first = catalogModels(data.catalog)[0];
  const candidate = first
    ? catalogCandidate(data.catalog, `${first.harness}/${first.id}`)
    : undefined;
  return [
    newCrewMember("coordinator", t("Project lead"), candidate),
    newCrewMember("specialist", t("Developer"), candidate),
    newCrewMember("reviewer", t("Code reviewer"), candidate),
  ];
}

/** Creating and editing a crew share one dialog: the roster first, working settings one tab away. */
export function CrewEditDialog({ cwd, ...focus }: { cwd: string } & EditorFocus) {
  useLocale();
  const state = useProjectCrews(cwd);
  if (!state.data)
    return (
      <Modal title={t("Crew")} size="sm" onClose={focus.onClose}>
        <div className="p-4">
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

function issueText(
  issue: CrewRosterIssues[keyof Omit<CrewRosterIssues, "members">],
  role?: CrewRole,
) {
  if (issue === "duplicate")
    return role === "coordinator"
      ? t("Keep exactly one coordinator.")
      : t("Keep exactly one reviewer.");
  if (issue === "missing")
    return role === "coordinator"
      ? t("Add a coordinator.")
      : role === "reviewer"
        ? t("Add a reviewer.")
        : t("Add at least one specialist.");
  return "";
}

function policyErrors(policy: CrewPolicy) {
  const outOfRange = (value: number, min: number, max: number, integer = true) =>
    !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value));
  return {
    maxParallel: outOfRange(policy.maxParallel, 1, 4) ? t("Use a whole number from 1 to 4.") : "",
    maxAssignments: outOfRange(policy.maxAssignments, 1, 20)
      ? t("Use a whole number from 1 to 20.")
      : "",
    maxRunMinutes: outOfRange(policy.maxRunMinutes, 1, 240, false)
      ? t("Use a value from 1 to 240.")
      : "",
  };
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
  const appearances = useCrewAppearances();
  const [draft, setDraft] = useState<CrewDefinition | null>(() => {
    const stored = crewDrafts.get(draftKey);
    if (copyOf) {
      const source = data.definitions.find((d) => d.id === copyOf.crewId);
      if (source)
        return {
          ...structuredClone(source),
          id: crypto.randomUUID(),
          name:
            (copyOf.scope === "project") === !!source.projectId
              ? t("{p0} copy", { p0: source.name })
              : source.name,
          projectId: copyOf.scope === "project" ? data.project.id : undefined,
          updatedAt: 0,
        };
    }
    if (createScope) {
      // Reopening New crew resumes the unsaved one left in the same scope.
      const resumed = stored?.newDraft;
      return resumed && !!resumed.projectId === (createScope === "project")
        ? resumed
        : emptyCrew(data, createScope);
    }
    const found =
      (crewId ? stored?.drafts[crewId] : undefined) ??
      data.definitions.find((d) => d.id === crewId);
    return found ? structuredClone(found) : null;
  });
  const [draftLook, setDraftLook] = useState<CrewAppearance>(() =>
    copyOf ? (loadCrewAppearances()[copyOf.crewId] ?? {}) : {},
  );
  const [page, setPage] = useState<Page>(
    initialPage === "add" ? { kind: "add" } : { kind: initialPage },
  );
  const [pending, setPending] = useState(false);
  const gate = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const [addIssues, setAddIssues] = useState(false);
  const body = useRef<HTMLFieldSetElement>(null);
  const [bulkModel, setBulkModel] = useState("");
  // Add members page.
  const [addMode, setAddMode] = useState<MemberPickerMode>(data.agents.length ? "library" : "new");
  const [picked, setPicked] = useState<string[]>([]);
  const [newMember, setNewMember] = useState<CrewAgent>(() => blankMember(data));
  const [saveNewToLibrary, setSaveNewToLibrary] = useState(false);
  const [newMemberScope, setNewMemberScope] = useState<"project" | "global">("project");
  // Member page: library scope for "Save to library".
  const [memberScope, setMemberScope] = useState<"project" | "global">("project");
  const [inspection, setInspection] = useState<
    Record<
      string,
      {
        model: string;
        imageGeneration?: boolean;
        observations: { count: number; accepted: number };
      }[]
    >
  >({});

  useEffect(() => {
    if (!draft) return;
    const stored = crewDrafts.get(draftKey) ?? { newDraft: null, drafts: {} };
    if (!draft.updatedAt) {
      if (!copyOf) crewDrafts.set(draftKey, { ...stored, newDraft: draft });
      return;
    }
    const saved = data.definitions.find((d) => d.id === draft.id);
    const drafts = { ...stored.drafts };
    if (saved && JSON.stringify(saved) === JSON.stringify(draft)) delete drafts[draft.id];
    else drafts[draft.id] = draft;
    crewDrafts.set(draftKey, { ...stored, drafts });
  }, [draftKey, draft, data.definitions, copyOf]);

  // Page switches unmount the focused control: a member page focuses its heading,
  // and returning to the team focuses the member row it was opened from.
  const memberFocus = page.kind === "member" ? page.id : undefined;
  const rowFocus = page.kind === "team" ? page.focus : undefined;
  useEffect(() => {
    const root = body.current;
    if (memberFocus)
      root?.querySelector<HTMLElement>("[data-page-heading]")?.focus({ preventScroll: true });
    else if (rowFocus)
      root?.querySelector<HTMLElement>(`[data-member-row="${CSS.escape(rowFocus)}"]`)?.focus();
  }, [memberFocus, rowFocus]);

  const latest = data.definitions.find((d) => d.id === draft?.id);
  const conflict = !!draft?.updatedAt && !!latest && latest.updatedAt !== draft.updatedAt;
  const isNew = !!draft && !draft.updatedAt;
  const dirty =
    !!draft &&
    (isNew
      ? !!draft.agents.length || !!draft.name.trim()
      : !!latest && JSON.stringify(latest) !== JSON.stringify(draft));
  const look = draft && !isNew ? (appearances[draft.id] ?? {}) : draftLook;
  const setLook = (patch: CrewAppearance) =>
    draft && !isNew
      ? saveCrewAppearance(draft.id, patch)
      : setDraftLook((current) => ({ ...current, ...patch }));

  const act = async (operation: () => Promise<void>) => {
    if (gate.current) return;
    gate.current = true;
    setPending(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      gate.current = false;
      setPending(false);
    }
  };

  if (!draft)
    return (
      <Modal title={t("Crew")} size="sm" onClose={onClose}>
        <div className="p-4">
          <Alert tone="info">{t("This crew is no longer available.")}</Alert>
        </div>
      </Modal>
    );

  const issues = crewRosterIssues(draft);
  const policy = policyErrors(draft.policy);
  const policyValid = !policy.maxParallel && !policy.maxAssignments && !policy.maxRunMinutes;
  const valid = crewRosterValid(issues) && policyValid;
  const update = (patch: Partial<CrewDefinition>) => {
    setDraft({ ...draft, ...patch });
    setNotice("");
  };
  const updatePolicy = (patch: Partial<CrewPolicy>) =>
    update({ policy: { ...draft.policy, ...patch } });
  const member = (id: string, patch: Partial<CrewAgent>) =>
    update({
      agents: draft.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  const forgetDraft = (id: string) => {
    const stored = crewDrafts.get(draftKey);
    if (!stored) return;
    const drafts = { ...stored.drafts };
    delete drafts[id];
    crewDrafts.set(draftKey, {
      newDraft: stored.newDraft?.id === id ? null : stored.newDraft,
      drafts,
    });
  };
  const discard = () => {
    forgetDraft(draft.id);
    setDraft(
      latest ? structuredClone(latest) : emptyCrew(data, draft.projectId ? "project" : "global"),
    );
    if (!latest) setDraftLook({});
    setPage({ kind: "team" });
    setShowIssues(false);
    setError("");
  };
  const save = (thenStart: boolean) => {
    if (!valid) {
      setShowIssues(true);
      if (!policyValid) setPage({ kind: "settings" });
      return;
    }
    void act(async () => {
      const definition = await state.call<CrewDefinition>("crews.save", {
        definition: { ...draft, name: draft.name.trim() },
        expectedUpdatedAt: draft.updatedAt || undefined,
      });
      if (isNew) saveCrewAppearance(definition.id, draftLook);
      forgetDraft(draft.id);
      setDraft(definition);
      setShowIssues(false);
      setNotice(t("Saved"));
      if (thenStart && onStart) onStart(definition.id);
    });
  };
  const openAdd = (role?: CrewRole) => {
    setAddIssues(false);
    setPicked([]);
    setNewMember(blankMember(data, role));
    setSaveNewToLibrary(false);
    setAddMode(data.agents.length ? "library" : "new");
    setPage({ kind: "add", role });
  };
  const addPicked = (role?: CrewRole) => {
    if (addMode === "library") {
      const added = picked.flatMap((id) => {
        const saved = data.agents.find((agent) => agent.id === id);
        return saved ? [memberFromLibrary(saved, role)] : [];
      });
      update({ agents: [...draft.agents, ...added] });
      setPage({ kind: "team" });
      return;
    }
    const memberDraft = { ...newMember, name: newMember.name.trim() };
    if (!memberDraft.name || !memberDraft.candidates.length) {
      setAddIssues(true);
      return;
    }
    void act(async () => {
      let added: CrewAgent = memberDraft;
      if (saveNewToLibrary) {
        const saved = await saveLibraryProfile(
          state.call,
          data.agents,
          newMemberScope === "project" ? data.project.id : undefined,
          memberDraft,
        );
        added = {
          ...memberDraft,
          source: { id: saved.id, updatedAt: saved.updatedAt },
        };
      }
      update({ agents: [...draft.agents, added] });
      setPage({ kind: "team" });
    });
  };

  const openMember = (agent: CrewAgent) => {
    // Save to library starts in the profile's own scope, so it updates rather than copies.
    const source = agent.source && data.agents.find((saved) => saved.id === agent.source!.id);
    const projectScoped = source ? !!source.projectId : !!draft.projectId;
    setMemberScope(projectScoped ? "project" : "global");
    setPage({ kind: "member", id: agent.id });
  };

  const fixed = draft.agents.filter((agent) => agent.selection === "fixed");
  const modelOptions = catalogModels(data.catalog).map((model) => ({
    value: `${model.harness}/${model.id}`,
    label: model.name,
    description: model.harness,
  }));
  const scopeLabel = draft.projectId ? t("This project") : t("All projects on this host");
  const groupNames = libraryGroups(data.agents);

  const sections: {
    role: CrewRole;
    title: string;
    hint: string;
    issue?: string;
  }[] = [
    {
      role: "coordinator",
      title: t("Coordinator"),
      hint: t("Plans the work and hands out assignments."),
      issue: issues.coordinator && issueText(issues.coordinator, "coordinator"),
    },
    {
      role: "specialist",
      title: t("Specialists"),
      hint: t("Deliver the assigned work."),
      issue: issues.specialist && issueText(issues.specialist, "specialist"),
    },
    {
      role: "reviewer",
      title: t("Reviewer"),
      hint: t("Checks each delivery independently."),
      issue: issues.reviewer && issueText(issues.reviewer, "reviewer"),
    },
    ...(draft.agents.some((a) => a.role === "advisor")
      ? [
          {
            role: "advisor" as const,
            title: t("Advisors"),
            hint: t("Answer questions without taking assignments."),
          },
        ]
      : []),
  ];
  const issueSummary = !valid
    ? (sections.find((s) => s.issue)?.issue ??
      (issues.name
        ? t("Name the crew.")
        : Object.keys(issues.members).length
          ? t("Every member needs a name and a model.")
          : issues.size === "large"
            ? t("A crew can have at most 20 members.")
            : !policyValid
              ? t("Check the working settings.")
              : ""))
    : "";

  const header = (
    <div className="grid min-w-0 items-end gap-3 @min-[36rem]/crew-editor:grid-cols-[minmax(0,1fr)_auto]">
      <TextField
        label={t("Crew name")}
        placeholder={t("e.g. Mobile app")}
        value={draft.name}
        fieldClassName="min-w-0"
        autoFocus={isNew && !draft.name}
        error={showIssues && issues.name ? t("Name the crew.") : undefined}
        onChange={(event) => update({ name: event.target.value })}
      />
      {isNew ? (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="text-ui-body font-medium">{t("Available in")}</span>
          <SegmentedControl
            label={t("Available in")}
            value={draft.projectId ? "project" : "global"}
            options={[
              { value: "project", label: t("This project") },
              { value: "global", label: t("All projects") },
            ]}
            onValueChange={(scope) =>
              update({
                projectId: scope === "project" ? data.project.id : undefined,
              })
            }
          />
        </div>
      ) : (
        <span className="pb-2 text-ui-caption text-(--ui-text-secondary)">{scopeLabel}</span>
      )}
    </div>
  );

  const roster = (
    <div className="flex min-w-0 flex-col gap-4">
      {draft.agents.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-2">
          <p className="text-ui-body text-(--ui-text-secondary)">
            {t(
              "A crew needs a coordinator, at least one specialist and a reviewer. Pick members from your library or start with one of each.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              startIcon={<Plus className="icon-sm" />}
              onClick={() => openAdd()}
            >
              {t("Add members")}
            </Button>
            <Button
              variant="secondary"
              disabled={!modelOptions.length}
              onClick={() => update({ agents: starterRoster(data) })}
            >
              {t("Use starter roster")}
            </Button>
          </div>
        </div>
      ) : (
        sections.map((section) => {
          const members = draft.agents.filter((agent) => agent.role === section.role);
          return (
            <section
              key={section.role}
              aria-label={section.title}
              className="flex min-w-0 flex-col gap-1.5"
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <h4 className="text-ui-body font-medium" title={section.hint}>
                  {section.title}
                </h4>
                <span className="min-w-0 flex-1 text-ui-caption tabular-nums text-(--ui-text-secondary)">
                  {members.length || ""}
                </span>
                {members.length > 0 &&
                (section.role === "specialist" || section.role === "advisor") ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    startIcon={<Plus className="icon-sm" />}
                    onClick={() => openAdd(section.role)}
                  >
                    {t("Add")}
                  </Button>
                ) : null}
              </div>
              {section.issue ? (
                <p role="status" className="text-ui-caption text-danger">
                  {section.issue}
                </p>
              ) : null}
              {members.length ? (
                <ul className="flex min-w-0 flex-col divide-y divide-(--ui-tone-neutral-border)">
                  {members.map((agent) => {
                    const problem = issues.members[agent.id];
                    const detail =
                      agent.groups?.join(", ") || agent.instructions.split(/\r?\n/)[0]?.trim();
                    return (
                      <li key={agent.id} className="flex min-w-0 items-center gap-1">
                        <Button
                          variant="item"
                          motion="none"
                          className="min-w-0 flex-1"
                          data-member-row={agent.id}
                          onClick={() => openMember(agent)}
                          title={[
                            agent.name,
                            detail,
                            candidateLabel(data.catalog, agent.candidates[0]),
                          ]
                            .filter(Boolean)
                            .join("\n")}
                        >
                          <span className="min-w-0 flex-1 text-start">
                            <span className="block truncate text-ui-body font-medium">
                              {agent.name || t("Unnamed member")}
                            </span>
                            {detail ? (
                              <span className="block truncate text-ui-caption text-(--ui-text-secondary)">
                                {detail}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={`max-w-[38%] shrink-0 truncate text-ui-caption ${problem ? "text-danger" : "text-(--ui-text-secondary)"}`}
                          >
                            {problem === "model"
                              ? t("Choose a model")
                              : problem === "name"
                                ? t("Add a name")
                                : `${agent.selection === "automatic" ? `${t("Automatic")} · ` : ""}${candidateLabel(data.catalog, agent.candidates[0])}`}
                          </span>
                          <span className="shrink-0 text-ui-caption text-(--ui-text-secondary)">
                            {t("Edit")}
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          iconOnly
                          label={t("Remove {p0} from crew", {
                            p0: agent.name || t("member"),
                          })}
                          className="shrink-0"
                          onClick={() =>
                            update({
                              agents: draft.agents.filter((a) => a.id !== agent.id),
                            })
                          }
                        >
                          <Trash2 className="icon-sm" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Button
                  variant="secondary"
                  className="self-start"
                  startIcon={<Plus className="icon-sm" />}
                  onClick={() => openAdd(section.role)}
                >
                  {section.role === "coordinator"
                    ? t("Add coordinator")
                    : section.role === "reviewer"
                      ? t("Add reviewer")
                      : t("Add specialist")}
                </Button>
              )}
            </section>
          );
        })
      )}
      {issues.size === "large" ? (
        <p role="status" className="text-ui-caption text-danger">
          {t("A crew can have at most 20 members.")}
        </p>
      ) : null}
    </div>
  );

  const selectedMember =
    page.kind === "member" ? draft.agents.find((agent) => agent.id === page.id) : undefined;
  const memberPage = selectedMember ? (
    <MemberPage
      cwd={cwd}
      data={data}
      crewSaved={!!draft.updatedAt}
      agent={selectedMember}
      groupNames={groupNames}
      scope={memberScope}
      onScopeChange={setMemberScope}
      pending={pending}
      showIssues={showIssues}
      inspection={inspection[selectedMember.id]}
      onInspect={() =>
        act(async () => {
          const result = await state.call<{
            candidates?: {
              model: string;
              imageGeneration?: boolean;
              observations: { count: number; accepted: number };
            }[];
          }>("crews.inspect", {
            definitionId: draft.id,
            memberId: selectedMember.id,
          });
          setInspection((current) => ({
            ...current,
            [selectedMember.id]: result.candidates ?? [],
          }));
        })
      }
      onSaveToLibrary={() =>
        act(async () => {
          const saved = await saveLibraryProfile(
            state.call,
            data.agents,
            memberScope === "project" ? data.project.id : undefined,
            selectedMember,
          );
          member(selectedMember.id, {
            source: { id: saved.id, updatedAt: saved.updatedAt },
          });
          setNotice(t("Saved to member library"));
        })
      }
      onChange={(patch) => member(selectedMember.id, patch)}
      onRemove={() => {
        update({
          agents: draft.agents.filter((a) => a.id !== selectedMember.id),
        });
        setPage({ kind: "team" });
      }}
    />
  ) : null;

  const automatic = draft.agents.filter((agent) => agent.selection === "automatic").length;
  const levelSelect = (
    key: "maxEstimatedCost" | "minimumQuality",
    label: string,
    levels: readonly number[],
    names: string[],
  ) => {
    const current = draft.policy[key];
    return (
      <Select
        label={label}
        value={current === undefined ? "" : String(current)}
        options={[
          { value: "", label: t("Any") },
          ...levels.map((level, index) => ({ value: String(level), label: names[index]! })),
          ...(current !== undefined && !levels.includes(current)
            ? [{ value: String(current), label: t("Custom ({p0})", { p0: current }) }]
            : []),
        ]}
        onValueChange={(value) => updatePolicy({ [key]: value ? Number(value) : undefined })}
      />
    );
  };
  const settings = (
    <div className="flex min-w-0 flex-col gap-4">
      <Group title={t("Appearance")}>
        <Row label={t("Crew")}>
          <CrewAppearancePicker
            crewId={draft.id}
            look={look}
            onChange={setLook}
            disabled={pending}
          />
        </Row>
      </Group>
      <Group
        title={t("Automatic model choice")}
        description={
          automatic === 1
            ? t("Used by the member set to Automatic.")
            : automatic
              ? t("Used by {p0} members set to Automatic.", { p0: automatic })
              : t("No member chooses its model automatically. These apply once one does.")
        }
      >
        <Row
          label={t("Priority")}
          description={
            draft.policy.preset === "economy"
              ? t("Prefers models you rated cheaper.")
              : draft.policy.preset === "quality"
                ? t("Prefers models you rated higher quality.")
                : t("Weighs cost and quality equally.")
          }
        >
          <SegmentedControl
            label={t("Priority")}
            value={draft.policy.preset}
            options={[
              { value: "economy", label: t("Economy") },
              { value: "balanced", label: t("Balanced") },
              { value: "quality", label: t("Quality") },
            ]}
            onValueChange={(preset) =>
              updatePolicy({
                preset: preset as CrewPolicy["preset"],
                costWeight: undefined,
                qualityWeight: undefined,
              })
            }
          />
        </Row>
        {draft.policy.costWeight !== undefined || draft.policy.qualityWeight !== undefined ? (
          <p className="px-3 pb-2 text-ui-caption text-(--ui-text-secondary)">
            {t("Custom weights are active. Choose a preset to reset them.")}
          </p>
        ) : null}
        <Row
          label={t("Highest cost allowed")}
          description={t("Models rated above this cost are skipped.")}
        >
          {levelSelect("maxEstimatedCost", t("Highest cost allowed"), COST_LEVELS, [
            t("Low"),
            t("Medium"),
            t("High"),
          ])}
        </Row>
        <Row
          label={t("Lowest quality allowed")}
          description={t("Models rated below this quality are skipped.")}
        >
          {levelSelect("minimumQuality", t("Lowest quality allowed"), QUALITY_LEVELS, [
            t("Basic"),
            t("Good"),
            t("Best"),
          ])}
        </Row>
        <Row
          label={t("Use models without a cost rating")}
          description={t("When off, only models you rated for cost can be chosen.")}
        >
          <Toggle
            label={t("Use models without a cost rating")}
            on={draft.policy.allowUnknownCost}
            onChange={(value) => updatePolicy({ allowUnknownCost: value })}
          />
        </Row>
      </Group>
      {fixed.length ? (
        <Group title={t("Models")}>
          <Row
            label={t("Same model for every fixed member")}
            description={t("Replaces the model of {p0} members with a fixed model.", {
              p0: fixed.length,
            })}
          >
            <div className="flex min-w-0 items-center gap-2">
              <SearchableSelect
                label={t("Same model for every fixed member")}
                options={modelOptions}
                value={bulkModel}
                placeholder={t("Choose a model")}
                onChange={setBulkModel}
              />
              <Button
                variant="secondary"
                disabled={!bulkModel}
                onClick={() => {
                  const next = catalogCandidate(data.catalog, bulkModel);
                  if (!next) return;
                  update({
                    agents: draft.agents.map((agent) =>
                      agent.selection === "fixed"
                        ? {
                            ...agent,
                            candidates: [
                              agent.candidates.find((c) => c.id === next.id) ?? next,
                              ...agent.candidates.filter((c) => c.id !== next.id),
                            ],
                          }
                        : agent,
                    ),
                  });
                  setBulkModel("");
                }}
              >
                {t("Apply")}
              </Button>
            </div>
          </Row>
        </Group>
      ) : null}
      <Group title={t("Limits")}>
        <Row
          label={t("Members working at once")}
          description={t("How many assignments can run at the same time.")}
        >
          <NumberField
            hideLabel
            label={t("Members working at once")}
            min={1}
            max={4}
            value={draft.policy.maxParallel}
            error={policy.maxParallel || undefined}
            onChange={(e) => updatePolicy({ maxParallel: Number(e.target.value) })}
          />
        </Row>
        <Row
          label={t("Assignments per job")}
          description={t("The most assignments the coordinator can hand out for one job.")}
        >
          <NumberField
            hideLabel
            label={t("Assignments per job")}
            min={1}
            max={20}
            value={draft.policy.maxAssignments}
            error={policy.maxAssignments || undefined}
            onChange={(e) => updatePolicy({ maxAssignments: Number(e.target.value) })}
          />
        </Row>
        <Row
          label={t("Minutes per assignment")}
          description={t("An assignment running longer than this is stopped.")}
        >
          <NumberField
            hideLabel
            label={t("Minutes per assignment")}
            min={1}
            max={240}
            value={draft.policy.maxRunMinutes}
            error={policy.maxRunMinutes || undefined}
            onChange={(e) => updatePolicy({ maxRunMinutes: Number(e.target.value) })}
          />
        </Row>
      </Group>
      <Group title={t("Permissions")}>
        <Row
          label={t("Coordinator answers permission requests")}
          description={t(
            "When a member asks to run a tool, the coordinator decides instead of you.",
          )}
        >
          <Toggle
            label={t("Coordinator answers permission requests")}
            on={draft.policy.delegateApprovals === true}
            onChange={(value) => updatePolicy({ delegateApprovals: value })}
          />
        </Row>
        <Row
          label={t("Allow provider sub-agents")}
          description={t("Members may start their provider's own helper agents.")}
        >
          <Toggle
            label={t("Allow provider sub-agents")}
            on={draft.policy.allowSubagents}
            onChange={(value) => updatePolicy({ allowSubagents: value })}
          />
        </Row>
      </Group>
      {latest ? (
        <div className="flex flex-col gap-4 border-t border-(--ui-tone-neutral-border) pt-3">
          <Button
            variant="ghost"
            className="self-start"
            disabled={pending}
            onClick={() => {
              const id = crypto.randomUUID();
              setDraftLook(loadCrewAppearances()[draft.id] ?? {});
              setDraft({
                ...structuredClone(draft),
                id,
                name: draft.projectId ? draft.name : t("{p0} copy", { p0: draft.name }),
                projectId: draft.projectId ? undefined : data.project.id,
                updatedAt: 0,
              });
              setPage({ kind: "team" });
            }}
          >
            {draft.projectId ? t("Copy to all projects") : t("Copy to this project")}
          </Button>
          <div className="flex flex-col gap-2 border-t border-(--ui-tone-neutral-border) pt-3 empty:hidden">
            <CrewDeleteButton
              state={state}
              crew={latest}
              onDeleted={() => {
                forgetDraft(latest.id);
                onClose();
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );

  const footer =
    page.kind === "add" ? (
      <>
        <span role="status" className="min-w-0 break-words text-ui-caption text-danger">
          {addMode === "new" &&
          addIssues &&
          (!newMember.name.trim() || !newMember.candidates.length)
            ? t("Every member needs a name and a model.")
            : ""}
        </span>
        <div className="flex min-w-0 flex-wrap justify-end gap-2">
          <Button
            variant="primary"
            loading={pending}
            disabled={pending || (addMode === "library" && !picked.length)}
            onClick={() => addPicked(page.role)}
          >
            {addMode === "library"
              ? t("Add {p0} members", { p0: picked.length })
              : t("Add to crew")}
          </Button>
        </div>
      </>
    ) : (
      <>
        <span
          role="status"
          className={`min-w-0 break-words text-ui-caption ${issueSummary && (showIssues || draft.agents.length) ? "text-danger" : "text-(--ui-text-secondary)"}`}
        >
          {issueSummary && (showIssues || draft.agents.length)
            ? issueSummary
            : notice ||
              (dirty ? t("Unsaved changes are kept until you save or discard them.") : "")}
        </span>
        <div className="flex min-w-0 flex-wrap justify-end gap-2">
          {dirty ? (
            <Button variant="ghost" disabled={pending} onClick={discard}>
              {t("Discard")}
            </Button>
          ) : null}
          <Button
            variant={onStart ? "secondary" : "primary"}
            loading={pending}
            disabled={pending || conflict || (!dirty && !isNew)}
            onClick={() => save(false)}
          >
            {isNew ? t("Create crew") : t("Save")}
          </Button>
          {onStart ? (
            <Button
              variant="primary"
              disabled={pending || conflict}
              onClick={() => (dirty || isNew ? save(true) : onStart(draft.id))}
            >
              {dirty || isNew ? t("Save and start work") : t("Start work")}
            </Button>
          ) : null}
        </div>
      </>
    );

  return (
    <Modal
      title={isNew ? t("New crew") : latest?.name || draft.name || t("Crew")}
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
      <fieldset
        ref={body}
        disabled={pending}
        className="@container/crew-editor flex min-w-0 flex-col gap-4 border-0 p-4 pt-2"
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {conflict ? (
          <Alert tone="warning">
            <p>
              {t(
                "This crew changed in another session. Keep your edits as a new crew or discard them to load the latest version.",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  forgetDraft(draft.id);
                  setDraftLook(loadCrewAppearances()[draft.id] ?? {});
                  setDraft({ ...draft, id: crypto.randomUUID(), updatedAt: 0 });
                }}
              >
                {t("Keep edits as new crew")}
              </Button>
              <Button
                onClick={() => {
                  if (!latest) return;
                  forgetDraft(latest.id);
                  setDraft(structuredClone(latest));
                  setPage({ kind: "team" });
                }}
              >
                {t("Discard edits and load latest")}
              </Button>
            </div>
          </Alert>
        ) : null}
        {page.kind === "add" ? (
          <>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                iconOnly
                label={t("Back to team")}
                onClick={() => setPage({ kind: "team" })}
              >
                <ChevronLeft className="icon-md" />
              </Button>
              <h3
                tabIndex={-1}
                data-page-heading
                className="text-ui-title font-medium outline-none"
              >
                {t("Add members")}
              </h3>
            </div>
            <CrewMemberPicker
              cwd={cwd}
              data={data}
              mode={addMode}
              onModeChange={setAddMode}
              selected={picked}
              onSelectedChange={setPicked}
              draft={newMember}
              onDraftChange={(patch) => setNewMember((current) => ({ ...current, ...patch }))}
              role={page.role}
              nameError={addIssues && !newMember.name.trim() ? t("Add a name") : undefined}
              libraryScope={newMemberScope}
              onLibraryScopeChange={setNewMemberScope}
              saveToLibrary={saveNewToLibrary}
              onSaveToLibraryChange={setSaveNewToLibrary}
            />
          </>
        ) : page.kind === "member" && memberPage ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <Button
                variant="ghost"
                iconOnly
                label={t("Back to team")}
                onClick={() => setPage({ kind: "team", focus: page.id })}
              >
                <ChevronLeft className="icon-md" />
              </Button>
              <h3
                tabIndex={-1}
                data-page-heading
                className="min-w-0 truncate text-ui-title font-medium outline-none"
              >
                {selectedMember?.name || t("Unnamed member")}
              </h3>
              <span className="text-ui-caption text-(--ui-text-secondary)">
                {selectedMember ? roleLabel(selectedMember.role) : ""}
              </span>
            </div>
            {memberPage}
          </>
        ) : (
          <>
            {header}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedControl
                label={t("Crew view")}
                value={page.kind}
                options={[
                  {
                    value: "team",
                    label: t("Team ({p0})", { p0: draft.agents.length }),
                  },
                  { value: "settings", label: t("Working settings") },
                ]}
                onValueChange={(value) =>
                  setPage({ kind: value === "settings" ? "settings" : "team" })
                }
              />
              {page.kind === "team" && draft.agents.length ? (
                <Button
                  variant="secondary"
                  startIcon={<Plus className="icon-sm" />}
                  onClick={() => openAdd()}
                >
                  {t("Add members")}
                </Button>
              ) : null}
            </div>
            {page.kind === "settings" ? settings : roster}
          </>
        )}
      </fieldset>
    </Modal>
  );
}

function blankMember(data: ProjectCrews, role: CrewRole = "specialist"): CrewAgent {
  const first = catalogModels(data.catalog)[0];
  return newCrewMember(
    role,
    "",
    first ? catalogCandidate(data.catalog, `${first.harness}/${first.id}`) : undefined,
  );
}

function MemberPage({
  cwd,
  data,
  crewSaved,
  agent,
  groupNames,
  scope,
  onScopeChange,
  pending,
  showIssues,
  inspection,
  onInspect,
  onSaveToLibrary,
  onChange,
  onRemove,
}: {
  cwd: string;
  data: ProjectCrews;
  crewSaved: boolean;
  agent: CrewAgent;
  groupNames: string[];
  scope: "project" | "global";
  onScopeChange: (scope: "project" | "global") => void;
  pending: boolean;
  showIssues: boolean;
  inspection?: {
    model: string;
    imageGeneration?: boolean;
    observations: { count: number; accepted: number };
  }[];
  onInspect: () => void;
  onSaveToLibrary: () => void;
  onChange: (patch: Partial<CrewAgent>) => void;
  onRemove: () => void;
}) {
  useLocale();
  const update = libraryUpdate(agent, data.agents);
  const source = agent.source && data.agents.find((saved) => saved.id === agent.source!.id);
  const projectId = scope === "project" ? data.project.id : undefined;
  const updatesProfile = !!source && source.projectId === projectId;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {update ? (
        <Alert tone="info">
          <p>
            {t("The library profile {p0} changed after this member was added.", {
              p0: update.name,
            })}
          </p>
          <Button
            onClick={() => {
              const next = memberFromLibrary(update, agent.role);
              onChange({ ...next, id: agent.id });
            }}
          >
            {t("Update from library")}
          </Button>
        </Alert>
      ) : null}
      <CrewMemberForm
        cwd={cwd}
        catalog={data.catalog}
        agent={agent}
        onChange={onChange}
        groups={data.groupsSupported}
        groupSuggestions={groupNames}
        nameError={showIssues && !agent.name.trim() ? t("Add a name") : undefined}
        advancedExtra={
          crewSaved ? (
            <div className="flex flex-col gap-1">
              <Button variant="ghost" className="self-start" disabled={pending} onClick={onInspect}>
                {t("Inspect saved capabilities")}
              </Button>
              {inspection?.map((c) => (
                <p key={c.model} className="text-ui-caption text-(--ui-text-secondary)">
                  {c.model} · {t("Image generation")}:{" "}
                  {t(
                    c.imageGeneration === true
                      ? "Available"
                      : c.imageGeneration === false
                        ? "Unavailable"
                        : "Unknown",
                  )}{" "}
                  ·{" "}
                  {t("{p0} reviews · {p1} accepted", {
                    p0: c.observations.count,
                    p1: c.observations.accepted,
                  })}
                </p>
              ))}
            </div>
          ) : null
        }
      />
      <section
        aria-label={t("Member library")}
        className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-(--ui-tone-neutral-border) p-3"
      >
        <span className="min-w-0 flex-1 text-ui-body">
          <span className="block font-medium">{t("Member library")}</span>
          <span className="block text-ui-caption text-(--ui-text-secondary)">
            {source
              ? t("From library: {p0}", { p0: source.name })
              : t("Reuse this member in other crews.")}
          </span>
        </span>
        <SegmentedControl
          label={t("Library availability")}
          value={scope}
          options={[
            { value: "project", label: t("This project") },
            { value: "global", label: t("All projects") },
          ]}
          onValueChange={(value) => onScopeChange(value === "global" ? "global" : "project")}
        />
        <Button
          variant="secondary"
          disabled={pending || !agent.candidates.length || !agent.name.trim()}
          onClick={onSaveToLibrary}
        >
          {updatesProfile ? t("Update library profile") : t("Save to library")}
        </Button>
      </section>
      <Button
        variant="ghost"
        tone="danger"
        className="self-start"
        startIcon={<Trash2 className="icon-sm" />}
        onClick={onRemove}
      >
        {t("Remove from crew")}
      </Button>
    </div>
  );
}
