import { useResolvedTabGroupLogo } from "../../features/workspace/model/tabGroups";

/**
 * The logo a rail row shows: the chosen logo, else the one the project ships unless a
 * mascot was picked. Re-renders the caller when the detection finishes or a mascot changes.
 * `_groupMascots` is accepted for existing callers; the hook subscribes to mascots itself.
 */
export function useProjectLogoPath(
  key: string,
  groupLogos: Record<string, string>,
  _groupMascots: Record<string, string>,
): string | null {
  return useResolvedTabGroupLogo(key, groupLogos);
}
