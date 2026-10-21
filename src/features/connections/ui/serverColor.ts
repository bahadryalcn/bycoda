import { TAB_GROUP_COLORS } from "../../workspace/model/tabGroups";
import type { ServerRecord } from "../model/serverInventory";

/**
 * Resolves the accent a server shows. A custom color wins; otherwise a palette index above 0
 * selects a swatch. 0 or absent means no color, the same rule as project groups.
 */
export function serverAccentColor(server: Pick<ServerRecord, "metadata">): string | undefined {
  const { colorIndex, customColor } = server.metadata;
  if (customColor) return customColor;
  if (colorIndex != null && colorIndex > 0 && colorIndex < TAB_GROUP_COLORS.length) {
    return TAB_GROUP_COLORS[colorIndex];
  }
  return undefined;
}

export function serverHasColor(server: Pick<ServerRecord, "metadata">): boolean {
  return serverAccentColor(server) !== undefined;
}
