import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Badge } from "../../../shared/ui/Badge";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { TextField } from "../../../shared/ui/TextField";
import { MoreHorizontal, Plus, Trash2 } from "../../../shared/ui/icons";
import { Group, Row } from "../../settings/ui/settingsControls";
import { CollectionToolbar } from "../../settings/ui/SettingsCollection";
import { memberOf } from "../model/crewMembership";
import { parseCrewAgent, type CrewAgent, type SavedCrewAgent } from "../model/crew";
import type { ProjectCrews, useProjectCrews } from "../model/crewClient";
import { catalogCandidate, catalogModels, libraryGroups, newCrewMember } from "../model/crewRoster";
import { CrewMemberIdentity, CrewMemberMeta, visibleLibraryMembers } from "./CrewLibraryMemberMeta";
import { CrewLibraryBulkBar } from "./CrewLibraryBulk";
import { CrewMemberForm } from "./CrewMemberForm";
import { CrewMemberTeamError, CrewMemberTeamMenu, CrewMemberTeams } from "./CrewLibraryTeams";
import { useCrewAssignment } from "./useCrewAssignment";

type CrewState = ReturnType<typeof useProjectCrews>;

function savedProfileMatches(saved: SavedCrewAgent, profile: CrewAgent & { projectId?: string }) {
  if (saved.projectId !== profile.projectId) return false;
  // The host validates profiles and deliberately clears inferred capabilities.
  const expected = parseCrewAgent(profile);
  for (const candidate of expected.candidates) candidate.capabilities = {};
  return JSON.stringify(parseCrewAgent(saved)) === JSON.stringify(expected);
}

