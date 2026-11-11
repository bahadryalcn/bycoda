import { resolveTabGroupLogo } from "../../features/workspace/model/tabGroups";

/**
 * The logo a rail row shows. The shipped-logo detection and the mascot override are read
 * from storage, which React Compiler cannot see change, so this hook (never memoized by the
 * compiler) reads them on every render and hands back a plain string the caller can depend on.
 * `groupLogos` and `groupMascots` are not read here: they change identity when the sources
 * do, which re-renders the caller and so re-runs this lookup.
 */
export function useProjectLogoPath(
  key: string,
  groupLogos: Record<string, string>,
  _groupMascots: Record<string, string>,
): string | null {
  return resolveTabGroupLogo(key, groupLogos);
}
