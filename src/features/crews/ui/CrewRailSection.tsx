import { useEffect, useRef, useState, type MouseEvent } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { ActionHost, InlineAction, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { InlineError } from "../../../shared/ui/InlineError";
import type { PopoverAnchor } from "../../../shared/ui/Popover";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { Bot, Copy, Globe, Pencil, Play, Plus, Trash2 } from "../../../shared/ui/icons";
import {
  RAIL_SECTION_BLOCK,
  RailSectionHeader,
  type RailSectionDrag,
} from "../../../app/shell/useRailSections";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import type { CrewDefinition } from "../model/crew";
import { useProjectCrews, type CrewRunView } from "../model/crewClient";
import { useCrewsOnRail } from "../model/crewAppearance";
import { activeCrewRuns, crewRunTitle } from "../model/crewRoster";
import { CrewAvatar } from "./CrewAvatar";
import { CrewManagementDialog } from "./CrewSessions";
import {
  crewAttentionLabel,
  crewHasRunningWork,
  crewRunAttention,
  crewWorkStatusLabel,
  type CrewAttention,
  type CrewWorkStatus,
} from "../model/crewPresentation";
export { crewWorkStatus, crewWorkStatusLabel } from "../model/crewPresentation";
import { lazySurface } from "../../../shared/ui/lazySurface";
import type { CrewEditorPage } from "./CrewEditor";

const CrewDeleteDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).CrewDeleteDialog,
}));
const CrewEditDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).CrewEditDialog,
}));
const StartCrewDialog = lazySurface(async () => ({
  default: (await import("./CrewDialogs")).StartCrewDialog,
}));

/** Execution state only; what needs the owner is `CrewAttention` and takes the dot. */
type RailExecution = Extract<CrewWorkStatus, "working" | "paused" | "active">;

const ATTENTION_DOT: Record<CrewAttention, BadgeTone> = {
  decision: "warning",
  review: "warning",
  blocked: "danger",
};
const EXECUTION_DOT: Record<Exclude<RailExecution, "working">, BadgeTone> = {
  paused: "neutral",
  active: "neutral",
};

// Most urgent first: the rail shows the strongest signal across a crew's ongoing work.
const ATTENTION_RANK: CrewAttention[] = ["decision", "review", "blocked"];
const EXECUTION_RANK: RailExecution[] = ["working", "paused", "active"];

/** A crew's rail signal: attention (decision, review, blocker) is independent of paused or working. */
function railSignal(runs: readonly CrewRunView[]) {
  const attention = runs
    .map(crewRunAttention)
    .filter((value): value is CrewAttention => value !== null)
    .sort((a, b) => ATTENTION_RANK.indexOf(a) - ATTENTION_RANK.indexOf(b))[0];
  const execution = runs
    .map((run): RailExecution =>
      run.status === "paused" ? "paused" : crewHasRunningWork(run) ? "working" : "active",
    )
    .sort((a, b) => EXECUTION_RANK.indexOf(a) - EXECUTION_RANK.indexOf(b))[0];
  return { attention, execution };
}

type Dialog =
  | {
      kind: "edit";
      crewId?: string;
      createScope?: "project" | "global";
      copyOf?: { crewId: string; scope: "project" | "global" };
      initialPage?: CrewEditorPage;
      /** Editing from the start dialog returns to it with the written delivery. */
      returnToStart?: string;
    }
  | { kind: "start"; definitionId?: string }
  | { kind: "delete"; crewId: string }
  | { kind: "work"; crewId: string };

type Menu = { kind: "crew" | "work"; crewId: string; anchor: PopoverAnchor };