/** Reusable member profiles: this project's, plus those shared with every project on this host. */
export function CrewLibrary({
  cwd,
  state,
  data,
}: {
  cwd: string;
  state: CrewState;
  data: ProjectCrews;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [editing, setEditing] = useState<SavedCrewAgent | "new" | null>(null);
  const [groupDialog, setGroupDialog] = useState<"rename" | "delete" | null>(null);
  const [groupMenu, setGroupMenu] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const groupTrigger = useRef<HTMLButtonElement>(null);
  const assignment = useCrewAssignment(state, data);
  const teamIds = memberOf(data.definitions);
  const teamsOf = (id: string) => data.definitions.filter((d) => teamIds.get(id)?.includes(d.id));
  const groups = libraryGroups(data.agents);
  const activeGroup = groups.includes(group) ? group : "";
  // Search matches what each row shows plus its instructions (CR-E06).
  const agents = visibleLibraryMembers(data.agents, data.catalog, query, activeGroup);
  return (
    <>
      <Group
        title={t("Member library")}
        description={t(
          "Save a member once and add it to crews here or in other projects on this host.",
        )}
        action={
          <Button
            variant="ghost"
            startIcon={<Plus className="icon-sm" />}
            onClick={() => setEditing("new")}
          >
            {t("New member")}
          </Button>
        }
      >
        {!data.agents.length ? (
          <Row
            label={t("No library members yet")}
            description={t("Create one here, or save a crew member to the library from its crew.")}
            descriptionVisible
          />
        ) : (
          <div className="settings-collection">
            <CollectionToolbar
              label={t("Search name, role, model or group")}
              query={query}
              onQueryChange={setQuery}
              count={t("Showing {p0} of {p1} members", {
                p0: agents.length,
                p1: data.agents.length,
              })}
            >
              {groups.length ? (
                <SearchableSelect
                  hideLabel
                  label={t("Member group")}
                  value={activeGroup}
                  options={[
                    { value: "", label: t("All groups") },
                    ...groups.map((name) => ({ value: name, label: name })),
                  ]}
                  onChange={setGroup}
                />
              ) : null}
              {activeGroup && data.groupsSupported ? (
                <Button
                  ref={groupTrigger}
                  variant="ghost"
                  iconOnly
                  label={t("Group options")}
                  aria-haspopup="menu"
                  aria-expanded={groupMenu}
                  onClick={() => setGroupMenu(true)}
                >
                  <MoreHorizontal className="icon-sm" />
                </Button>
              ) : null}
            </CollectionToolbar>
            {agents.length ? (
              <CrewLibraryBulkBar
                cwd={cwd}
                state={state}
                data={data}
                visible={agents}
                assignment={assignment}
                selected={selected}
                onSelectedChange={setSelected}
              />
            ) : null}
            <div
              className="settings-collection-list"
              role="region"
              aria-label={t("Member library")}
              tabIndex={0}
            >
              {!agents.length ? (
                <EmptyState
                  size="inline"
                  kind="filtered"
                  description={t("No matching members.")}
                  resetLabel={t("Clear filters")}
                  onReset={() => {
                    setQuery("");
                    setGroup("");
                  }}
                />
              ) : null}
              {agents.map((agent) => (
                <div key={agent.id} className="settings-collection-row">
                  <Checkbox
                    aria-label={t("Select {p0}", { p0: agent.name })}
                    checked={selected.has(agent.id)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(agent.id);
                        else next.delete(agent.id);
                        return next;
                      })
                    }
                  />
                  <div className="settings-collection-main">
                    {/* Identity is data, not help text: it stays visible in the row. */}
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="settings-collection-title min-w-0">
                        <CrewMemberIdentity agent={agent} />
                      </span>
                      {agent.groups?.length ? (
                        <div className="max-w-[60%] min-w-0 shrink-0">
                          <BadgeList
                            label={t("Groups")}
                            items={agent.groups.map((name) => ({ id: name, label: name }))}
                          />
                        </div>
                      ) : null}
                    </div>
                    <CrewMemberMeta agent={agent} catalog={data.catalog} />
                    <CrewMemberTeams teams={teamsOf(agent.id)} />
                    <CrewMemberTeamError assignment={assignment} id={agent.id} />
                  </div>
                  <div className="settings-collection-actions shrink-0">
                    {assignment.supported ? (
                      <CrewMemberTeamMenu
                        agent={agent}
                        definitions={data.definitions}
                        memberTeamIds={teamIds.get(agent.id) ?? []}
                        assignment={assignment}
                      />
                    ) : null}
                    <Button
                      variant="ghost"
                      aria-label={t("Edit {p0}", { p0: agent.name })}
                      onClick={() => setEditing(agent)}
                    >
                      {t("Edit")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Group>
      {groupMenu ? (
        <DropdownMenu
          anchor={groupTrigger}
          label={t("Group options")}
          items={[
            { kind: "item", id: "rename", label: t("Rename group") },
            {
              kind: "item",
              id: "delete",
              label: t("Delete group"),
              danger: true,
            },
          ]}
          onPick={(id) => setGroupDialog(id === "delete" ? "delete" : "rename")}
          onClose={() => setGroupMenu(false)}
        />
      ) : null}
      {groupDialog && activeGroup ? (
        <GroupDialog
          kind={groupDialog}
          group={activeGroup}
          state={state}
          data={data}
          onDone={(next) => {
            setGroup(next ?? "");
            setGroupDialog(null);
          }}
          onClose={() => setGroupDialog(null)}
        />
      ) : null}
      {editing ? (
        <LibraryMemberDialog
          cwd={cwd}
          state={state}
          data={data}
          saved={editing === "new" ? undefined : editing}
          groupNames={groups}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function LibraryMemberDialog({
  cwd,
  state,
  data,
  saved,
  groupNames,
  onClose,
}: {
  cwd: string;
  state: CrewState;
  data: ProjectCrews;
  saved?: SavedCrewAgent;
  groupNames: string[];
  onClose: () => void;
}) {
  useLocale();
  const [agent, setAgent] = useState<CrewAgent>(() => {
    if (saved) {
      const { projectId: _scope, updatedAt: _updated, ...profile } = structuredClone(saved);
      return profile;
    }
    const first = catalogModels(data.catalog)[0];
    return newCrewMember(
      "specialist",
      "",
      first ? catalogCandidate(data.catalog, `${first.harness}/${first.id}`) : undefined,
    );
  });
  const [scope, setScope] = useState<"project" | "global">(
    saved ? (saved.projectId ? "project" : "global") : "project",
  );
  const [pendingAction, setPendingAction] = useState<"save" | "copy" | "delete" | null>(null);
  const pending = pendingAction !== null;
  const [error, setError] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const gate = useRef(false);
  const copyId = useRef<string | null>(null);
  const attemptedIds = useRef(new Set<string>());
  const run = async (action: "save" | "copy", operation: () => Promise<unknown>) => {
    if (gate.current) return;
    gate.current = true;
    setPendingAction(action);
    setError("");
    try {
      await operation();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      gate.current = false;
      setPendingAction(null);
    }
  };
  const valid = !!agent.name.trim() && !!agent.candidates.length;
  // An edit in progress is not dropped by a stray Escape or backdrop click (CWS-05).
  const [initial] = useState(() => JSON.stringify([agent, scope]));
  const dirty = JSON.stringify([agent, scope]) !== initial;
  const { confirm, dialog: confirmDialog } = useConfirm();
  const requestClose = () => {
    if (pending) return;
    if (!dirty) return onClose();
    void confirm({
      title: t("Discard changes?"),
      message: t("Your edits to this member have not been saved."),
      confirmLabel: t("Discard changes"),
    }).then((ok) => {
      if (ok) onClose();
    });
  };
  const save = (copy: boolean) => {
    if (!valid) {
      setShowIssues(true);
      return;
    }
    const projectId = (copy ? "global" : scope) === "project" ? data.project.id : undefined;
    if (copy && !copyId.current) copyId.current = crypto.randomUUID();
    const profile = {
      ...agent,
      name: agent.name.trim(),
      id: copy ? copyId.current! : (saved?.id ?? agent.id),
      projectId,
    };
    void run(copy ? "copy" : "save", async () => {
      if (attemptedIds.current.has(profile.id)) {
        const refreshed = await state.refetch();
        if (refreshed.error) throw refreshed.error;
        const receipt = refreshed.data?.agents.find((item) => item.id === profile.id);
        if (receipt && savedProfileMatches(receipt, profile)) return receipt;
      }
      attemptedIds.current.add(profile.id);
      return await state.call("crews.agent.save", {
        agent: profile,
        expectedUpdatedAt: saved && !copy ? saved.updatedAt : undefined,
      });
    });
  };
  return (
    <Modal
      title={saved ? saved.name : t("New library member")}
      size="md"
      onClose={requestClose}
      footer={
        <>
          {saved && data.deleteSupported ? (
            <ConfirmMorph
              label={t("Delete")}
              icon={<Trash2 aria-hidden className="icon-sm" />}
              tone="danger"
              confirmMode="press"
              disabled={pending}
              onConfirm={async () => {
                if (gate.current) return;
                gate.current = true;
                setPendingAction("delete");
                setError("");
                try {
                  await state.call("crews.agent.delete", { agentId: saved.id });
                  onClose();
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : String(reason));
                  throw reason;
                } finally {
                  gate.current = false;
                  setPendingAction(null);
                }
              }}
            />
          ) : null}
          <span className="min-w-0 flex-1" />
          {saved?.projectId ? (
            <Button
              variant="ghost"
              loading={pendingAction === "copy"}
              disabled={pending}
              onClick={() => save(true)}
            >
              {t("Copy to all projects")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            loading={pendingAction === "save"}
            disabled={pending}
            onClick={() => save(false)}
          >
            {t("Save")}
          </Button>
        </>
      }
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3 border-0">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <CrewMemberForm
          cwd={cwd}
          catalog={data.catalog}
          agent={agent}
          identity={data.identitySupported}
          tools={data.toolsSupported}
          handleError={/handle/i.test(error) ? error : undefined}
          onChange={(patch) => setAgent((current) => ({ ...current, ...patch }))}
          groups={data.groupsSupported}
          groupSuggestions={groupNames}
          nameError={showIssues && !agent.name.trim() ? t("Add a name") : undefined}
          modelError={showIssues && !agent.candidates.length ? t("Choose a model") : undefined}
          autoFocus={!saved}
        />
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="text-ui-body font-medium">{t("Available in")}</span>
          {saved ? (
            <Badge size="md">
              {saved.projectId ? t("This project") : t("All projects on this host")}
            </Badge>
          ) : (
            <SegmentedControl
              label={t("Available in")}
              value={scope}
              options={[
                { value: "project", label: t("This project") },
                { value: "global", label: t("All projects") },
              ]}
              onValueChange={(value) => setScope(value === "global" ? "global" : "project")}
            />
          )}
        </div>
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {t("Crews keep their own copy. Changes here reach a crew only when you update it there.")}
        </p>
        {confirmDialog}
      </fieldset>
    </Modal>
  );
}

function GroupDialog({
  kind,
  group,
  state,
  data,
  onDone,
  onClose,
}: {
  kind: "rename" | "delete";
  group: string;
  state: CrewState;
  data: ProjectCrews;
  onDone: (group?: string) => void;
  onClose: () => void;
}) {
  useLocale();
  const [name, setName] = useState(group);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const gate = useRef(false);
  const members = data.agents.filter((agent) => agent.groups?.includes(group));
  const apply = async () => {
    if (gate.current) return;
    const next = name.trim().slice(0, 40);
    if (kind === "rename" && (!next || next === group)) return onClose();
    gate.current = true;
    setPending(true);
    setError("");
    try {
      const refreshed = await state.refetch();
      if (refreshed.error) throw refreshed.error;
      const currentMembers = (refreshed.data ?? data).agents.filter((agent) =>
        agent.groups?.includes(group),
      );
      // Groups are labels on each profile; members are never removed with a group.
      for (const agent of currentMembers) {
        const groups = [
          ...new Set(
            (agent.groups ?? []).flatMap((item) =>
              item !== group ? [item] : kind === "rename" ? [next] : [],
            ),
          ),
        ];
        const { updatedAt, ...profile } = agent;
        setAttempted(true);
        await state.call("crews.agent.save", {
          agent: { ...profile, groups: groups.length ? groups : undefined },
          expectedUpdatedAt: updatedAt,
        });
      }
      onDone(kind === "rename" ? next : undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      gate.current = false;
      setPending(false);
    }
  };
  return (
    <Modal
      title={kind === "rename" ? t("Rename group") : t("Delete group {p0}?", { p0: group })}
      size="sm"
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          <span className="min-w-0 flex-1" />
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant={kind === "delete" ? "danger" : "primary"}
            loading={pending}
            disabled={pending || (kind === "rename" && !name.trim())}
            onClick={() => void apply()}
          >
            {kind === "rename" ? t("Rename") : t("Delete group")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {kind === "rename" ? (
          <TextField
            label={t("Group name")}
            value={name}
            disabled={pending || attempted}
            maxLength={40}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        ) : (
          <p className="text-ui-body">
            {t("{p0} members leave this group. The members themselves are kept.", {
              p0: members.length,
            })}
          </p>
        )}
      </div>
    </Modal>
  );
}
