import { useLocale } from "../../../shared/i18n";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import type { CrewPolicy } from "../model/crew";

/**
 * The access mode every member runs with, as one chip beside the crew name. Hosts without
 * `crews.access.v1` run supervised and show nothing. The two grants that govern how members ask
 * for more live under the editor's More options.
 */
export function CrewAccessRow({
  policy,
  accessSupported,
  onChange,
}: {
  policy: CrewPolicy;
  accessSupported: boolean;
  onChange: (patch: Partial<CrewPolicy>) => void;
}) {
  useLocale();
  if (!accessSupported) return null;
  return (
    <AccessPicker
      value={policy.runtimeMode ?? "supervised"}
      onChange={(runtimeMode) => onChange({ runtimeMode })}
    />
  );
}
