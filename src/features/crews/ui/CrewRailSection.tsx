import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { ActionHost, InlineAction, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { DetailedInlineError } from "../../../shared/ui/ErrorDetails";
import type { PopoverAnchor } from "../../../shared/ui/Popover";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { Play, Plus } from "../../../shared/ui/icons";
import {
  RAIL_SECTION_BLOCK,
  RailSectionHeader,
  type RailSectionDrag,
} from "../../../app/shell/useRailSections";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import type { CrewDefinition } from "../model/crew";
import { useProjectCrews, type CrewRunView } from "../model/crewClient";
import { useCrewsOnRail } from "../model/crewAppearance";
import { activeCrewRuns } from "../model/crewRoster";
import { activeMemberIds } from "../model/crewTableLayout";
import { CrewAvatar } from "./CrewAvatar";
import { CrewFaces } from "./CrewFaces";
import { CrewRailActive } from "./CrewRailActive";
import { openCrewsPageAt } from "../model/crewsPage";
import { CrewDialogHost } from "./CrewDialogHost";
import { crewMenuDialog, crewMenuItems, type CrewDialog } from "./crewMenuItems";
import { CREW_ATTENTION_TONE, CREW_EXECUTION_TONE, crewSignal } from "../model/crewSignal";
import { crewAttentionLabel, crewWorkStatusLabel } from "../model/crewPresentation";
export { crewWorkStatus, crewWorkStatusLabel } from "../model/crewPresentation";

const RAIL_FACE_SIZE = 20;

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
  const [dialog, setDialog] = useState<CrewDialog | null>(null);
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
  const crewItems = menuCrew
    ? crewMenuItems(menuCrew, {
        single,
        canOpenCoordinator: !!onOpenSession,
        deleteSupported: data.deleteSupported,
      })
    : [];
  const pickCrew = (id: string) => {
    if (!menuCrew) return;
    if (id === "open" && single) openCoordinator(single);
    else if (id === "work") openCrewsPageAt({ tab: "work", definitionId: menuCrew.id });
    else {
      const next = crewMenuDialog(id, menuCrew);
      if (next) setDialog(next);
    }
  };
  const label = t("Crews");

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
        onLabelClick={() => openCrewsPageAt({})}
        labelClickLabel={t("Open Crews")}
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
      {drag.folded || collapsed ? null : (
        <CrewRailActive
          project={{ machineId: data.machine.id, projectId: data.project.id, cwd }}
          onOpenSession={onOpenSession}
          onError={setError}
        />
      )}
      <div
        role="list"
        aria-label={label}
        hidden={drag.folded || collapsed}
        className={`flex-col gap-0 px-2 ${drag.folded || collapsed ? "hidden" : "flex"}`}
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
          const { attention, execution } = crewSignal(runs);
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
                <span className="relative flex shrink-0 items-center">
                  <span className="@max-[140px]/rail:hidden">
                    <CrewFaces
                      members={crew.agents}
                      size={RAIL_FACE_SIZE}
                      reserve
                      label={crew.name}
                      activeIds={working ? activeMemberIds(runs, crew.agents) : undefined}
                    />
                  </span>
                  <span className="hidden icon-sm place-items-center @max-[140px]/rail:grid">
                    <CrewAvatar crew={crew} active={working} />
                  </span>
                  {attention || (execution && !working) ? (
                    <StatusDot
                      label={statusText}
                      className="absolute -right-0.5 -bottom-0.5"
                      tone={
                        attention
                          ? CREW_ATTENTION_TONE[attention]
                          : CREW_EXECUTION_TONE[execution as keyof typeof CREW_EXECUTION_TONE]
                      }
                    />
                  ) : null}
                </span>
                <Text
                  size="secondary"
                  tone="inherit"
                  weight="medium"
                  truncate
                  className="min-w-0 flex-1 @max-[140px]/rail:hidden"
                >
                  {crew.name}
                </Text>
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
              <span className="flex shrink-0 items-center gap-0 @max-[140px]/rail:hidden!">
                {/* Start is the rail's frequent action, visible at rest as before; More reveals. */}
                <InlineMoreAction
                  label={t("{p0} options", { p0: crew.name })}
                  tooltip={t("More actions")}
                  motion="none"
                  type="button"
                  data-no-drag
                  expanded={menu?.kind === "crew" && menu.crewId === crew.id}
                  onOpen={(anchor) => setMenu({ kind: "crew", crewId: crew.id, anchor })}
                />
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
              </span>
            </ActionHost>
          );
        })}
        {error ? <DetailedInlineError className="px-2" error={error} /> : null}
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
      <CrewDialogHost
        cwd={cwd}
        state={state}
        dialog={dialog}
        setDialog={setDialog}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}
