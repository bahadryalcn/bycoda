import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { motionAttributes } from "../../../shared/ui/Motion";
import { useT } from "../../../shared/i18n";
import { ChevronDown } from "../../../shared/ui/icons";
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { basename } from "../../../platform/tauri/fs";
import { prettyCwd, prettyParent } from "../../../shared/lib/paths";
import {
  looksLikeProject,
  projectRailItemsFrom,
  sameProjectPath,
  useProjectRailLayout,
  type RecentProject,
} from "../model/recents";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { ProjectLogoIcon } from "./ProjectLogoIcon";
import { MOD } from "../../../platform/tauri/platform";

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
    title: item.path,
    content: (
      <Text truncate size="secondary" tone="inherit" className="min-w-0 flex-1">
        {renderProjectLabel?.(item.path) ?? basename(item.path)}
      </Text>
    ),
    trailing: (
      <Text truncate size="micro" tone="secondary" className="max-w-28 shrink-0 font-mono">
        {prettyParent(item.path)}
      </Text>
    ),
  });
  const heading = (text: string) => (
    <Text as="p" weight="medium" tone="secondary" className="px-2.5 pb-1 pt-2">
      {text}
    </Text>
  );
  const items: DropdownMenuItem[] = [];
  if (inProject)
    items.push({
      kind: "content",
      id: "current",
      node: (
        <>
          {heading(t("Current project"))}
          <Text as="div" size="inherit" tone="secondary" className="px-2.5 py-1.5">
            <Text truncate as="p" size="secondary" tone="primary">
              {renderProjectLabel?.(cwd) ?? basename(cwd)}
            </Text>
            <Text truncate as="p" size="micro" tone="inherit" className="font-mono">
              {prettyParent(cwd)}
            </Text>
          </Text>
        </>
      ),
    });
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
          <Text as="p" size="secondary" tone="secondary" className="px-2.5 py-2">
            {t("No other projects")}
          </Text>
        ),
      });
    items.push(...previewRecents.map(projectItem));
  }
  if (overflowRecents.length > 0)
    items.push({
      kind: "item",
      id: MORE_ID,
      label: t("More Projects"),
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
        trailing: (
          <Text size="micro" tone="secondary" className="shrink-0 font-mono">
            {MOD}`
          </Text>
        ),
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
        tooltip={cwd}
        aria-label={t("Project {p0}", { p0: label })}
        selected={open}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={!enabled}
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
        className={
          buttonClassName ? `  ${buttonClassName}     ` : ` flex min-w-0 items-center gap-1.5    `
        }
      >
        {children ?? (
          <>
            <ProjectLogoIcon path={projectLogoPath} fallbackStrokeWidth={1.5} />
            <Text truncate size="caption" tone="inherit" className="font-mono">
              {label}
            </Text>
          </>
        )}
        {chevron ? (
          <ChevronDown
            tone="secondary"
            {...motionAttributes(
              { transition: "transform", duration: "standard", easing: "sheen" },
              `icon-xs shrink-0 ${open ? "rotate-180" : ""}`,
            )}
            strokeWidth={1.75}
          />
        ) : null}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={root}
          label={t("Project picker")}
          side={placement === "below" ? "bottom" : "top"}
          align="start"
          width={MENU_WIDTH}
          maxHeight={MENU_MAX_HEIGHT}
          items={items}
          search={{ value: query, onChange: setQuery, label: t("Search projects") }}
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