/** The project rail's crew list: open a crew's work, start new work or manage it from "…". */
export function CrewRailSection({
  cwd,
  drag,
  collapsed = false,
  onToggleCollapsed,
  onShownChange,
  onOpenSession,
}: {
  cwd: string;
  drag: RailSectionDrag;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onShownChange?: (shown: boolean) => void;
  onOpenSession?: (target: BackgroundSessionTarget) => void | Promise<void>;
}) {
  useLocale();
  const onRail = useCrewsOnRail();
  // Hidden from the rail: no host polling for a section that is not shown.
  const state = useProjectCrews(cwd, onRail);
  const data = state.data;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [pendingCrew, setPendingCrew] = useState<string | null>(null);
  const pending = pendingCrew !== null;
  const [error, setError] = useState("");
  const pendingGate = useRef(false);
  const shown = !!data && onRail;
  useEffect(() => {
    onShownChange?.(shown);
    return () => onShownChange?.(false);
  }, [shown, onShownChange]);
  if (!data || !onRail) return null;

  const act = async (crewId: string, operation: () => Promise<unknown>) => {
    if (pendingGate.current) return;
    pendingGate.current = true;
    setPendingCrew(crewId);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingGate.current = false;
      setPendingCrew(null);
    }
  };
  const openCoordinator = (run: CrewRunView) => {
    const sessionId = run.coordinatorSessionId;
    if (!sessionId || !onOpenSession) return;
    void act(run.definition.id, async () =>
      onOpenSession({
        cwd,
        machineId: data.machine.id,
        projectId: data.project.id,
        sessionId,
      }),
    );
  };
  const openCrew = (crew: CrewDefinition) => {
    setDialog({ kind: "work", crewId: crew.id });
  };
  const menuCrew = menu ? data.definitions.find((d) => d.id === menu.crewId) : undefined;
  const menuRuns = menuCrew ? activeCrewRuns(data.runs, menuCrew.id) : [];
  const single = menuRuns.length === 1 ? menuRuns[0] : undefined;
  const crewItems: DropdownMenuItem[] = menuCrew
    ? [
        ...(single?.coordinatorSessionId && onOpenSession
          ? [
              {
                kind: "item" as const,
                id: "open",
                label: t("Open coordinator"),
                description: crewRunTitle(single),
                icon: <Bot className="icon-sm" />,
              },
            ]
          : []),
        {
          kind: "item",
          id: "work",
          label: t("Crew work"),
          icon: <Bot className="icon-sm" />,
        },
        {
          kind: "item",
          id: "start",
          label: t("New work"),
          icon: <Play className="icon-sm" />,
        },
        {
          kind: "item",
          id: "edit",
          label: t("Edit crew"),
          icon: <Pencil className="icon-sm" />,
        },
        {
          kind: "item",
          id: "members",
          label: t("Add members"),
          icon: <Plus className="icon-sm" />,
        },
        {
          kind: "item",
          id: "duplicate",
          label: t("Duplicate"),
          icon: <Copy className="icon-sm" />,
        },
        {
          kind: "item",
          id: "scope",
          label: menuCrew.projectId ? t("Copy to all projects") : t("Copy to this project"),
          icon: <Globe className="icon-sm" />,
        },
        ...(data.deleteSupported
          ? [
              { kind: "sep" as const },
              {
                kind: "item" as const,
                id: "delete",
                label: t("Delete crew"),
                danger: true,
                icon: <Trash2 className="icon-sm" />,
              },
            ]
          : []),
      ]
    : [];
  const pickCrew = (id: string) => {
    if (!menuCrew) return;
    const crewId = menuCrew.id;
    const scope = menuCrew.projectId ? "global" : "project";
    if (id === "open" && single) openCoordinator(single);
    else if (id === "work") setDialog({ kind: "work", crewId });
    else if (id === "start") setDialog({ kind: "start", definitionId: crewId });
    else if (id === "edit") setDialog({ kind: "edit", crewId });
    else if (id === "members") setDialog({ kind: "edit", crewId, initialPage: "add" });
    else if (id === "duplicate")
      setDialog({
        kind: "edit",
        copyOf: { crewId, scope: menuCrew.projectId ? "project" : "global" },
      });
    else if (id === "scope") setDialog({ kind: "edit", copyOf: { crewId, scope } });
    else if (id === "delete") setDialog({ kind: "delete", crewId });
  };
  const label = t("Crews");
  const deleting =
    dialog?.kind === "delete" ? data.definitions.find((d) => d.id === dialog.crewId) : undefined;

  return (
    <div
      ref={(element) => drag.setRef(element)}
      className={RAIL_SECTION_BLOCK}
      data-collapsed={collapsed || undefined}
    >
      <RailSectionHeader
        label={label}
        drag={drag}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        actions={
          <InlineAction
            reveal="always"
            label={t("New crew")}
            motion="none"
            type="button"
            data-no-drag
            aria-haspopup="dialog"
            onClick={() => setDialog({ kind: "edit", createScope: "project" })}
          >
            <Plus className="icon-sm" strokeWidth={1.75} />
          </InlineAction>
        }
      />
      <div
        role="list"
        aria-label={label}
        hidden={drag.folded || collapsed}
        className={`flex-col gap-px px-2 ${drag.folded || collapsed ? "hidden" : "flex"}`}
      >
        {data.definitions.length === 0 ? (
          <span className="@max-[140px]/rail:hidden">
            <Button
              variant="ghost"
              motion="none"
              startIcon={<Plus className="icon-sm" />}
              onClick={() => setDialog({ kind: "edit", createScope: "project" })}
            >
              {t("Create your first crew")}
            </Button>
          </span>
        ) : null}
        {data.definitions.map((crew) => {
          const runs = activeCrewRuns(data.runs, crew.id);
          const { attention, execution } = railSignal(runs);
          const working = execution === "working";
          const scope = crew.projectId ? t("This project") : t("All projects on this host");
          // Attention is named first so a paused run with an open decision still reads
          // "Needs decision"; execution state and the run count follow.
          const statusText = [
            attention ? crewAttentionLabel(attention) : "",
            execution ? crewWorkStatusLabel(execution) : "",
            runs.length > 1 ? t("{p0} ongoing", { p0: runs.length }) : "",
          ]
            .filter(Boolean)
            .join(" · ");
          const openMenuAt = (event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu({
              kind: "crew",
              crewId: crew.id,
              anchor: { x: event.clientX, y: event.clientY },
            });
          };
          return (
            <ActionHost
              key={crew.id}
              role="listitem"
              selected={menu?.crewId === crew.id}
              className="group relative flex min-h-(--ui-control-height-compact) items-stretch"
              onContextMenu={openMenuAt}
            >
              <Button
                variant="item"
                selected={menu?.crewId === crew.id}
                motion="none"
                type="button"
                tooltip={[crew.name, scope, statusText].filter(Boolean).join("\n")}
                aria-label={[crew.name, statusText].filter(Boolean).join(", ")}
                disabled={pending}
                loading={pendingCrew === crew.id}
                onClick={() => openCrew(crew)}
                onKeyDown={(event) => {
                  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
                    return;
                  event.preventDefault();
                  setMenu({
                    kind: "crew",
                    crewId: crew.id,
                    anchor: event.currentTarget,
                  });
                }}
                className="flex min-w-0 flex-1 items-center gap-2 @max-[140px]/rail:justify-center"
              >
                <span className="relative grid icon-sm shrink-0 place-items-center">
                  <CrewAvatar crew={crew} active={working} />
                  {attention || (execution && !working) ? (
                    <StatusDot
                      label={statusText}
                      className="absolute -right-0.5 -bottom-0.5"
                      tone={
                        attention
                          ? ATTENTION_DOT[attention]
                          : EXECUTION_DOT[execution as keyof typeof EXECUTION_DOT]
                      }
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-ui-secondary font-medium @max-[140px]/rail:hidden">
                  {crew.name}
                </span>
                {working ? (
                  <span className="shrink-0 @max-[140px]/rail:hidden">
                    <WorkingIndicator size="xs" />
                  </span>
                ) : null}
                {runs.length > 1 ? (
                  <Badge
                    variant="count"
                    size="xs"
                    aria-hidden
                    className="shrink-0 @max-[140px]/rail:hidden"
                  >
                    {runs.length}
                  </Badge>
                ) : null}
              </Button>
              <span className="flex shrink-0 items-center gap-px @max-[140px]/rail:hidden!">
                {/* Start is the rail's frequent action, visible at rest as before; More reveals. */}
                <InlineAction
                  reveal="always"
                  label={t("New work with {p0}", { p0: crew.name })}
                  tooltip={t("New work")}
                  motion="none"
                  type="button"
                  data-no-drag
                  disabled={pending}
                  onClick={() => setDialog({ kind: "start", definitionId: crew.id })}
                >
                  <Play className="icon-sm" strokeWidth={1.75} />
                </InlineAction>
                <InlineMoreAction
                  label={t("{p0} options", { p0: crew.name })}
                  tooltip={t("More actions")}
                  motion="none"
                  type="button"
                  data-no-drag
                  expanded={menu?.kind === "crew" && menu.crewId === crew.id}
                  onOpen={(anchor) => setMenu({ kind: "crew", crewId: crew.id, anchor })}
                />
              </span>
            </ActionHost>
          );
        })}
        {error ? <InlineError className="px-2">{error}</InlineError> : null}
      </div>
      {menu?.kind === "crew" && menuCrew ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("{p0} options", { p0: menuCrew.name })}
          side="right"
          align="start"
          width={248}
          items={crewItems}
          onPick={pickCrew}
          onClose={() => setMenu((current) => (current?.kind === "crew" ? null : current))}
        />
      ) : null}
      {dialog?.kind === "work" ? (
        <CrewManagementDialog
          cwd={cwd}
          state={state}
          definitionId={dialog.crewId}
          onOpen={onOpenSession}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <CrewEditDialog
          cwd={cwd}
          crewId={dialog.crewId}
          createScope={dialog.createScope}
          copyOf={dialog.copyOf}
          initialPage={dialog.initialPage}
          onStart={(definitionId) => setDialog({ kind: "start", definitionId })}
          onClose={() =>
            setDialog(
              dialog.returnToStart ? { kind: "start", definitionId: dialog.returnToStart } : null,
            )
          }
        />
      ) : null}
      {dialog?.kind === "start" ? (
        <StartCrewDialog
          cwd={cwd}
          state={state}
          definitionId={dialog.definitionId}
          onOpen={onOpenSession}
          onEdit={(crewId) => setDialog({ kind: "edit", crewId, returnToStart: crewId })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {deleting ? (
        <CrewDeleteDialog
          state={state}
          crew={deleting}
          activeWork={
            data.runs.filter((run) => run.definition.id === deleting.id && run.status === "active")
              .length
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
