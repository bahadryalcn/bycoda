import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { ArrowLeft, MoreHorizontal, Plus } from "../../../shared/ui/icons";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import {
  sprintProjectKey,
  type HostSprint,
  type SprintProjectRef,
  type SprintReport,
} from "../model/hostSprints";
import type { SprintBoardController } from "../model/sprintClient";
import { dateNumber, dateValue } from "../model/sprintDates";
import { SprintCatalog } from "./SprintCatalog";
import { SprintCompletion } from "./SprintCompletion";
import { sprintDateRange } from "./sprintDateRange";
import { SprintEditor } from "./SprintEditor";
import { SprintGoalDescription } from "./SprintGoalDescription";
import { SprintHostBar, sprintServerChoice } from "./SprintHostBar";
import { SprintReports } from "./SprintReports";
import { SprintStatusBadge } from "./SprintStatusBadge";
import "./sprints.css";
import { presentRemoteError } from "../../connections/public/remoteFailure";

export { dateValue as sprintDateValue, dateNumber as sprintDateNumber };
export { SprintGoalDescription };

/**
 * The sprint list, and the page of one selected sprint: header with its one primary action,
 * dates and goal, then the report. Starting, completing, archiving and editing stay here.
 */
export function SprintManagement({
  board,
  projects,
  selectedId,
  onSelect,
  projectKey,
  environmentId,
}: {
  board: SprintBoardController;
  projects: readonly SprintProjectRef[];
  selectedId: string;
  onSelect: (id: string) => void;
  projectKey?: string;
  environmentId?: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState<HostSprint | "new" | null>(null);
  const [completing, setCompleting] = useState<SprintReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<HTMLButtonElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const accessible = new Set(projects.map(sprintProjectKey));
  const rows = board.sprints.filter(
    (sprint) =>
      sprint.projects.some((project) => accessible.has(sprintProjectKey(project))) &&
      (!projectKey || sprint.projects.some((project) => sprintProjectKey(project) === projectKey)),
  );
  const selected = rows.find((sprint) => sprint.id === selectedId);
  const fullyAccessible = (sprint: HostSprint) =>
    sprint.projects.every((project) => accessible.has(sprintProjectKey(project)));
  const act = async (id: string, operation: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(id);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      setError(presentRemoteError(reason, { explicit: true }));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };
  const canNew = board.supported && projects.length > 0;
  const lifecycleBlock = selected ? board.lifecycleIssue(selected) : null;
  const server = sprintServerChoice(board, t("Selected Host is unavailable"));
  const manage = selected && fullyAccessible(selected);
  const dates = selected ? sprintDateRange(selected, t) : "";
  const menuItems = selected
    ? [
        ...(manage && (selected.state === "planned" || selected.state === "active")
          ? [{ kind: "item" as const, id: "edit", label: t("Edit sprint") }]
          : []),
        ...(manage && selected.state === "completed"
          ? [{ kind: "item" as const, id: "archive", label: t("Archive sprint") }]
          : []),
        { kind: "item" as const, id: "new", label: t("New sprint"), disabled: !canNew },
      ]
    : [];
  return (
    <Text
      as="section"
      size="secondary"
      tone="primary"
      leading="inherit"
      {...surfaceAttributes({ frame: "pane", edge: "bottom" }, "sprint-management")}
      data-selected={selected ? "" : undefined}
      aria-label={t("Sprints")}
    >
      {selected ? (
        <PaneHeader
          leading={
            <Button
              variant="ghost"
              iconOnly
              label={t("All sprints")}
              disabled={!!busy}
              onClick={() => onSelect("")}
            >
              <ArrowLeft aria-hidden className="icon-sm" strokeWidth={1.75} />
            </Button>
          }
          title={selected.name}
          meta={<SprintStatusBadge state={selected.state} />}
          primaryAction={
            manage && selected.state === "planned" ? (
              <Button
                variant="primary"
                loading={busy === "start"}
                disabled={!!busy || !!lifecycleBlock}
                disabledReason={lifecycleBlock ?? undefined}
                onClick={() => void act("start", () => board.command(selected, "start"))}
              >
                {t("Start sprint")}
              </Button>
            ) : manage && selected.state === "active" ? (
              <Button
                variant="primary"
                loading={busy === "complete"}
                disabled={!!busy || !!lifecycleBlock}
                disabledReason={lifecycleBlock ?? undefined}
                onClick={() =>
                  void act("complete", async () => setCompleting(await board.report(selected.id)))
                }
              >
                {t("Complete sprint")}
              </Button>
            ) : undefined
          }
          actions={
            <Button
              variant="ghost"
              iconOnly
              label={t("More actions")}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              disabled={!!busy}
              onClick={(event) => setMenu(event.currentTarget)}
            >
              <MoreHorizontal aria-hidden className="icon-sm" strokeWidth={1.75} />
            </Button>
          }
        />
      ) : (
        <PaneHeader
          title={t("Sprints")}
          primaryAction={
            <Button
              variant="primary"
              startIcon={<Plus className="icon-xs" />}
              disabled={!canNew || !!busy}
              disabledReason={
                board.supported
                  ? t("Add a project before creating a sprint.")
                  : t("Selected Host is unavailable")
              }
              onClick={() => setEditing("new")}
            >
              {t("New sprint")}
            </Button>
          }
        />
      )}
      <div className="sprint-management-body">
        <SprintHostBar board={board} error={error || (selected ? board.error : null)} />
        {selected && dates ? (
          <Text tone="secondary" size="caption" leading="inherit">
            {dates}
          </Text>
        ) : null}
        {selected?.goal ? <SprintGoalDescription goal={selected.goal} /> : null}
        {selected && !fullyAccessible(selected) ? (
          <Text as="p" size="inherit" tone="secondary">
            {t(
              "Only accessible projects are shown. Unlock all sprint projects to manage this sprint.",
            )}
          </Text>
        ) : null}
        {/* The sprint's tasks follow this section; the report stays one click away so they keep the room. */}
        {selected && board.supported ? (
          <Disclosure summary={t("Report")}>
            <SprintReports
              embedded
              board={board}
              sprintId={selected.id}
              projectKey={projectKey}
              environmentId={environmentId}
            />
          </Disclosure>
        ) : null}
        {!selected ? (
          <SprintCatalog
            board={board}
            projects={projects}
            projectKey={projectKey}
            environmentId={environmentId}
            onSelect={onSelect}
          />
        ) : null}
      </div>
      {menu && selected ? (
        <DropdownMenu
          anchor={menu}
          label={t("More actions")}
          items={menuItems}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            if (id === "edit") setEditing(selected);
            else if (id === "new") setEditing("new");
            else if (id === "archive")
              void act("archive", () => board.command(selected, "archive"));
          }}
        />
      ) : null}
      {editing ? (
        <SprintEditor
          key={editing === "new" ? "new" : editing.id}
          sprint={editing === "new" ? undefined : editing}
          projects={projects}
          defaultProjectKey={projectKey}
          machines={board.machines}
          server={server.show ? server : undefined}
          onClose={() => setEditing(null)}
          onSave={async (fields) => {
            const saved =
              editing === "new"
                ? await board.create(fields)
                : await board.update(editing, {
                    ...fields,
                    goal: fields.goal ?? null,
                    startsAt: fields.startsAt ?? null,
                    endsAt: fields.endsAt ?? null,
                  });
            setEditing(null);
            onSelect(saved.id);
          }}
        />
      ) : null}
      {completing ? (
        <SprintCompletion
          board={board}
          report={completing}
          onClose={() => setCompleting(null)}
          onComplete={async (options) => {
            await board.command(completing.sprint, "complete", options);
            setCompleting(null);
          }}
        />
      ) : null}
    </Text>
  );
}
