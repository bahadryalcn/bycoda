import { useEffect, useRef, useState, type MouseEvent } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { MoreHorizontal, Plus } from "../../../shared/ui/icons";
import {
  RAIL_DRAG_HANDLE,
  RAIL_SECTION_HEADER,
  SectionMenuButton,
  type RailSectionDrag,
} from "../../../app/shell/useRailSections";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import type { CrewDefinition } from "../model/crew";
import { useProjectCrews, type CrewRunView } from "../model/crewClient";
import { useCrewsOnRail } from "../model/crewAppearance";
import { CrewAvatar } from "./CrewAvatar";
import { CrewEditDialog, StartCrewDialog } from "./CrewDialogs";
import { CrewQuickMenu } from "./CrewQuickMenu";

type CrewStatus = "input" | "blocked" | "working" | "paused" | "active";

const STATUS_DOT: Record<CrewStatus, string> = {
  input: "bg-warning",
  blocked: "bg-danger",
  working: "bg-accent animate-pulse motion-reduce:animate-none",
  paused: "bg-(--ui-text-secondary)",
  active: "bg-success",
};

const STATUS_LABEL: Record<CrewStatus, string> = {
  input: "Needs decision",
  blocked: "Blocked",
  working: "Working",
  paused: "Paused",
  active: "Active",
};

function runStatus(run: CrewRunView): CrewStatus {
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
  | { kind: "edit"; crewId?: string; createScope?: "project" | "global" }
  | { kind: "start"; definitionId: string };

type Menu =
  | { kind: "crew"; crewId: string; x: number; y: number }
  | { kind: "new"; x: number; y: number };

/** The project rail's crew list: one row per crew, opened like a project. */
export function CrewRailSection({
  cwd,
  drag,
  onShownChange,
  onOpenSession,
}: {
  cwd: string;
  drag: RailSectionDrag;
  onShownChange?: (shown: boolean) => void;
  onOpenSession?: (target: BackgroundSessionTarget) => void | Promise<void>;
}) {
  useLocale();
  const state = useProjectCrews(cwd);
  const data = state.data;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingGate = useRef(false);
  const onRail = useCrewsOnRail();
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
  // The newest unfinished run is the crew's live state.
  const activeRun = (crew: CrewDefinition) => {
    const runs = data.runs.filter(
      (run) => run.definition.id === crew.id && run.status !== "finished",
    );
    return runs[runs.length - 1];
  };
  const openCoordinator = (run: CrewRunView) => {
    const sessionId = run.coordinatorSessionId;
    if (!sessionId || !onOpenSession) return;
    void act(async () =>
      onOpenSession({ cwd, machineId: data.machine.id, projectId: data.project.id, sessionId }),
    );
  };
  const openCrew = (crew: CrewDefinition) => {
    const run = activeRun(crew);
    if (run?.coordinatorSessionId && onOpenSession) openCoordinator(run);
    else setDialog({ kind: "start", definitionId: crew.id });
  };
  const menuCrew =
    menu?.kind === "crew" ? data.definitions.find((d) => d.id === menu.crewId) : undefined;
  const menuRun = menuCrew ? activeRun(menuCrew) : undefined;
  const label = t("Crews");

  return (
    <div ref={drag.setRef} className="reorder-item rail-reorder-block mb-2 shrink-0">
      <div
        {...drag.headerProps}
        tabIndex={0}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        title={t("Drag to reorder")}
        className={`${RAIL_SECTION_HEADER} ${RAIL_DRAG_HANDLE} rounded-md outline-none @max-[140px]/rail:justify-center @max-[140px]/rail:px-0`}
      >
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-content/70 @max-[140px]/rail:hidden">
          {label}
        </span>
        <Button
          iconOnly
          label={t("New crew")}
          variant="ghost"
          motion="none"
          type="button"
          data-no-drag
          aria-haspopup="menu"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ kind: "new", x: rect.left, y: rect.bottom });
          }}
          className="grid size-5 shrink-0 place-items-center"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
        </Button>
        <span className="contents @max-[140px]/rail:hidden">
          <SectionMenuButton label={label} onOpen={drag.openMenu} />
        </span>
      </div>
      <div
        role="list"
        aria-label={label}
        className={`flex-col gap-px px-2 ${drag.folded ? "hidden" : "flex"}`}
      >
        {data.definitions.length === 0 ? (
          <p className="px-2 pb-1 text-[11px] leading-tight text-(--ui-text-secondary) @max-[140px]/rail:hidden">
            {t("No crews yet")}
          </p>
        ) : null}
        {data.definitions.map((crew) => {
          const run = activeRun(crew);
          const status = run ? runStatus(run) : undefined;
          const scope = crew.projectId ? t("This project") : t("All projects on this host");
          const openMenuAt = (event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            setMenu({ kind: "crew", crewId: crew.id, x: event.clientX, y: event.clientY });
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
                selected={menu?.kind === "crew" && menu.crewId === crew.id}
                motion="none"
                type="button"
                title={[crew.name, scope, status ? t(STATUS_LABEL[status]) : ""]
                  .filter(Boolean)
                  .join("\n")}
                aria-label={[crew.name, status ? t(STATUS_LABEL[status]) : ""]
                  .filter(Boolean)
                  .join(", ")}
                disabled={pending}
                onClick={() => openCrew(crew)}
                onKeyDown={(event) => {
                  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
                    return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ kind: "crew", crewId: crew.id, x: rect.left, y: rect.bottom });
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left group-hover:pr-6 group-has-[button:focus-visible]:pr-6 @max-[140px]/rail:justify-center @max-[140px]/rail:pr-0!"
              >
                <span className="relative grid size-4 shrink-0 place-items-center">
                  <CrewAvatar crew={crew} active={status === "working"} />
                  {status ? (
                    <span
                      aria-hidden
                      className={`absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ${STATUS_DOT[status]}`}
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight @max-[140px]/rail:hidden">
                  {crew.name}
                </span>
              </Button>
              <Button
                iconOnly
                label={t("Crew options")}
                size="sm"
                variant="ghost"
                motion="none"
                type="button"
                data-no-drag
                aria-haspopup="menu"
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu({ kind: "crew", crewId: crew.id, x: rect.left, y: rect.bottom });
                }}
                className="absolute right-1 top-1/2 hidden size-6 -translate-y-1/2 place-items-center group-hover:grid group-has-[button:focus-visible]:grid @max-[140px]/rail:hidden!"
              >
                <MoreHorizontal className="size-4" strokeWidth={1.75} />
              </Button>
            </div>
          );
        })}
        {error ? (
          <p role="alert" className="px-2 text-[11px] leading-tight text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {menu && (menu.kind === "new" || menuCrew) ? (
        <CrewQuickMenu
          anchor={{ x: menu.x, y: menu.y }}
          state={state}
          crew={menuCrew}
          run={menuRun}
          onSettings={(crewId) => setDialog({ kind: "edit", crewId })}
          onStart={(crewId) => setDialog({ kind: "start", definitionId: crewId })}
          onOpenCoordinator={onOpenSession ? openCoordinator : undefined}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <CrewEditDialog
          cwd={cwd}
          crewId={dialog.crewId}
          createScope={dialog.createScope}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "start" ? (
        <StartCrewDialog
          cwd={cwd}
          state={state}
          definitionId={dialog.definitionId}
          onOpen={onOpenSession}
          onEdit={(crewId) => setDialog({ kind: "edit", crewId })}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
