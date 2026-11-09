import { t, useT } from "../../../shared/i18n";
import {
  DropdownMenu,
  type DropdownMenuAction,
  type DropdownMenuItem,
} from "../../../shared/ui/DropdownMenu";
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
  /** Offers the Settled row; only this computer's Host keeps settled records. */
  settled?: boolean;
  allowedTimeFilters?: readonly SessionTimeFilter[];
  defaultFilters?: SessionSidebarFilters;
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
  settled = false,
  allowedTimeFilters,
  defaultFilters = DEFAULT_SESSION_SIDEBAR_FILTERS,
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

  const managedName = useManagedFilterLabel(local);
  const check = (
    id: string,
    label: string,
    checked: boolean,
    extra?: Partial<DropdownMenuAction>,
  ) => ({ kind: "item", id, label, checked, ...extra }) satisfies DropdownMenuAction;
  const radio = (id: string, label: string, checked: boolean) =>
    check(id, label, checked, { selectionRole: "radio" });
  const actions: Record<string, () => void> = {};
  const toggle = (item: DropdownMenuAction, run: () => void): DropdownMenuAction => {
    actions[item.id] = run;
    return item;
  };
  const timeOptions = TIME_OPTIONS.filter(
    (option) => !allowedTimeFilters || allowedTimeFilters.includes(option.id),
  );
  const items: DropdownMenuItem[] = [
    toggle(
      check("archived", t("Archived"), filters.showArchived, { closeOnSelect: true }),
      toggleArchived,
    ),
    ...(settled
      ? [
          toggle(
            check("settled", t("Settled"), filters.showSettled, { closeOnSelect: true }),
            () => {
              onChange({ ...filters, showSettled: !filters.showSettled });
              onClose();
            },
          ),
        ]
      : []),
    toggle(check("managed", managedName, filters.assistantManaged), () =>
      onChange({ ...filters, assistantManaged: !filters.assistantManaged }),
    ),
    {
      kind: "group",
      id: "status",
      label: t("Status"),
      items: [
        toggle(check("working", t("Working"), filters.status.working), () =>
          toggleStatus("working"),
        ),
        toggle(check("needsApproval", t("Needs approval"), filters.status.needsApproval), () =>
          toggleStatus("needsApproval"),
        ),
        toggle(check("done", t("Done"), filters.status.done), () => toggleStatus("done")),
      ],
    },
    {
      kind: "group",
      id: "time",
      label: t("Time"),
      items: timeOptions.map((option) =>
        toggle(radio(`time:${option.id}`, option.label, filters.time === option.id), () =>
          setTime(option.id),
        ),
      ),
    },
    {
      kind: "group",
      id: "provider",
      label: t("Provider"),
      items: harnesses.map((harness) =>
        toggle(
          check(`harness:${harness}`, HARNESS_TITLE[harness], !hiddenHarnesses.has(harness), {
            icon: <HarnessIcon harness={harness} className="size-3.5 shrink-0" />,
          }),
          () => toggleHarness(harness),
        ),
      ),
    },
    {
      kind: "group",
      id: "view",
      label: t("View"),
      items: [
        ...DENSITY_OPTIONS.map((option) =>
          toggle(radio(`density:${option.id}`, option.label, display.density === option.id), () =>
            updateSessionListDisplay({ density: option.id }),
          ),
        ),
        toggle(check("showModel", t("Show model"), display.showModel), () =>
          updateSessionListDisplay({ showModel: !display.showModel }),
        ),
        toggle(check("showBranch", t("Show branch"), display.showBranch), () =>
          updateSessionListDisplay({ showBranch: !display.showBranch }),
        ),
      ],
    },
  ];
  if (hasActiveSessionFilters(filters, defaultFilters.time)) {
    items.push(
      { kind: "sep" },
      toggle({ kind: "item", id: "clear", label: t("Clear filters") }, () =>
        onChange(defaultFilters),
      ),
    );
  }

  return (
    <DropdownMenu
      anchor={{ x, y }}
      label={t("Filter sessions")}
      items={items}
      width={MENU_WIDTH}
      gap={0}
      maxHeight={600}
      closeOnSelect={false}
      onPick={(id) => actions[id]?.()}
      onClose={onClose}
    />
  );
}

/** The managed-sessions row names the assistant when it is local and has a name. */
function useManagedFilterLabel(local: boolean) {
  const { name } = useAssistantIdentity();
  return local && name ? t("Managed by {p0}", { p0: name }) : t("Managed sessions");
}
