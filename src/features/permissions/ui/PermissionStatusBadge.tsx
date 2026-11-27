import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Motion } from "../../../shared/ui/Motion";
import type { PermissionState } from "../../../platform/tauri/systemPermissions";
import { permissionBadge } from "../model/permissions";

/**
 * OS-driven changes fade in; keyboard refreshes stay immediate. Keying the
 * element on the state replays the shared mount motion on each new answer.
 * `restart`: switched on in the OS and applied after the app restarts.
 */
export function PermissionStatusBadge({
  state,
  animate,
  restart = false,
}: {
  state: PermissionState;
  animate: boolean;
  restart?: boolean;
}) {
  const badge = restart
    ? { label: t("Restart to apply"), tone: "warning" as const }
    : permissionBadge(state);
  return (
    <Motion
      as="span"
      key={restart ? "restart" : state}
      transition="opacity"
      duration="standard"
      easing="enter"
      enter={animate ? "rise" : undefined}
    >
      <Badge size="xs" tone={badge.tone}>
        {badge.label}
      </Badge>
    </Motion>
  );
}
