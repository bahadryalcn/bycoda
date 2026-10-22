import { t } from "../../../shared/i18n";

export function folderRenameError(name: string): string | null {
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
