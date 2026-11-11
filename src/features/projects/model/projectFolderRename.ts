import { t as moduleT, type useT } from "../../../shared/i18n";

/** Same check as `folderRenameError`, translating with the caller's bound `t` (for render paths). */
export function folderRenameErrorWith(name: string, t: ReturnType<typeof useT>): string | null {
  if (
    !name.trim() ||
    name !== name.trim() ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  ) {
    return t("Enter a valid folder name without path separators.");
  }
  return null;
}

export function folderRenameError(name: string): string | null {
  return folderRenameErrorWith(name, moduleT);
}
