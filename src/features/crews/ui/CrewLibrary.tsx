import { ActionHost } from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { truncateCodeUnits } from "../../../shared/lib/text/truncate";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { MoreHorizontal } from "../../../shared/ui/icons";
import { CollectionToolbar } from "../../settings/ui/SettingsCollection";
import { memberOf } from "../model/crewMembership";
import { groupNameTaken, groupUpdateParams } from "../model/crewGroups";
import type { SavedCrewAgent } from "../model/crew";
import type { ProjectCrews, useProjectCrews } from "../model/crewClient";
import { useCrewModelPools } from "../model/crewModelPools";
import { libraryGroups } from "../model/crewRoster";
import { CrewMemberIdentity, CrewMemberMeta, visibleLibraryMembers } from "./CrewLibraryMemberMeta";
import { CrewLibraryBulkBar } from "./CrewLibraryBulk";
import { CrewLibraryProfileDialog } from "./CrewLibraryProfileDialog";
import { CrewMemberTeamError, CrewMemberTeamMenu, CrewMemberTeams } from "./CrewLibraryTeams";
import { rosterSearchable } from "./CrewMemberTable";
import { useCrewAssignment } from "./useCrewAssignment";
import { presentRemoteError } from "../../connections/public/remoteFailure";

type CrewState = ReturnType<typeof useProjectCrews>;

/**
 * Reusable member profiles: this project's, plus those shared with every project on this host.
 * Search, the group filter, row selection and the bulk bar appear once the library is long
 * (`rosterSearchable`). The page header owns the New member action: it opens the profile dialog
 * through `newMemberOpen`.
 */
