import { modelDisplayName } from "./modelDisplayName";
import { CROSS_ADVISOR_KEY, decodeAdvisor } from "../../../shared/model/host-contracts/delegation";

// Kept apart from claudeAdvisor: the display-name lookup reaches the desktop model catalog, which mobile cannot load.
const FAMILIES = new Set(["haiku", "sonnet", "opus", "fable"]);

/**
 * The advisor model a conversation's built-in advisor runs, for its transcript row: the
 * Claude advisor selection, else a legacy family alias. Undefined when none or off.
 */
export function advisorModelName(settings: Record<string, string> | undefined): string | undefined {
  const selected = decodeAdvisor(settings?.[CROSS_ADVISOR_KEY]);
  if (selected?.harness === "claude") return modelDisplayName(selected.model, "claude");
  const legacy = settings?.advisor;
  if (!legacy || legacy === "default" || legacy === "off") return undefined;
  return FAMILIES.has(legacy)
    ? legacy[0]!.toUpperCase() + legacy.slice(1)
    : modelDisplayName(legacy, "claude");
}
