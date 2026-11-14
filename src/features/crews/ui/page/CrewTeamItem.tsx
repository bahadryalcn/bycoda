import { Text } from "../../../../shared/ui/Text";
import { useMemo, useRef, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { MoreHorizontal, Play } from "../../../../shared/ui/icons";
import { Surface } from "../../../../shared/ui/Surface";
import { WorkingIndicator } from "../../../../shared/ui/WorkingIndicator";
import type { CrewDefinition } from "../../model/crew";
import type { CrewRunView } from "../../model/crewClient";
import { crewAttentionLabel, crewWorkStatusLabel } from "../../model/crewPresentation";
import { CREW_ATTENTION_TONE, crewSignal } from "../../model/crewSignal";
import { activeMemberIds, crewTableState } from "../../model/crewTableLayout";
import { CrewFaces } from "../CrewFaces";
import { CrewTablePortrait } from "../CrewTablePortrait";
import { crewMenuItems } from "../crewMenuItems";

const LIST_FACE_SIZE = 28;

/** One crew as a card or a list row: identity, size, ongoing work and its direct actions. */
export function CrewTeamItem({
  crew,
  runs,
  layout,
  deleteSupported,
  canOpenCoordinator,
  onStart,
  onEdit,
  onPick,
}: {
  crew: CrewDefinition;
  /** The crew's ongoing work. */
  runs: readonly CrewRunView[];
  layout: "cards" | "list";
  deleteSupported?: boolean;
  canOpenCoordinator: boolean;
  onStart: () => void;
  onEdit: () => void;
  /** A "…" menu pick, with the crew's single ongoing run for the coordinator item. */
  onPick: (id: string, single?: CrewRunView) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { attention, execution } = crewSignal(runs);
  const single = runs.length === 1 ? runs[0] : undefined;
  const activeIds = useMemo(() => activeMemberIds(runs, crew.agents), [runs, crew.agents]);
  const tableState = crewTableState(attention, execution);
  const stateLabel = attention
    ? crewAttentionLabel(attention)
    : execution === "working"
      ? crewWorkStatusLabel("working")
      : undefined;
  const scope = crew.projectId ? t("This project") : t("All projects on this host");
  const work = runs.length
    ? [
        execution ? crewWorkStatusLabel(execution) : "",
        runs.length > 1 ? t("{p0} ongoing", { p0: runs.length }) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : t("No ongoing work");
  return (
    <Surface
      as="li"
      variant="canvas"
      className={
        layout === "list"
          ? "flex min-w-0 flex-wrap items-center gap-3"
          : "flex min-w-0 flex-col gap-3"
      }
    >
      {layout === "cards" ? (
        <CrewTablePortrait
          name={crew.name}
          members={crew.agents}
          state={tableState}
          stateLabel={stateLabel}
          activeIds={activeIds}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {layout === "list" ? (
          <CrewFaces
            members={crew.agents}
            size={LIST_FACE_SIZE}
            label={crew.name}
            activeIds={activeIds}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <Text as="p" size="body" tone="primary" weight="medium" truncate>
            {crew.name}
          </Text>
          {/* Scope and size are data, not help text: they stay visible. */}
          <Text as="p" tone="muted" truncate>
            {[scope, t("{p0} members", { p0: crew.agents.length })].join(" · ")}
          </Text>
          <Text as="p" tone="muted" className="mt-0.5 flex items-center gap-1.5">
            {execution === "working" ? <WorkingIndicator size="xs" /> : null}
            {attention ? (
              <Badge size="xs" tone={CREW_ATTENTION_TONE[attention]}>
                {crewAttentionLabel(attention)}
              </Badge>
            ) : null}
            <Text size="inherit" tone="inherit" truncate>
              {work}
            </Text>
          </Text>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="secondary" startIcon={<Play className="icon-sm" />} onClick={onStart}>
          {t("New work")}
        </Button>
        <Button variant="ghost" aria-label={t("Edit {p0}", { p0: crew.name })} onClick={onEdit}>
          {t("Edit")}
        </Button>
        <Button
          ref={trigger}
          variant="ghost"
          iconOnly
          label={t("{p0} options", { p0: crew.name })}
          tooltip={t("More actions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <MoreHorizontal className="icon-sm" />
        </Button>
      </div>
      {menuOpen ? (
        <DropdownMenu
          anchor={trigger}
          label={t("{p0} options", { p0: crew.name })}
          width={248}
          items={crewMenuItems(crew, { single, canOpenCoordinator, deleteSupported })}
          onPick={(id) => onPick(id, single)}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </Surface>
  );
}
