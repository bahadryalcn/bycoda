import { Badge } from "../../../shared/ui/Badge";
import { Motion } from "../../../shared/ui/Motion";
import type { PermissionState } from "../../../platform/tauri/systemPermissions";
import { permissionBadge } from "../model/permissions";

/**
 * OS-driven changes fade in; keyboard refreshes stay immediate. Keying the
 * element on the state replays the shared mount motion on each new answer.
 */
export function PermissionStatusBadge({
  state,
  animate,
}: {
  state: PermissionState;
  animate: boolean;
}) {
  const badge = permissionBadge(state);
  return (
    <Motion
      as="span"
      key={state}
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
