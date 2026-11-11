import { Search } from "../../shared/ui/icons";
import { useT } from "../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { RailSearch } from "./RailAction";

/**
 * The project rail's identity row: the bycoda mark with its outlined wordmark, plus the global
 * Search. Below 140px the wordmark drops and only the mark stays (see bycoda.css);
 * `title` sits in the window title row, `column` at the top of the rail column. On
 * Windows the column copy only appears where the title row runs out of room (see bycoda.css).
 */
export function RailBrand({
  placement,
  narrowOnly = false,
  showSearch,
  searchActive,
  onSearch,
}: {
  placement: "title" | "column";
  /** Column copy that only shows what the title row hides at narrow widths. */
  narrowOnly?: boolean;
  showSearch: boolean;
  searchActive: boolean;
  onSearch?: () => void;
}) {
  const t = useT();
  return (
    <div
      data-rail-brand={placement}
      className={`bycoda-rail-brand bycoda-rail-brand--${placement} ${narrowOnly ? "bycoda-rail-brand--narrow-only" : ""}`}
    >
      <span className="bycoda-rail-lockup">
        <img
          className="bycoda-rail-mark"
          src={PRODUCT_IDENTITY.smallLogoSrc}
          alt={PRODUCT_IDENTITY.displayName}
          draggable={false}
        />
        <img
          className="bycoda-brand-lettering bycoda-rail-wordmark"
          src={PRODUCT_IDENTITY.wordmarkSrc}
          alt=""
          draggable={false}
        />
      </span>
      {showSearch ? (
        <div className="bycoda-rail-search-slot min-w-0 flex-1">
          <RailSearch
            label={t("Search")}
            icon={Search}
            onClick={onSearch}
            active={searchActive}
            command="App: Search"
          />
        </div>
      ) : null}
    </div>
  );
}

/** The product mark alone at the start of the collapsed rail; not a control. */
export function CompactRailLogo() {
  return (
    <span data-compact-rail-logo className="bycoda-rail-lockup shrink-0 select-none">
      <img
        className="bycoda-rail-mark"
        src={PRODUCT_IDENTITY.smallLogoSrc}
        alt={PRODUCT_IDENTITY.displayName}
        draggable={false}
      />
    </span>
  );
}
