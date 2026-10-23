import { useEffect, useRef, useState, type MouseEvent } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import type { PopoverAnchor } from "../../../shared/ui/Popover";
import {
  Bot,
  Copy,
  Globe,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
} from "../../../shared/ui/icons";
import { RailSectionHeader, type RailSectionDrag } from "../../../app/shell/useRailSections";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import type { CrewDefinition } from "../model/crew";
import { useProjectCrews, type CrewRunView } from "../model/crewClient";
import { useCrewsOnRail } from "../model/crewAppearance";
import { activeCrewRuns, crewRunTitle } from "../model/crewRoster";
import { CrewAvatar } from "./CrewAvatar";
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

export type CrewWorkStatus = "input" | "blocked" | "working" | "paused" | "active";

const STATUS_DOT: Record<CrewWorkStatus, string> = {
  input: "bg-warning",
  blocked: "bg-danger",
  working: "bg-accent animate-pulse motion-reduce:animate-none",
  paused: "bg-(--ui-text-secondary)",
  active: "bg-success",
};

const STATUS_RANK: CrewWorkStatus[] = ["input", "blocked", "working", "paused", "active"];

export function crewWorkStatusLabel(status: CrewWorkStatus) {
  return status === "input"
    ? t("Needs decision")
    : status === "blocked"
      ? t("Blocked")
      : status === "working"
        ? t("Working")
        : status === "paused"
          ? t("Paused")
          : t("Active");
}

