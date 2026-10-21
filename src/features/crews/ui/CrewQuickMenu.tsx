import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { ColorSwatchRow } from "../../../shared/ui/ColorPickerPopover";
import { MenuRow } from "../../../shared/ui/MenuRow";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { TextField } from "../../../shared/ui/TextField";
import { Pause, Play, Settings, Square, Bot } from "../../../shared/ui/icons";
import { TAB_GROUP_COLORS } from "../../workspace/model/tabGroups";
import { ProjectIconPicker } from "../../projects/ui/ProjectIconPicker";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { projectMascot } from "../../projects/model/projectMascots";
import type { CrewDefinition } from "../model/crew";
import type { CrewRunView, useProjectCrews } from "../model/crewClient";
import {
  crewColor,
  saveCrewAppearance,
  useCrewAppearances,
  type CrewAppearance,
} from "../model/crewAppearance";
import { blankCrew } from "./CrewEditor";
import { CrewDeleteButton } from "./CrewDeleteButton";

const QUICK_ICONS = [
  "weave",
  "bridge",
  "terminal",
  "api",
  "shield",
  "lab",
  "launch",
  "tools",
  "chart",
  "docs",
] as const;

const WIDTH = 288;

/**
 * The rail's crew popover: name, icon and color up front, the rest one row away.
 * Without a crew it creates one, so nothing is saved until Create is pressed.
 */
export function CrewQuickMenu({
  anchor,
  state,
  crew,
  run,
  onSettings,
  onStart,
  onOpenCoordinator,
  onClose,
}: {
  anchor: PopoverAnchor;
  state: ReturnType<typeof useProjectCrews>;
  crew?: CrewDefinition;
  run?: CrewRunView;
  onSettings: (crewId: string) => void;
  onStart: (crewId: string) => void;
  onOpenCoordinator?: (run: CrewRunView) => void;
  onClose: () => void;
}) {
  useLocale();
  const saved = useCrewAppearances();
  const [id] = useState(() => crew?.id ?? crypto.randomUUID());
  const [name, setName] = useState(crew?.name ?? t("New crew"));
  // A new crew's look stays local until it exists; an existing one updates live.
  const [draftLook, setDraftLook] = useState<CrewAppearance>({});
  const look = crew ? (saved[id] ?? {}) : draftLook;
  const setLook = (patch: CrewAppearance) =>
    crew ? saveCrewAppearance(id, patch) : setDraftLook((current) => ({ ...current, ...patch }));
  const [scope, setScope] = useState<"project" | "global">("project");
  const [moreIcons, setMoreIcons] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const gate = useRef(false);
  const act = async (operation: () => Promise<unknown>, close = false) => {
    if (gate.current) return;
    gate.current = true;
    setPending(true);
    setError("");
    try {
      await operation();
      if (close) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      gate.current = false;
      setPending(false);
    }
  };
  // Closes once the name is saved, and stays open to show a failed save.
  const rename = (close = false) => {
    const next = name.trim();
    if (!crew || !next || next === crew.name) {
      if (close) onClose();
      return;
    }
    void act(
      () =>
        state.call("crews.save", {
          definition: { ...crew, name: next },
          expectedUpdatedAt: crew.updatedAt,
        }),
      close,
    );
  };
  const create = () => {
    const data = state.data;
    if (!data || !name.trim()) return;
    void act(async () => {
      const definition = { ...blankCrew(data, scope), id, name: name.trim() };
      await state.call("crews.save", { definition });
      saveCrewAppearance(id, draftLook);
    }, true);
  };
  const pick = (action: () => void) => () => {
    onClose();
    action();
  };
  const color = crewColor(look);
  return (
    <Popover
      anchor={anchor}
      side="right"
      align="start"
      width={WIDTH}
      constrainHeight
      onDismiss={() => (crew ? rename(true) : onClose())}
      role="dialog"
      aria-label={crew ? t("Crew options") : t("New crew")}
      className="bycoda-arc flex flex-col gap-2 overflow-y-auto overscroll-contain p-2"
    >
      <TextField
        hideLabel
        label={t("Crew name")}
        value={name}
        autoFocus
        disabled={pending}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (crew) rename();
          else create();
        }}
      />
      <div role="group" aria-label={t("Crew icon")} className="flex flex-wrap gap-0.5">
        {QUICK_ICONS.map((icon) => (
          <Button
            key={icon}
            variant="item"
            motion="none"
            iconOnly
            label={projectMascot(id, icon).label}
            aria-pressed={look.icon === icon}
            selected={look.icon === icon}
            onClick={() => setLook({ icon })}
            className="grid size-7 place-items-center"
          >
            <ProjectMascot project={id} name={icon} color={color} className="size-4" />
          </Button>
        ))}
        <Button
          variant="ghost"
          motion="none"
          aria-expanded={moreIcons}
          onClick={() => setMoreIcons((open) => !open)}
          className="h-7"
        >
          {t("More")}
        </Button>
      </div>
      {moreIcons ? (
        <ProjectIconPicker
          project={id}
          name={look.icon ?? null}
          color={color}
          onPick={(icon) => setLook({ icon: icon ?? undefined })}
        />
      ) : null}
      <ColorSwatchRow
        colors={TAB_GROUP_COLORS}
        colorIndex={look.color ?? 0}
        customColor={null}
        customPickerOpen={false}
        onPickIndex={(index) => setLook({ color: index || undefined })}
      />
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      {crew ? (
        <>
          <div role="separator" className="h-px bg-(--ui-tone-neutral-border)" />
          <div role="menu" aria-label={t("Crew actions")} className="flex flex-col">
            {run?.coordinatorSessionId && onOpenCoordinator ? (
              <MenuRow role="menuitem" onClick={pick(() => onOpenCoordinator(run))}>
                <Bot className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t("Open coordinator")}</span>
              </MenuRow>
            ) : null}
            <MenuRow role="menuitem" onClick={pick(() => onStart(crew.id))}>
              <Play className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t("Start crew")}</span>
            </MenuRow>
            <MenuRow role="menuitem" onClick={pick(() => onSettings(crew.id))}>
              <Settings className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t("Crew settings")}</span>
            </MenuRow>
            {run ? (
              <>
                <MenuRow
                  role="menuitem"
                  disabled={pending}
                  onClick={() =>
                    void act(
                      () =>
                        state.call(run.status === "paused" ? "crews.resume" : "crews.pause", {
                          runId: run.id,
                        }),
                      true,
                    )
                  }
                >
                  {run.status === "paused" ? (
                    <Play className="size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <Pause className="size-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {t(run.status === "paused" ? "Resume crew" : "Pause new crew work")}
                  </span>
                </MenuRow>
                <MenuRow
                  role="menuitem"
                  disabled={pending}
                  onClick={() => void act(() => state.call("crews.stop", { runId: run.id }), true)}
                >
                  <Square className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t("Stop crew work")}</span>
                </MenuRow>
              </>
            ) : null}
          </div>
          <CrewDeleteButton state={state} crew={crew} onDeleted={onClose} />
        </>
      ) : (
        <>
          <SegmentedControl
            label={t("Available in")}
            value={scope}
            options={[
              { value: "project", label: t("This project") },
              { value: "global", label: t("All projects") },
            ]}
            onValueChange={(value) => setScope(value === "global" ? "global" : "project")}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={pending || !name.trim() || !state.data}
              loading={pending}
              onClick={create}
            >
              {t("Create crew")}
            </Button>
          </div>
        </>
      )}
    </Popover>
  );
}
