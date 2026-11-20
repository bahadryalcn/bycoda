import type { ExplorerMenuItem } from "../../files/public/ExplorerMenu";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open containing folder";

/** `t` from `useT()`, so the menu follows a language switch. */
export function fileLinkMenuItems(
  t: (message: string, values?: Record<string, unknown>) => string,
  canOpenInBycoda: boolean,
  canCopyRelativePath: boolean,
  remote = false,
): ExplorerMenuItem[] {
  return [
    {
      kind: "item",
      id: "open-bycoda",
      label: t("Open in {p0}", { p0: PRODUCT_IDENTITY.displayName }),
      disabled: !canOpenInBycoda,
    },
    {
      kind: "item",
      id: "open-default",
      label: t("Open in default app"),
      disabled: remote,
    },
    {
      kind: "item",
      id: "reveal",
      label: remote
        ? t("Open containing folder in {p0}", { p0: PRODUCT_IDENTITY.displayName })
        : t(REVEAL_LABEL),
    },
    ...(remote ? [{ kind: "item" as const, id: "reveal-local", label: t(REVEAL_LABEL) }] : []),
    { kind: "sep" },
    {
      kind: "item",
      id: "copy-path",
      label: t("Copy path"),
    },
    ...(canCopyRelativePath
      ? [
          {
            kind: "item" as const,
            id: "copy-relative-path",
            label: t("Copy relative path"),
          },
        ]
      : []),
  ];
}
