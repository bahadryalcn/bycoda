import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { basename } from "../../../platform/tauri/fs";
import { prettyCwd } from "../../../shared/lib/paths";
import {
  looksLikeProject,
  projectRailItemsFrom,
  sameProjectPath,
  useProjectRailLayout,
  type RecentProject,
} from "../model/recents";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { SectionLabel } from "../../../shared/ui/SectionLabel";

type Props = {
  cwd: string;
  recents: RecentProject[];
  /** Moving an item offers the full project rail in a single list. */
  mode?: "switch" | "move";
  /** Active app project, which can differ from the item's current project. */
  activeCwd?: string;
  renderProjectLabel?: (path: string) => ReactNode;
  projectLogoPath?: string | null;
  enabled?: boolean;
  placement?: "above" | "below";
  className?: string;
  buttonClassName?: string;
  /** Chevron on the trailing edge; flips when the menu is open. */
  chevron?: boolean;
  children?: ReactNode;
  onCwdChange: (path: string) => void;
  onNewTerminal?: () => void;
  onClose?: () => void;
};

const MENU_WIDTH = 288;
const MENU_MAX_HEIGHT = 360;
const SUBMENU_MAX_HEIGHT = 320;
const PREVIEW = 5;
const MORE_ID = "more";
const NEW_TERMINAL_ID = "new-terminal";
const RECENT_PREFIX = "recent:";

export function CwdPicker({
  cwd,
  recents,
  mode = "switch",
  activeCwd,
  renderProjectLabel,
  projectLogoPath,
  enabled = true,
  placement = "above",
  className,
  buttonClassName,
  chevron = false,
  children,
  onCwdChange,
  onNewTerminal,
  onClose,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const escaped = useRef(false);
  const restoreFocus = useStableCallback(onClose);

  const inProject = looksLikeProject(cwd);
  const label = prettyCwd(cwd);
  // Read the saved rail order on opening, including changes made while Notes is open.
  const railLayout = useProjectRailLayout();
  const projects =
    mode === "move" ? projectRailItemsFrom(recents, activeCwd ?? "", railLayout) : recents;
  const otherRecents = projects.filter(
    (item) =>
      (!inProject || !sameProjectPath(item.path, cwd)) &&
      (!query.trim() ||
        `${basename(item.path)} ${item.path}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())),
  );
  const previewRecents =
    mode === "move" || query.trim() ? otherRecents : otherRecents.slice(0, PREVIEW);
  const overflowRecents = mode === "move" || query.trim() ? [] : otherRecents.slice(PREVIEW);

  const dismiss = (restore = false) => {
    setOpen(false);
    setQuery("");
    if (restore) restoreFocus?.();
  };

  const projectItem = (item: RecentProject): DropdownMenuItem & { kind: "item" } => ({
    kind: "item",
    id: RECENT_PREFIX + item.path,
    label: basename(item.path),
    // The parent folder is a hover detail, not a second column on every row.
    title: item.path,
    content: (
      <Text truncate size="secondary" tone="inherit" className="min-w-0 flex-1">
        {renderProjectLabel?.(item.path) ?? basename(item.path)}
      </Text>
    ),
  });
  const heading = (text: string) => (
    <SectionLabel variant="menu" tone="secondary">
      {text}
    </SectionLabel>
  );
  // The trigger already names the current project, so the menu lists only the others.
  const items: DropdownMenuItem[] = [];
  if (previewRecents.length > 0 || mode === "move") {
    items.push({
      kind: "content",
      id: "recent-heading",
      node: heading(mode === "move" ? t("Move to project") : t("Recent projects")),
    });
    if (mode === "move" && previewRecents.length === 0)
      items.push({
        kind: "content",
        id: "none",
        node: (
          <EmptyState size="inline" kind="empty" inset="row" description={t("No other projects")} />
        ),
      });
    items.push(...previewRecents.map(projectItem));
  }
  if (overflowRecents.length > 0)
    items.push({
      kind: "item",
      id: MORE_ID,
      label: t("More projects"),
      submenuLabel: t("More projects"),
      submenuWidth: MENU_WIDTH,
      submenuMaxHeight: SUBMENU_MAX_HEIGHT,
      submenu: overflowRecents.map(projectItem),
    });
  if (onNewTerminal)
    items.push(
      { kind: "sep" },
      {
        kind: "item",
        id: NEW_TERMINAL_ID,
        label: t("New terminal"),
        shortcut: "Mod+`",
      },
    );

  const pick = (id: string) => {
    restoreFocus?.();
    if (id === NEW_TERMINAL_ID) onNewTerminal?.();
    else if (id.startsWith(RECENT_PREFIX)) onCwdChange(id.slice(RECENT_PREFIX.length));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (enabled && !open && e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div ref={root} className={`relative flex h-full min-w-0${className ? ` ${className}` : ""}`}>
      <Button
        variant="item"
        motion="none"
        type="button"
        tooltip={inProject ? cwd : undefined}
        aria-label={inProject ? t("Project {p0}", { p0: label }) : t("No project")}
        selected={open}
        expanded={chevron ? open : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={!enabled}
        disabledReason={enabled ? undefined : t("Not available right now.")}
        data-tauri-drag-region="false"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!enabled) return;
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className={buttonClassName ?? "flex min-w-0 items-center gap-1.5"}
      >
        {children ?? (
          <>
            <ProjectLogoIcon path={projectLogoPath} fallbackStrokeWidth={1.5} />
            {/* The projectless state is one quiet label, same type as a project trigger. */}
            <Text
              truncate
              size="caption"
              tone="inherit"
              className={inProject ? "font-mono" : undefined}
            >
              {inProject ? label : t("No project")}
            </Text>
          </>
        )}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={root}
          label={t("Project picker")}
          side={placement === "below" ? "bottom" : "top"}
          align="start"
          size="md"
          maxHeight={MENU_MAX_HEIGHT}
          items={items}
          search={
            mode === "move" || projects.length > PREVIEW
              ? { value: query, onChange: setQuery, label: t("Search projects") }
              : undefined
          }
          onPick={pick}
          onEscape={() => {
            escaped.current = true;
            return false;
          }}
          onClose={() => {
            dismiss(escaped.current);
            escaped.current = false;
          }}
          data-cwd-picker
        />
      ) : null}
    </div>
  );
}
