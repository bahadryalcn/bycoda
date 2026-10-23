import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Modal } from "../../../shared/ui/Modal";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { TextField } from "../../../shared/ui/TextField";
import { MoreHorizontal, Plus, Trash2 } from "../../../shared/ui/icons";
import { Group, Row } from "../../settings/ui/settingsControls";
import type { CrewAgent, SavedCrewAgent } from "../model/crew";
import type { ProjectCrews, useProjectCrews } from "../model/crewClient";
import {
  candidateLabel,
  catalogCandidate,
  catalogModels,
  libraryGroups,
  newCrewMember,
} from "../model/crewRoster";
import { CrewMemberForm, roleLabel } from "./CrewMemberForm";

type CrewState = ReturnType<typeof useProjectCrews>;

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
  const groupTrigger = useRef<HTMLButtonElement>(null);
  const groups = libraryGroups(data.agents);
  const activeGroup = groups.includes(group) ? group : "";
  const q = query.trim().toLocaleLowerCase();
  const agents = data.agents
    .filter((agent) => !activeGroup || agent.groups?.includes(activeGroup))
    .filter(
      (agent) =>
        !q ||
        `${agent.name} ${agent.instructions} ${(agent.groups ?? []).join(" ")}`
          .toLocaleLowerCase()
          .includes(q),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
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
        {data.agents.length ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
            <SearchInput
              appearance="field"
              containerClassName="min-w-40 flex-1"
              aria-label={t("Search members")}
              placeholder={t("Search members")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {groups.length ? (
              <SearchableSelect
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
                <MoreHorizontal className="icon-md" />
              </Button>
            ) : null}
          </div>
        ) : null}
        {!data.agents.length ? (
          <Row
            label={t("No library members yet")}
            description={t("Create one here, or save a crew member to the library from its crew.")}
          />
        ) : !agents.length ? (
          <Row label={t("No matching members.")} />
        ) : (
          agents.map((agent) => (
            <Row
              key={agent.id}
              label={
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="truncate">{agent.name}</span>
                  {agent.groups?.map((name) => (
                    <Badge key={name} size="sm">
                      {name}
                    </Badge>
                  ))}
                </span>
              }
              description={[
                roleLabel(agent.role),
                candidateLabel(data.catalog, agent.candidates[0]),
                agent.projectId ? t("This project") : t("All projects on this host"),
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <Button variant="ghost" onClick={() => setEditing(agent)}>
                {t("Edit")}
              </Button>
            </Row>
          ))
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const gate = useRef(false);
  const run = async (operation: () => Promise<unknown>) => {
    if (gate.current) return;
    gate.current = true;
    setPending(true);
    setError("");
    try {
      await operation();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      gate.current = false;
      setPending(false);
    }
  };
  const valid = !!agent.name.trim() && !!agent.candidates.length;
  const save = (copy: boolean) => {
    if (!valid) {
      setShowIssues(true);
      return;
    }
    const projectId = (copy ? "global" : scope) === "project" ? data.project.id : undefined;
    void run(() =>
      state.call("crews.agent.save", {
        agent: {
          ...agent,
          name: agent.name.trim(),
          id: saved && !copy ? saved.id : crypto.randomUUID(),
          projectId,
        },
        expectedUpdatedAt: saved && !copy ? saved.updatedAt : undefined,
      }),
    );
  };
  return (
    <Modal
      title={saved ? saved.name : t("New library member")}
      size="md"
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          {saved && data.deleteSupported ? (
            <ConfirmMorph
              label={t("Delete")}
              icon={<Trash2 aria-hidden className="icon-sm" />}
              tone="danger"
              confirmMode="press"
              onConfirm={async () => {
                setError("");
                try {
                  await state.call("crews.agent.delete", { agentId: saved.id });
                  onClose();
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : String(reason));
                  throw reason;
                }
              }}
            />
          ) : null}
          <span className="min-w-0 flex-1" />
          {saved?.projectId ? (
            <Button variant="ghost" disabled={pending} onClick={() => save(true)}>
              {t("Copy to all projects")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            loading={pending}
            disabled={pending}
            onClick={() => save(false)}
          >
            {t("Save")}
          </Button>
        </>
      }
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3 border-0 p-4 pt-2">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <CrewMemberForm
          cwd={cwd}
          catalog={data.catalog}
          agent={agent}
          onChange={(patch) => setAgent((current) => ({ ...current, ...patch }))}
          groups={data.groupsSupported}
          groupSuggestions={groupNames}
          nameError={showIssues && !agent.name.trim() ? t("Add a name") : undefined}
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
  const members = data.agents.filter((agent) => agent.groups?.includes(group));
  const apply = async () => {
    const next = name.trim().slice(0, 40);
    if (kind === "rename" && (!next || next === group)) return onClose();
    setPending(true);
    setError("");
    try {
      // Groups are labels on each profile; members are never removed with a group.
      for (const agent of members) {
        const groups = [
          ...new Set(
            (agent.groups ?? []).flatMap((item) =>
              item !== group ? [item] : kind === "rename" ? [next] : [],
            ),
          ),
        ];
        const { updatedAt, ...profile } = agent;
        await state.call("crews.agent.save", {
          agent: { ...profile, groups: groups.length ? groups : undefined },
          expectedUpdatedAt: updatedAt,
        });
      }
      onDone(kind === "rename" ? next : undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
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
      <div className="flex flex-col gap-3 p-4 pt-2">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {kind === "rename" ? (
          <TextField
            label={t("Group name")}
            value={name}
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
