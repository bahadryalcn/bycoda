import { t, useT } from "../../../shared/i18n";
import {
  DropdownMenu,
  type DropdownMenuAction,
  type DropdownMenuItem,
} from "../../../shared/ui/DropdownMenu";
import {
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  hasActiveSessionFilters,
  type GlobalSessionListView,
  type SessionSidebarFilters,
  type SessionTimeFilter,
} from "../model/sessionFilters";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { ArrowDown, CircleDot, FolderTree } from "../../../shared/ui/icons";
import { useAssistantIdentity } from "../../assistant/model/assistantClient";
import {
  type SessionListDensity,
  type SessionListDisplay,
  updateSessionListDisplay,
  useSessionListDisplay,
} from "../model/sessionListDisplay";
import { OPEN_SESSION_IMPORT_EVENT } from "../import/importModel";

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
  listView?: GlobalSessionListView;
  onListViewChange?: (view: GlobalSessionListView) => void;
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
  listView,
  onListViewChange,
}: Props) {
  const t = useT();
  const hiddenHarnesses = new Set(filters.hiddenHarnesses);

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
    ...(listView && onListViewChange
      ? [
          toggle(
            check("group:project", t("Group by project"), listView.groupBy === "project", {
              icon: <FolderTree className="icon-xs" />,
            }),
            () =>
              onListViewChange({
                ...listView,
                groupBy: listView.groupBy === "project" ? "none" : "project",
              }),
          ),
          toggle(
            check("group:state", t("Group by state"), listView.groupBy === "state", {
              icon: <CircleDot className="icon-xs" />,
            }),
            () =>
              onListViewChange({
                ...listView,
                groupBy: listView.groupBy === "state" ? "none" : "state",
              }),
          ),
          {
            kind: "item" as const,
            id: "sort",
            label: t("Sort"),
            icon: <ArrowDown className="icon-xs" />,
            submenu: [
              toggle(radio("sort:newest", t("Newest first"), listView.sort === "newest"), () =>
                onListViewChange({ ...listView, sort: "newest" }),
              ),
              toggle(radio("sort:oldest", t("Oldest first"), listView.sort === "oldest"), () =>
                onListViewChange({ ...listView, sort: "oldest" }),
              ),
            ],
          },
          { kind: "sep" as const },
        ]
      : []),
    {
      kind: "group",
      id: "show",
      label: t("Show"),
      items: [
        toggle(check("archived", t("Archived"), filters.showArchived), toggleArchived),
        ...(settled
          ? [
              toggle(check("settled", t("Settled"), filters.showSettled), () =>
                onChange({ ...filters, showSettled: !filters.showSettled }),
              ),
            ]
          : []),
        toggle(check("managed", managedName, filters.assistantManaged), () =>
          onChange({ ...filters, assistantManaged: !filters.assistantManaged }),
        ),
        toggle(check("background", t("Show background sessions"), filters.showBackground), () =>
          onChange({ ...filters, showBackground: !filters.showBackground }),
        ),
      ],
    },
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
    ...(harnesses.length > 1 || harnesses.some((harness) => hiddenHarnesses.has(harness))
      ? [
          {
            kind: "group" as const,
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
        ]
      : []),
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
      size="sm"
      closeOnSelect={false}
      onPick={(id) => actions[id]?.()}
      onClose={onClose}
    />
  );
}

export function SessionViewMenu({
  x,
  y,
  onClose,
  canImport = false,
}: Pick<Props, "x" | "y" | "onClose"> & { canImport?: boolean }) {
  const t = useT();
  const display = useSessionListDisplay();
  const fields = [
    { id: "showModel" as const, label: t("Show model") },
    { id: "showBranch" as const, label: t("Show branch") },
  ];
  return (
    <DropdownMenu
      anchor={{ x, y }}
      label={t("View")}
      size="sm"
      items={[
        ...DENSITY_OPTIONS.map(({ id, label }): DropdownMenuAction => ({
          kind: "item",
          id,
          label,
          checked: display.density === id,
          selectionRole: "radio",
        })),
        { kind: "sep" },
        ...fields.map(({ id, label }): DropdownMenuAction => ({
          kind: "item",
          id,
          label,
          checked: display[id],
        })),
        ...(canImport
          ? [
              { kind: "sep" as const },
              { kind: "item" as const, id: "import", label: t("Import history") },
            ]
          : []),
      ]}
      closeOnSelect={false}
      onPick={(id) => {
        if (id === "import") {
          onClose();
          window.dispatchEvent(new Event(OPEN_SESSION_IMPORT_EVENT));
          return;
        }
        const density = DENSITY_OPTIONS.find((option) => option.id === id)?.id;
        const field = fields.find((option) => option.id === id)?.id;
        const change: Partial<SessionListDisplay> | undefined = density
          ? { density }
          : field
            ? { [field]: !display[field] }
            : undefined;
        if (change) updateSessionListDisplay(change);
      }}
      onClose={onClose}
    />
  );
}

/** The managed-sessions row names the assistant when it is local and has a name. */
function useManagedFilterLabel(local: boolean) {
  const t = useT();
  const { name } = useAssistantIdentity();
  return local && name ? t("Managed by {p0}", { p0: name }) : t("Managed sessions");
}
