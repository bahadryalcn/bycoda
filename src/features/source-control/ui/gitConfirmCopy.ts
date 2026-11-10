import { t } from "../../../shared/i18n/git";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";

/** Confirmation copy for destructive Git panel actions, as [message, confirm label]. */
export function discardSelectedCopy(count: number): [string, string] {
  return [
    t(
      "Discard changes in {p0} selected files? Untracked files will be deleted. This cannot be undone.",
      { p0: count },
    ),
    t("Discard"),
  ];
}

export function discardUnstagedCopy(
  count: number,
  onlyName: string | undefined,
  untrackedOnly: boolean,
): [string, string] {
  return [
    untrackedOnly
      ? t("Delete untracked file {p0}?", { p0: onlyName })
      : count === 1 && onlyName
        ? t("Discard changes in {p0}? This cannot be undone.", { p0: onlyName })
        : t("Discard all unstaged changes in {p0} files? This cannot be undone.", { p0: count }),
    untrackedOnly ? t("Delete") : t("Discard"),
  ];
}

export function amendPushedCopy(): [string, string] {
  return [
    t(
      "Amend a commit that is already pushed? {p0} cannot push the result. You will need a force push from the terminal.",
      { p0: PRODUCT_IDENTITY.displayName },
    ),
    t("Amend"),
  ];
}
