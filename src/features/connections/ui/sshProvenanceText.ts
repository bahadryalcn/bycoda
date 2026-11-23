import { t } from "../../../shared/i18n";
import type { SshConfigurationPreview } from "../model/sshGroupDefaults";

type Provenance = SshConfigurationPreview["configuration"]["provenance"][string];

/** Where an effective SSH value comes from. A group shows its name when known, never its raw id. */
export function sshProvenanceText(source: Provenance, groupName?: string): string {
  if (source.source === "default") return t("Default");
  if (source.source === "connection") return t("Connection");
  return [t("Group"), groupName, source.revision === undefined ? "" : `r${source.revision}`]
    .filter(Boolean)
    .join(" · ");
}
