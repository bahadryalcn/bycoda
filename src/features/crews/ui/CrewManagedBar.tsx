import { t } from "../../../shared/i18n";
import { Surface } from "../../../shared/ui/Surface";
import { Button } from "../../../shared/ui/Button";
import type { CrewManagedSession } from "../model/crewManagedSessions";
import { openCrewsPageAt } from "../model/crewsPage";
import { roleLabel } from "./CrewMemberForm";
import { CrewRoleIcon } from "./CrewRoleIcon";

/** Where Crews shows this session's run: its Work tab, on that run. */
export function openCrewManagedSessionInCrews(managed: CrewManagedSession) {
  openCrewsPageAt({ tab: "work", definitionId: managed.definitionId, runId: managed.runId });
}

/**
 * Replaces the composer of a conversation a crew runs: it can be read here but stopped, written
 * to and removed only from Crews. No input, send, stop or model controls.
 */
export function CrewManagedBar({
  managed,
  className,
}: {
  managed: CrewManagedSession;
  className?: string;
}) {
  const role = managed.memberName
    ? `${managed.memberName} · ${roleLabel(managed.role)}`
    : roleLabel(managed.role);
  return (
    <Surface
      data-crew-managed-bar=""
      variant="card"
      padding="none"
      className={`flex min-w-0 items-center gap-2 px-3 py-2 ${className ?? ""}`}
    >
      <CrewRoleIcon role={managed.role} className="icon-sm shrink-0 text-(--ui-text-secondary)" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui-secondary font-medium">{managed.crewName}</span>
        <span className="truncate text-ui-caption text-(--ui-text-secondary)">
          {role} · {t("Managed from Crews")}
        </span>
      </span>
      <Button
        variant="primary"
        size="sm"
        className="shrink-0"
        onClick={() => openCrewManagedSessionInCrews(managed)}
      >
        {t("Open in Crews")}
      </Button>
    </Surface>
  );
}
