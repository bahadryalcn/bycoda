import { useT } from "../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { BrandMark } from "../../shared/ui/BrandMark";
import { Button } from "../../shared/ui/Button";
import { Text } from "../../shared/ui/Text";
import { Search } from "../../shared/ui/icons";
import { IS_MAC } from "../../platform/tauri/platform";
import { useKeybindingShortcut } from "../../features/settings/model/useKeybindingShortcut";
import { toggleAppMenuAt } from "./MenuBar";

/**
 * The bycoda mark in the window title bar, with its wordmark while the project rail is
 * expanded. Where the window has no native menu bar (Windows, Linux) the lockup is the button
 * that opens the application menus; on macOS it is identity only.
 */
export function TitleBarBrand({ wordmark }: { wordmark: boolean }) {
  const t = useT();
  const lockup = (
    <span className="bycoda-title-lockup">
      <BrandMark
        variant="smallMark"
        className="bycoda-title-mark"
        alt={IS_MAC ? PRODUCT_IDENTITY.displayName : ""}
        draggable={false}
      />
      {wordmark ? (
        <BrandMark
          variant="wordmark"
          className="bycoda-brand-lettering bycoda-title-wordmark"
          draggable={false}
        />
      ) : null}
    </span>
  );
  if (IS_MAC) {
    return (
      <span data-title-brand className="flex shrink-0 select-none items-center px-1">
        {lockup}
      </span>
    );
  }
  return (
    <Button
      data-title-brand
      data-app-menu-entry
      tooltip={t("Application menu")}
      aria-label={t("Application menu")}
      shortcut="Alt"
      variant="ghost"
      motion="none"
      type="button"
      aria-haspopup="menu"
      data-tauri-drag-region="false"
      onClick={(event) => toggleAppMenuAt(event.currentTarget)}
      className="shrink-0"
    >
      {lockup}
    </Button>
  );
}

/**
 * The global Search in the window title bar. A full field while the bar has room; the label
 * and shortcut drop below the title bar's narrow width (see bycoda.css) and the icon stays.
 */
export function TitleBarSearch({ active, onClick }: { active: boolean; onClick: () => void }) {
  const t = useT();
  const shortcut = useKeybindingShortcut("App: Search");
  return (
    <Button
      data-title-search
      tooltip={t("Search")}
      tooltipWhen="overflow"
      aria-label={t("Search")}
      shortcut={shortcut}
      selected={active}
      variant="secondary"
      motion="none"
      type="button"
      data-tauri-drag-region="false"
      onClick={onClick}
      className="bycoda-title-search flex shrink-0 items-center gap-2"
    >
      <Search className="icon-sm shrink-0" tone="secondary" strokeWidth={1.75} />
      <Text
        data-title-search-label
        size="caption"
        tone="secondary"
        weight="medium"
        leading="tight"
        truncate
        className="min-w-0 flex-1 text-start"
      >
        {t("Search")}
      </Text>
      {shortcut ? (
        <Text
          data-title-search-shortcut
          data-tooltip-shortcut=""
          aria-hidden
          size="caption"
          tone="secondary"
          className="shrink-0"
        >
          {shortcut}
        </Text>
      ) : null}
    </Button>
  );
}