export function CrewLibrary({
  cwd,
  state,
  data,
  newMemberOpen,
  onNewMember,
  onNewMemberClose,
}: {
  cwd: string;
  state: CrewState;
  data: ProjectCrews;
  /** The profile dialog for a new member is open. */
  newMemberOpen: boolean;
  /** The empty library's New member button; the page header offers the same action. */
  onNewMember: () => void;
  onNewMemberClose: () => void;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [editing, setEditing] = useState<SavedCrewAgent | null>(null);
  const [groupDialog, setGroupDialog] = useState<"rename" | "delete" | null>(null);
  const [groupMenu, setGroupMenu] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const groupTrigger = useRef<HTMLButtonElement>(null);
  const assignment = useCrewAssignment(state, data);
  const teamIds = memberOf(data.definitions);
  const teamsOf = (id: string) => data.definitions.filter((d) => teamIds.get(id)?.includes(d.id));
  const hostPools = useCrewModelPools(data.machine.id, data.modelPoolsSupported === true);
  const poolNames = new Map(hostPools.pools.map((pool) => [pool.id, pool.name]));
  const groups = libraryGroups(data.agents);
  const activeGroup = groups.includes(group) ? group : "";
  const long = rosterSearchable(data.agents.length, !!query.trim() || !!activeGroup);
  // Search matches what each row shows plus its instructions (CR-E06).
  const agents = visibleLibraryMembers(data.agents, data.catalog, query, activeGroup);
  return (
    <>
      {!data.agents.length ? (
        <EmptyState
          context="panel"
          kind="empty"
          title={t("No library members yet")}
          action={{ label: t("New member"), onClick: onNewMember }}
        />
      ) : (
        <div
          {...surfaceAttributes(
            { variant: "canvas", frame: "pane", radius: "row" },
            "settings-collection",
          )}
        >
          {long ? (
            <CollectionToolbar
              label={t("Search name, role, model or group")}
              query={query}
              onQueryChange={setQuery}
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
              {activeGroup && data.groupUpdateSupported ? (
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
          ) : null}
          {long && agents.length ? (
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
          {/* The shared collection list caps its height and scrolls inside; the library
                grows with its rows and scrolls with the page instead. */}
          <ScrollArea
            gutter="stable"
            {...surfaceAttributes(
              { separator: "block" },
              "settings-collection-list max-h-none! overflow-visible!",
            )}
            role="region"
            aria-label={t("Member library")}
          >
            {!agents.length ? (
              <EmptyState
                size="inline"
                kind="filtered"
                description={t("No matching members")}
                resetLabel={t("Clear filters")}
                onReset={() => {
                  setQuery("");
                  setGroup("");
                }}
              />
            ) : null}
            {agents.map((agent) => (
              <ActionHost
                key={agent.id}
                {...surfaceAttributes(
                  { radius: "none", separator: "block" },
                  "settings-collection-row",
                )}
              >
                {long ? (
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
                ) : null}
                <div className="settings-collection-main">
                  {/* Identity is data, not help text: it stays visible in the row. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <Text
                      as="span"
                      size="secondary"
                      tone="primary"
                      weight="medium"
                      leading="normal"
                      truncate
                      className="settings-collection-title min-w-0 max-w-full"
                    >
                      <CrewMemberIdentity agent={agent} />
                    </Text>
                    {agent.groups?.length ? (
                      <div className="min-w-0 max-w-full">
                        <BadgeList
                          label={t("Groups")}
                          items={agent.groups.map((name) => ({ id: name, label: name }))}
                        />
                      </div>
                    ) : null}
                  </div>
                  <CrewMemberMeta
                    agent={agent}
                    catalog={data.catalog}
                    poolName={
                      agent.modelChoice?.kind === "pool"
                        ? poolNames.get(agent.modelChoice.poolId)
                        : undefined
                    }
                  />
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
              </ActionHost>
            ))}
          </ScrollArea>
        </div>
      )}
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
      {editing || newMemberOpen ? (
        <CrewLibraryProfileDialog
          cwd={cwd}
          state={state}
          data={data}
          saved={editing ?? undefined}
          onClose={() => {
            setEditing(null);
            onNewMemberClose();
          }}
        />
      ) : null}
    </>
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
  const gate = useRef(false);
  const members = data.agents.filter((agent) => agent.groups?.includes(group));
  const next = truncateCodeUnits(name.trim(), 40);
  // Renaming onto an existing group would silently merge the two, so it is refused.
  const taken = kind === "rename" && groupNameTaken(data.agents, group, next);
  const apply = async () => {
    if (gate.current) return;
    if (kind === "rename" && (!next || next === group)) return onClose();
    if (taken) return;
    gate.current = true;
    setPending(true);
    setError("");
    try {
      const refreshed = await state.refetch();
      if (refreshed.error) throw refreshed.error;
      // Groups are labels on each profile; members are never removed with a group. The Host
      // moves every member in one transaction, so a failure leaves the group untouched.
      await state.call(
        "crews.agent.group.update",
        groupUpdateParams(
          (refreshed.data ?? data).agents,
          group,
          kind === "rename" ? next : undefined,
        ),
      );
      onDone(kind === "rename" ? next : undefined);
    } catch (reason) {
      setError(presentRemoteError(reason, { explicit: true }));
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
            variant={kind === "delete" ? "secondary" : "primary"}
            tone={kind === "delete" ? "danger" : undefined}
            loading={pending}
            disabled={pending || (kind === "rename" && (!name.trim() || taken))}
            disabledReason={
              kind === "rename" && !name.trim()
                ? t("Enter a name first.")
                : kind === "rename" && taken
                  ? t("A group with this name already exists")
                  : undefined
            }
            onClick={() => void apply()}
          >
            {kind === "rename" ? t("Rename") : t("Delete group")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <InlineError details={error} /> : null}
        {kind === "rename" ? (
          <TextField
            label={t("Group name")}
            value={name}
            disabled={pending}
            maxLength={40}
            autoFocus
            error={taken ? t("A group with this name already exists") : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        ) : (
          <Text as="p" size="body" tone="inherit">
            {members.length === 1
              ? t("{p0} member leaves this group. The member itself is kept.", { p0: 1 })
              : t("{p0} members leave this group. The members themselves are kept.", {
                  p0: members.length,
                })}
          </Text>
        )}
      </div>
    </Modal>
  );
}
