import { SearchInput } from "../../../shared/ui/SearchInput";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { basename } from "../../../platform/tauri/fs";
import { prettyCwd, prettyParent } from "../../../shared/lib/paths";
import {
  looksLikeProject,
  projectRailItems,
  sameProjectPath,
  type RecentProject,
} from "../model/recents";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { LAYER } from "../../../shared/lib/layers";
import { Popover } from "../../../shared/ui/Popover";
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
const SUBMENU_GAP = 4;
const HOVER_CLOSE_MS = 100;
/* Both menus sit outside the trigger, so neither counts as a click-away. */
const SELF = "[data-cwd-picker],[data-cwd-submenu]";

type Row = { kind: "recent"; path: string } | { kind: "more" } | { kind: "new-terminal" };

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
  useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const closeMoreTimer = useRef<number | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const inProject = looksLikeProject(cwd);
  const label = prettyCwd(cwd);
  // Read the saved rail order on opening, including changes made while Notes is open.
  const projects = mode === "move" ? projectRailItems(recents, activeCwd ?? "") : recents;
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
  const hasMore = overflowRecents.length > 0;

  useEffect(() => {
    if (mode === "move") activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, open, mode]);

  const rows = useMemo((): Row[] => {
    const out: Row[] = previewRecents.map((item) => ({
      kind: "recent",
      path: item.path,
    }));
    if (hasMore) out.push({ kind: "more" });
    if (onNewTerminal) out.push({ kind: "new-terminal" });
    return out;
  }, [hasMore, onNewTerminal, previewRecents]);

  const dismiss = (restore = false) => {
    setOpen(false);
    setQuery("");
    setMoreOpen(false);
    setActive(0);
    if (closeMoreTimer.current != null) {
      window.clearTimeout(closeMoreTimer.current);
      closeMoreTimer.current = null;
    }
    if (restore) onCloseRef.current?.();
  };

  const openMore = () => {
    if (closeMoreTimer.current != null) {
      window.clearTimeout(closeMoreTimer.current);
      closeMoreTimer.current = null;
    }
    setMoreOpen(true);
  };

  const scheduleCloseMore = () => {
    if (closeMoreTimer.current != null) window.clearTimeout(closeMoreTimer.current);
    closeMoreTimer.current = window.setTimeout(() => {
      closeMoreTimer.current = null;
      setMoreOpen(false);
    }, HOVER_CLOSE_MS);
  };

  const pick = (row: Row) => {
    if (row.kind === "more") return;
    dismiss(true);
    if (row.kind === "new-terminal") {
      onNewTerminal?.();
      return;
    }
    onCwdChange(row.path);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!enabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const row = rows[active + 1];
      if (row?.kind === "more") openMore();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    }
    if (e.key === "ArrowRight") {
      const row = rows[active];
      if (row?.kind === "more") {
        e.preventDefault();
        openMore();
      }
    }
    if (e.key === "ArrowLeft") {
      if (moreOpen) {
        e.preventDefault();
        setMoreOpen(false);
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row?.kind === "more") {
        openMore();
        return;
      }
      if (row) pick(row);
    }
  };

  const newTerminalIndex = onNewTerminal ? previewRecents.length + (hasMore ? 1 : 0) : -1;
  const moreIndex = hasMore ? previewRecents.length : -1;

  return (
    <div ref={root} className={`relative flex h-full min-w-0${className ? ` ${className}` : ""}`}>
      <Button
        variant="item"
        motion="none"
        type="button"
        title={cwd}
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
            <span className="truncate font-mono text-[12px]">{label}</span>
          </>
        )}
        {chevron ? (
          <ChevronDown
            className={`size-3 shrink-0 text-(--ui-text-secondary) ${open ? "rotate-180" : ""}`}
            strokeWidth={1.75}
          />
        ) : null}
      </Button>
      {open ? (
        <Popover
          anchor={root}
          side={placement === "below" ? "bottom" : "top"}
          width={MENU_WIDTH}
          maxHeight={MENU_MAX_HEIGHT}
          ignore={SELF}
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="menu"
          aria-label={t("Project picker")}
          data-cwd-picker
          className="flex flex-col overflow-hidden"
        >
          <div className="shrink-0 p-2">
            <SearchInput
              standalone
              aria-label={t("Search projects")}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
                setMoreOpen(false);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div ref={lockOverscroll} className="min-h-0 flex-1 overflow-y-auto overscroll-none py-1">
            {inProject ? (
              <>
                <p className="px-2.5 pb-1 pt-2 text-(length:--ui-font-caption) font-medium text-(--ui-text-secondary)">
                  {t("Current project")}
                </p>
                <div className="px-2.5 py-1.5 text-(--ui-text-secondary)">
                  <p className="truncate text-[13px] text-content">
                    {renderProjectLabel?.(cwd) ?? basename(cwd)}
                  </p>
                  <p className="truncate font-mono text-[11px]">{prettyParent(cwd)}</p>
                </div>
              </>
            ) : null}
            {previewRecents.length > 0 || mode === "move" ? (
              <>
                <p className="px-2.5 pb-1 pt-2 text-(length:--ui-font-caption) font-medium text-(--ui-text-secondary)">
                  {mode === "move" ? t("Move to project") : t("Recent projects")}
                </p>
                {mode === "move" && previewRecents.length === 0 ? (
                  <p className="px-2.5 py-2 text-[13px] text-(--ui-text-secondary)">
                    {t("No other projects")}
                  </p>
                ) : null}
                {previewRecents.map((item, index) => (
                  <Button
                    variant="item"
                    motion="none"
                    key={item.path}
                    selected={active === index}
                    ref={active === index ? activeRef : undefined}
                    type="button"
                    role="menuitem"
                    title={item.path}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseEnter={() => {
                      setMoreOpen(false);
                      setActive(index);
                    }}
                    onClick={() => pick({ kind: "recent", path: item.path })}
                    className={` flex w-full items-center justify-between gap-3 text-left  ${
                      active === index ? "" : ""
                    }  `}
                  >
                    <span className="min-w-0 truncate text-[13px]">
                      {renderProjectLabel?.(item.path) ?? basename(item.path)}
                    </span>
                    <span className="max-w-28 shrink-0 truncate font-mono text-[11px] text-(--ui-text-secondary)">
                      {prettyParent(item.path)}
                    </span>
                  </Button>
                ))}
              </>
            ) : null}
            {hasMore ? (
              <Button
                variant="item"
                motion="none"
                selected={active === moreIndex || moreOpen}
                ref={moreRef}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={() => {
                  setActive(moreIndex);
                  openMore();
                }}
                onMouseLeave={scheduleCloseMore}
                onFocus={() => {
                  setActive(moreIndex);
                  openMore();
                }}
                className={` flex w-full items-center justify-between gap-3 text-left  ${
                  active === moreIndex || moreOpen ? "" : ""
                }  `}
              >
                <span className="text-[13px]">{t("More Projects")}</span>
                <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.75} />
              </Button>
            ) : null}
          </div>
          {onNewTerminal ? (
            <div className="shrink-0 border-t border-stroke py-1">
              <Button
                variant="item"
                motion="none"
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={() => {
                  setMoreOpen(false);
                  setActive(newTerminalIndex);
                }}
                selected={active === newTerminalIndex}
                onClick={() => pick({ kind: "new-terminal" })}
                className={` flex w-full items-center justify-between gap-3 text-left  ${
                  active === newTerminalIndex ? "" : ""
                }  `}
              >
                <span className="text-[13px]">{t("New terminal")}</span>
                <span className="shrink-0 font-mono text-[11px] text-(--ui-text-secondary)">
                  {MOD}`
                </span>
              </Button>
            </div>
          ) : null}
        </Popover>
      ) : null}
      {open && moreOpen ? (
        <Popover
          anchor={moreRef}
          side="right"
          gap={SUBMENU_GAP}
          width={MENU_WIDTH}
          maxHeight={SUBMENU_MAX_HEIGHT}
          layer={LAYER.submenu}
          role="menu"
          aria-label={t("More projects")}
          data-cwd-submenu
          className="overflow-y-auto overscroll-none py-1"
          onMouseEnter={openMore}
          onMouseLeave={scheduleCloseMore}
        >
          {overflowRecents.map((item) => (
            <Button
              variant="item"
              motion="none"
              key={item.path}
              type="button"
              role="menuitem"
              title={item.path}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => pick({ kind: "recent", path: item.path })}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="min-w-0 truncate text-[13px]">
                {renderProjectLabel?.(item.path) ?? basename(item.path)}
              </span>
              <span className="max-w-28 shrink-0 truncate font-mono text-[11px] text-(--ui-text-secondary)">
                {prettyParent(item.path)}
              </span>
            </Button>
          ))}
        </Popover>
      ) : null}
    </div>
  );
}
