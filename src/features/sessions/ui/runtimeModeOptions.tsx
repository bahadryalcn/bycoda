import type { PickerOption } from "../../../shared/ui/picker";
import { Lock, Pencil, Shield, Sparkles } from "../../../shared/ui/icons";
import {
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../model/session";

/** One glyph per access mode, shared by the composer access picker and the quick composer. */
export const RUNTIME_MODE_ICONS: Record<RuntimeMode, typeof Lock> = {
  supervised: Lock,
  "auto-accept-edits": Pencil,
  auto: Sparkles,
  "full-access": Shield,
};

/** Picker rows for the access modes. A mode the harness cannot honour shows its reason and cannot be picked. */
export function runtimeModeOptions(
  unavailable?: Partial<Record<RuntimeMode, string>>,
): PickerOption[] {
  return RUNTIME_MODES.map((mode) => {
    const ModeIcon = RUNTIME_MODE_ICONS[mode];
    const reason = unavailable?.[mode];
    return {
      value: mode,
      title: RUNTIME_MODE_LABEL[mode],
      description: RUNTIME_MODE_HINT[mode],
      icon: (
        <ModeIcon className="icon-sm" tone={mode === "full-access" ? "warning" : "secondary"} />
      ),
      disabled: reason ? true : undefined,
      disabledReason: reason,
    };
  });
}
