import type { t as Translate } from "../../../shared/i18n";
import type { PickerOption } from "../../../shared/ui/picker";
import { Lock, Pencil, Shield, Sparkles } from "../../../shared/ui/icons";
import { runtimeModeCopy } from "./runtimeModeCopy";
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

/**
 * Picker rows for the access modes. A mode the harness cannot honour shows its reason and cannot be picked.
 * Pass the UI translator `t` for localized titles and descriptions; without it the rows are English.
 */
export function runtimeModeOptions(
  unavailable?: Partial<Record<RuntimeMode, string>>,
  t?: typeof Translate,
): PickerOption[] {
  return RUNTIME_MODES.map((mode) => {
    const ModeIcon = RUNTIME_MODE_ICONS[mode];
    const reason = unavailable?.[mode];
    const copy = t
      ? runtimeModeCopy(t, mode)
      : { label: RUNTIME_MODE_LABEL[mode], hint: RUNTIME_MODE_HINT[mode] };
    return {
      value: mode,
      title: copy.label,
      description: copy.hint,
      icon: (
        <ModeIcon className="icon-sm" tone={mode === "full-access" ? "warning" : "secondary"} />
      ),
      disabled: reason ? true : undefined,
      disabledReason: reason,
    };
  });
}