export function crewWorkStatus(run: CrewRunView): CrewWorkStatus {
  if (run.status === "paused") return "paused";
  if (run.messages.some((m) => !m.resolvedAt) || run.tasks.some((task) => task.status === "review"))
    return "input";
  if (run.tasks.some((task) => task.status === "blocked")) return "blocked";
  if (
    run.coordinatorStatus === "running" ||
    run.tasks.some((task) => task.status === "running" || task.status === "verifying")
  )
    return "working";
  return "active";
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
  | { kind: "delete"; crewId: string };

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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingGate = useRef(false);
  const shown = !!data && onRail;
  useEffect(() => {
    onShownChange?.(shown);
    return () => onShownChange?.(false);
  }, [shown, onShownChange]);
  if (!data || !onRail) return null;

  const act = async (operation: () => Promise<unknown>) => {
    if (pendingGate.current) return;
    pendingGate.current = true;
    setPending(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingGate.current = false;
      setPending(false);
    }
  };
  const openCoordinator = (run: CrewRunView) => {
    const sessionId = run.coordinatorSessionId;
    if (!sessionId || !onOpenSession) return;
    void act(async () =>
      onOpenSession({
        cwd,
        machineId: data.machine.id,
        projectId: data.project.id,
        sessionId,
      }),
    );
  };
  // One ongoing work opens directly; several ask which one; none starts new work.
  const openCrew = (crew: CrewDefinition, anchor: PopoverAnchor) => {
    const runs = activeCrewRuns(data.runs, crew.id);
    if (runs.length === 1 && runs[0].coordinatorSessionId && onOpenSession)
      openCoordinator(runs[0]);
    else if (runs.length > 1) setMenu({ kind: "work", crewId: crew.id, anchor });
    else setDialog({ kind: "start", definitionId: crew.id });
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
        ...(menuRuns.length > 1
          ? [
              {
                kind: "item" as const,
                id: "work",
                label: t("Ongoing work ({p0})", { p0: menuRuns.length }),
                icon: <Bot className="icon-sm" />,
              },
            ]
          : []),
        {
          kind: "item",
          id: "start",
          label: t("Start work"),
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
        ...(single
          ? [
              { kind: "sep" as const },
              {
                kind: "item" as const,
                id: "pause",
                label: single.status === "paused" ? t("Resume work") : t("Pause new assignments"),
                description: crewRunTitle(single),
                icon:
                  single.status === "paused" ? (
                    <Play className="icon-sm" />
                  ) : (
                    <Pause className="icon-sm" />
                  ),
              },
              {
                kind: "item" as const,
                id: "stop",
                label: t("Stop work"),
                danger: true,
                description: t("Cancels running assignments"),
                icon: <Square className="icon-sm" />,
              },
            ]
          : []),
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
    else if (id === "work" && menu) setMenu({ ...menu, kind: "work" });
    else if (id === "start") setDialog({ kind: "start", definitionId: crewId });
    else if (id === "edit") setDialog({ kind: "edit", crewId });
    else if (id === "members") setDialog({ kind: "edit", crewId, initialPage: "add" });
    else if (id === "duplicate")
      setDialog({
        kind: "edit",
        copyOf: { crewId, scope: menuCrew.projectId ? "project" : "global" },
      });
    else if (id === "scope") setDialog({ kind: "edit", copyOf: { crewId, scope } });
    else if (id === "pause" && single)
      void act(() =>
        state.call(single.status === "paused" ? "crews.resume" : "crews.pause", {
          runId: single.id,
        }),
      );
    else if (id === "stop" && single)
      void act(() => state.call("crews.stop", { runId: single.id }));
    else if (id === "delete") setDialog({ kind: "delete", crewId });
  };
  const label = t("Crews");
  const deleting =
    dialog?.kind === "delete" ? data.definitions.find((d) => d.id === dialog.crewId) : undefined;

  return (
    <div ref={drag.setRef} className="reorder-item rail-reorder-block mb-2 shrink-0">
      <RailSectionHeader
        label={label}
        drag={drag}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        actions={
          <Button
            iconOnly
            label={t("New crew")}
            variant="ghost"
            motion="none"
            type="button"
            data-no-drag
            aria-haspopup="dialog"
            onClick={() => setDialog({ kind: "edit", createScope: "project" })}
            className="grid icon-lg shrink-0 place-items-center"
          >
            <Plus className="icon-sm" strokeWidth={1.75} />
          </Button>
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
          const status = runs
            .map(crewWorkStatus)
            .sort((a, b) => STATUS_RANK.indexOf(a) - STATUS_RANK.indexOf(b))[0];
          const scope = crew.projectId ? t("This project") : t("All projects on this host");
          const statusText = status
            ? runs.length > 1
              ? `${crewWorkStatusLabel(status)} · ${t("{p0} ongoing", { p0: runs.length })}`
              : crewWorkStatusLabel(status)
            : "";
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
            <div
              key={crew.id}
              role="listitem"
              className="group relative flex h-8 items-stretch"
              onContextMenu={openMenuAt}
            >
              <Button
                variant="item"
                selected={menu?.crewId === crew.id}
                motion="none"
                type="button"
                title={[crew.name, scope, statusText].filter(Boolean).join("\n")}
                aria-label={[crew.name, statusText].filter(Boolean).join(", ")}
                disabled={pending}
                onClick={(event) => openCrew(crew, event.currentTarget)}
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
                <span className="relative grid icon-md shrink-0 place-items-center">
                  <CrewAvatar crew={crew} active={status === "working"} />
                  {status ? (
                    <span
                      aria-hidden
                      className={`absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ${STATUS_DOT[status]}`}
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-ui-body font-medium @max-[140px]/rail:hidden">
                  {crew.name}
                </span>
                {status === "input" || status === "blocked" || status === "paused" ? (
                  <Badge
                    tone={
                      status === "input" ? "warning" : status === "blocked" ? "danger" : "neutral"
                    }
                    className="shrink-0 group-hover:hidden group-has-[button:focus-visible]:hidden pointer-coarse:hidden @max-[140px]/rail:hidden"
                  >
                    {crewWorkStatusLabel(status)}
                  </Badge>
                ) : null}
              </Button>
              <span className="hidden shrink-0 items-center gap-px group-hover:flex group-has-[button:focus-visible]:flex pointer-coarse:flex @max-[140px]/rail:hidden!">
                <Button
                  iconOnly
                  label={t("Start work with {p0}", { p0: crew.name })}
                  tooltip={t("Start work")}
                  size="sm"
                  variant="ghost"
                  motion="none"
                  type="button"
                  data-no-drag
                  disabled={pending}
                  onClick={(event) => {
                    event.stopPropagation();
                    setDialog({ kind: "start", definitionId: crew.id });
                  }}
                  className="grid size-6 place-items-center"
                >
                  <Play className="icon-sm" strokeWidth={1.75} />
                </Button>
                <Button
                  iconOnly
                  label={t("{p0} options", { p0: crew.name })}
                  tooltip={t("More actions")}
                  size="sm"
                  variant="ghost"
                  motion="none"
                  type="button"
                  data-no-drag
                  aria-haspopup="menu"
                  aria-expanded={menu?.kind === "crew" && menu.crewId === crew.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenu({
                      kind: "crew",
                      crewId: crew.id,
                      anchor: event.currentTarget,
                    });
                  }}
                  className="grid size-6 place-items-center"
                >
                  <MoreHorizontal className="icon-md" strokeWidth={1.75} />
                </Button>
              </span>
            </div>
          );
        })}
        {error ? (
          <p role="alert" className="px-2 text-ui-micro leading-tight text-danger">
            {error}
          </p>
        ) : null}
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
      {menu?.kind === "work" && menuCrew ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("Ongoing work")}
          side="right"
          align="start"
          width={260}
          items={menuRuns.map((run) => ({
            kind: "item" as const,
            id: run.id,
            label: crewRunTitle(run),
            description: crewWorkStatusLabel(crewWorkStatus(run)),
            disabled: !run.coordinatorSessionId || !onOpenSession,
          }))}
          onPick={(id) => {
            const run = menuRuns.find((item) => item.id === id);
            if (run) openCoordinator(run);
          }}
          onClose={() => setMenu((current) => (current?.kind === "work" ? null : current))}
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
