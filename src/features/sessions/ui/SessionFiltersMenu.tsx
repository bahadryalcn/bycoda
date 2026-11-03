import { Button } from "../../../shared/ui/Button";
import { t, useLocale, useT } from "../../../shared/i18n";
import { Divider } from "../../../shared/ui/Divider";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Check } from "../../../shared/ui/icons";
import { type ReactNode } from "react";
import { Popover } from "../../../shared/ui/Popover";
import {
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  hasActiveSessionFilters,
  type SessionSidebarFilters,
  type SessionTimeFilter,
} from "../model/sessionFilters";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { useAssistantIdentity } from "../../assistant/model/assistantClient";
import {
  type SessionListDensity,
  updateSessionListDisplay,
  useSessionListDisplay,
} from "../model/sessionListDisplay";

const MENU_WIDTH = 228;

type Props = {
  x: number;
  y: number;
  harnesses: HarnessId[];
  filters: SessionSidebarFilters;
  onChange: (filters: SessionSidebarFilters) => void;
  onClose: () => void;
  local?: boolean;
};

const DENSITY_OPTIONS: { id: SessionListDensity; label: string }[] = [
  {
    id: "compact",
    get label() {
      return t("Compact");
    },
  },
  {
    id: "standard",
    get label() {
      return t("Standard");
    },
  },
  {
    id: "detailed",
    get label() {
      return t("Detailed");
    },
  },
];

const TIME_OPTIONS: { id: SessionTimeFilter; label: string }[] = [
  {
    id: "all",
    get label() {
      return t("All time");
    },
  },
  {
    id: "today",
    get label() {
      return t("Today");
    },
  },
  {
    id: "7d",
    get label() {
      return t("Last 7 days");
    },
  },
  {
    id: "30d",
    get label() {
      return t("Last 30 days");
    },
  },
];

export function SessionFiltersMenu({
  x,
  y,
  harnesses,
  filters,
  onChange,
  onClose,
  local = true,
}: Props) {
  const t = useT();
  const hiddenHarnesses = new Set(filters.hiddenHarnesses);
  // View options are not filters: they never mark the trigger active or clear.
  const display = useSessionListDisplay();

  const toggleHarness = (harness: HarnessId) => {
    const next = new Set(hiddenHarnesses);
    if (next.has(harness)) next.delete(harness);
    else next.add(harness);
    onChange({ ...filters, hiddenHarnesses: [...next] });
  };

  const setTime = (time: SessionTimeFilter) => {
    onChange({ ...filters, time });
  };

  const toggleStatus = (key: keyof SessionSidebarFilters["status"]) => {
    onChange({
      ...filters,
      status: { ...filters.status, [key]: !filters.status[key] },
    });
  };

  const toggleArchived = () => {
    onChange({ ...filters, showArchived: !filters.showArchived });
    onClose();
  };

  return (
    // Kept as Popover role=menu: filter toggles keep the menu open, DropdownMenu closes on pick.
    <Popover
      anchor={{ x, y }}
      gap={0}
      width={MENU_WIDTH}
      maxHeight={600}
      onDismiss={onClose}
      role="menu"
      aria-label={t("Filter sessions")}
      onContextMenu={(event) => event.preventDefault()}
      className="overflow-y-auto overscroll-none p-1"
    >
      <FilterItem label={t("Archived")} checked={filters.showArchived} onClick={toggleArchived} />
      <ManagedFilter
        local={local}
        checked={filters.assistantManaged}
        onClick={() => onChange({ ...filters, assistantManaged: !filters.assistantManaged })}
      />

      <SectionLabel as="div" className="px-2">
        {t("Status")}
      </SectionLabel>
      <FilterItem
        label={t("Working")}
        checked={filters.status.working}
        onClick={() => toggleStatus("working")}
      />
      <FilterItem
        label={t("Needs approval")}
        checked={filters.status.needsApproval}
        onClick={() => toggleStatus("needsApproval")}
      />
      <FilterItem
        label={t("Done")}
        checked={filters.status.done}
        onClick={() => toggleStatus("done")}
      />

      <SectionLabel as="div" className="px-2">
        {t("Time")}
      </SectionLabel>
      {TIME_OPTIONS.map((option) => (
        <FilterItem
          key={option.id}
          label={option.label}
          checked={filters.time === option.id}
          onClick={() => setTime(option.id)}
        />
      ))}

      {harnesses.length > 0 ? (
        <>
          <SectionLabel as="div" className="px-2">
            {t("Provider")}
          </SectionLabel>
          {harnesses.map((harness) => (
            <FilterItem
              key={harness}
              label={HARNESS_TITLE[harness]}
              checked={!hiddenHarnesses.has(harness)}
              icon={<HarnessIcon harness={harness} className="size-3.5 shrink-0" />}
              onClick={() => toggleHarness(harness)}
            />
          ))}
        </>
      ) : null}

      <SectionLabel as="div" className="px-2">
        {t("View")}
      </SectionLabel>
      {DENSITY_OPTIONS.map((option) => (
        <FilterItem
          key={option.id}
          role="menuitemradio"
          label={option.label}
          checked={display.density === option.id}
          onClick={() => updateSessionListDisplay({ density: option.id })}
        />
      ))}
      <FilterItem
        label={t("Show model")}
        checked={display.showModel}
        onClick={() => updateSessionListDisplay({ showModel: !display.showModel })}
      />
      <FilterItem
        label={t("Show branch")}
        checked={display.showBranch}
        onClick={() => updateSessionListDisplay({ showBranch: !display.showBranch })}
      />

      {hasActiveSessionFilters(filters) ? (
        <>
          <Divider />
          <Button
            fullWidth
            variant="item"
            type="button"
            role="menuitem"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(DEFAULT_SESSION_SIDEBAR_FILTERS)}
            className="w-full text-left"
          >
            {t("Clear filters")}
          </Button>
        </>
      ) : null}
    </Popover>
  );
}

function ManagedFilter({
  local,
  ...props
}: {
  local: boolean;
  checked: boolean;
  onClick: () => void;
}) {
  return local ? (
    <NamedManagedFilter {...props} />
  ) : (
    <FilterItem {...props} label={t("Managed sessions")} />
  );
}
function NamedManagedFilter(props: { checked: boolean; onClick: () => void }) {
  const { name } = useAssistantIdentity();
  return (
    <FilterItem
      {...props}
      label={name ? t("Managed by {p0}", { p0: name }) : t("Managed sessions")}
    />
  );
}

function FilterItem({
  label,
  checked,
  icon,
  role = "menuitemcheckbox",
  onClick,
}: {
  label: string;
  checked: boolean;
  icon?: ReactNode;
  role?: "menuitemcheckbox" | "menuitemradio";
  onClick: () => void;
}) {
  useLocale();
  return (
    <Button
      fullWidth
      variant="item"
      type="button"
      role={role}
      aria-checked={checked}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="w-full text-left"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked ? <Check className="icon-sm shrink-0" strokeWidth={2} /> : null}
    </Button>
  );
}
