import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n";
import { NativePopupHost } from "../../../shared/ui/NativePopupHost";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";
import { useProjectWorktrees } from "../../source-control/hooks/useProjectWorktrees";
import type { Worktree } from "../../source-control/model/worktrees";
import { MOD, SHIFT } from "../../../platform/tauri/platform";
import { prettyCwd } from "../../../shared/lib/paths";
import type { WorkspaceMode } from "../../sessions/model/session";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderTree,
  GitBranch,
  Loader,
  Search,
  Settings,
} from "../../../shared/ui/icons";
import { GitPickerTrigger } from "../../source-control/ui/GitPickerTrigger";
import { Popover } from "../../../shared/ui/Popover";
import { LAYER } from "../../../shared/lib/layers";
import {
  keybindingPressed,
  keybindingShortcutLabel,
  keybindingShortcutTokens,
} from "../../settings/model/settings";

export const WORKSPACE_MODE_SHORTCUT = `${MOD}${SHIFT}G`;
const WORKSPACE_SURFACES = "[data-workspace-picker],[data-existing-worktrees-submenu]";
const SUBMENU_GAP = 4;
const HOVER_CLOSE_MS = 100;

export function isWorkspaceModeShortcut(event: {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return keybindingPressed(
    "Composer: Toggle Workspace",
    event,
    (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "g",
  );
}

export function WorkspacePicker({
  cwd,
  mode,
  base,
  enabled = true,
  onModeChange,
  onBaseChange,
  onSelectWorktree,
  onOpenSettings,
  onClose,
  onOpenChange,
  popoverSide = "top",
  initialPicker,
  alignBase = "inline",
  children,
}: {
  children?: ReactNode;
  alignBase?: "inline" | "end";
  initialPicker?: "workspace" | "base";
  cwd: string;
  mode: WorkspaceMode;
  base?: string;
  enabled?: boolean;
  onModeChange: (mode: WorkspaceMode, base?: string) => void;
  onBaseChange: (base: string) => void;
  onSelectWorktree?: (tree: Worktree) => Promise<void>;
  onOpenSettings?: () => void;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  popoverSide?: "top" | "bottom";
}) {
  useLocale();
  const [modeOpen, setModeOpen] = useState(false);
  const [baseOpen, setBaseOpen] = useState(false);
  const reportMode = useCallback((open: boolean) => setModeOpen(open), []);
  const reportBase = useCallback((open: boolean) => setBaseOpen(open), []);
  useEffect(() => {
    onOpenChange?.(modeOpen || baseOpen);
  }, [modeOpen, baseOpen, onOpenChange]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  const { branches, settled } = useProjectBranchesState(cwd, enabled && !!cwd && cwd !== "~");
  const resolvedBase = base || branches?.current || undefined;
  const effectiveBase = resolvedBase || "HEAD";

  return (
    <>
      <WorkspaceModePicker
        initialOpen={initialPicker === "workspace"}
        cwd={cwd}
        mode={mode}
        enabled={enabled && !!resolvedBase}
        onChange={(next) => onModeChange(next, next === "worktree" ? effectiveBase : undefined)}
        onSelectWorktree={onSelectWorktree}
        onOpenSettings={onOpenSettings}
        onClose={onClose}
        onOpenChange={reportMode}
        popoverSide={popoverSide}
      />
      {children}
      {mode === "worktree" ? (
        <div className={alignBase === "end" ? "ml-auto flex min-w-0 justify-end" : "flex min-w-0"}>
          <WorktreeBasePicker
            initialOpen={initialPicker === "base"}
            branches={branches?.branches ?? []}
            selected={effectiveBase}
            loading={!settled}
            enabled={enabled && !!branches}
            onChange={onBaseChange}
            onClose={onClose}
            onOpenChange={reportBase}
            popoverSide={popoverSide}
          />
        </div>
      ) : null}
    </>
  );
}

/** A started conversation owns its working copy; only its branch stays mutable. */
export function WorkspaceIdentity({ worktree }: { worktree: boolean }) {
  useLocale();
  const Icon = worktree ? FolderTree : Folder;
  const label = worktree ? "Worktree" : "Current checkout";
  return (
    <div
      title={t("Workspace: {p0}", { p0: label })}
      aria-label={t("Workspace {p0}", { p0: label })}
      className="flex h-6 min-w-0 shrink-0 items-center gap-1.5 text-[12px] text-(--ui-text-secondary)"
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{t(label)}</span>
    </div>
  );
}

function WorkspaceModePicker({
  cwd,
  mode,
  enabled,
  onChange,
  onSelectWorktree,
  onOpenSettings,
  onClose,
  onOpenChange,
  popoverSide = "top",
  initialOpen = false,
}: {
  cwd: string;
  mode: WorkspaceMode;
  enabled: boolean;
  onChange: (mode: WorkspaceMode) => void;
  onSelectWorktree?: (tree: Worktree) => Promise<void>;
  onOpenSettings?: () => void;
  onClose?: () => void;
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  popoverSide?: "top" | "bottom";
}) {
  useLocale();
  const host = useContext(NativePopupHost);
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  const [worktreeMenu, setWorktreeMenu] = useState(false);
  const [busyPath, setBusyPath] = useState<string>();
  const [pickError, setPickError] = useState<string>();
  const anchor = useRef<HTMLDivElement>(null);
  const worktreeAnchor = useRef<HTMLButtonElement>(null);
  const closeWorktreeTimer = useRef<number | null>(null);
  const { data, error: loadError } = useProjectWorktrees(
    cwd,
    enabled && open && worktreeMenu && !!onSelectWorktree,
  );
  const worktrees = data?.worktrees.filter((tree) => !tree.isMain && !tree.missing) ?? [];

  useEffect(() => {
    if (enabled) return;
    setOpen(false);
    setWorktreeMenu(false);
    setBusyPath(undefined);
    setPickError(undefined);
  }, [enabled]);
  useEffect(
    () => () => {
      if (closeWorktreeTimer.current != null) {
        window.clearTimeout(closeWorktreeTimer.current);
      }
    },
    [],
  );

  const dismiss = () => {
    if (closeWorktreeTimer.current != null) {
      window.clearTimeout(closeWorktreeTimer.current);
      closeWorktreeTimer.current = null;
    }
    setOpen(false);
    setWorktreeMenu(false);
    setBusyPath(undefined);
    setPickError(undefined);
    onClose?.();
  };
  const selectWorktree = async (tree: Worktree) => {
    if (!onSelectWorktree || busyPath) return;
    setBusyPath(tree.path);
    setPickError(undefined);
    try {
      await onSelectWorktree(tree);
      dismiss();
    } catch (error) {
      setPickError(String(error));
      setBusyPath(undefined);
    }
  };
  const openWorktreeMenu = () => {
    if (closeWorktreeTimer.current != null) {
      window.clearTimeout(closeWorktreeTimer.current);
      closeWorktreeTimer.current = null;
    }
    setWorktreeMenu(true);
  };
  const closeWorktreeMenu = () => {
    if (closeWorktreeTimer.current != null) {
      window.clearTimeout(closeWorktreeTimer.current);
      closeWorktreeTimer.current = null;
    }
    setWorktreeMenu(false);
    setPickError(undefined);
  };
  const scheduleCloseWorktreeMenu = () => {
    if (closeWorktreeTimer.current != null) {
      window.clearTimeout(closeWorktreeTimer.current);
    }
    closeWorktreeTimer.current = window.setTimeout(() => {
      closeWorktreeTimer.current = null;
      setWorktreeMenu(false);
      setPickError(undefined);
    }, HOVER_CLOSE_MS);
  };
  const label = mode === "worktree" ? "New worktree" : "Current checkout";
  const shortcut = keybindingShortcutLabel("Composer: Toggle Workspace", WORKSPACE_MODE_SHORTCUT);
  const shortcutTokens = keybindingShortcutTokens(
    "Composer: Toggle Workspace",
    "Meta+Shift+G Control+Shift+G",
  );
  const Icon = mode === "worktree" ? FolderTree : Folder;

  return (
    <div ref={anchor} className="relative flex min-w-0 shrink-0">
      {!host ? (
        <Button
          variant="ghost"
          motion="none"
          type="button"
          disabled={!enabled}
          title={shortcut ? t("Workspace: {p0} ({p1})", { p0: label, p1: shortcut }) : undefined}
          aria-label={t("Workspace {p0}", { p0: label })}
          aria-keyshortcuts={shortcutTokens ?? undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              dismiss();
              return;
            }
            setOpen(true);
          }}
          className="-ml-1.5 flex min-w-0 max-w-48 items-center gap-1.5"
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 text-content/40" />
        </Button>
      ) : null}
      {open ? (
        <Popover
          anchor={anchor}
          side={popoverSide}
          width={240}
          constrainHeight={false}
          onDismiss={dismiss}
          ignore={WORKSPACE_SURFACES}
          role="dialog"
          aria-label={t("Workspace")}
          data-workspace-picker
          className="overflow-hidden p-1.5"
        >
          <div className="flex items-center justify-between gap-3 px-2 py-1 text-[11px] font-medium text-content/45">
            <span>{t("Workspace")}</span>
            {shortcut ? (
              <kbd className="font-sans text-[10px] font-normal text-content/35">{shortcut}</kbd>
            ) : null}
          </div>
          {(
            [
              ["current", "Current checkout", Folder],
              ["worktree", "New worktree", FolderTree],
            ] as const
          ).map(([value, text, RowIcon]) => (
            <Button
              variant="ghost"
              motion="none"
              key={value}
              type="button"
              aria-pressed={mode === value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={closeWorktreeMenu}
              onClick={() => {
                onChange(value);
                dismiss();
              }}
              className={`flex w-full items-center gap-2 `}
            >
              <RowIcon className="size-4 shrink-0 text-content/55" />
              <span className="flex-1">{text}</span>
              {mode === value ? <Check className="size-3.5" /> : null}
            </Button>
          ))}
          {onSelectWorktree ? (
            <Button
              variant="ghost"
              motion="none"
              ref={worktreeAnchor}
              type="button"
              aria-haspopup="menu"
              aria-expanded={worktreeMenu}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={openWorktreeMenu}
              onMouseLeave={scheduleCloseWorktreeMenu}
              onFocus={openWorktreeMenu}
              onClick={openWorktreeMenu}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  openWorktreeMenu();
                }
                if (event.key === "ArrowLeft" && worktreeMenu) {
                  event.preventDefault();
                  closeWorktreeMenu();
                }
              }}
              className={`flex w-full items-center gap-2 `}
            >
              <FolderTree className="size-4 shrink-0 text-content/55" />
              <span className="flex-1">{t("Existing worktree…")}</span>
              <ChevronRight className="size-3.5 shrink-0 text-content/45" />
            </Button>
          ) : null}
          {onOpenSettings ? (
            <div className="h-9 border-t border-stroke">
              <Button
                variant="ghost"
                motion="none"
                type="button"
                title={t("Open worktree settings")}
                aria-label={t("Open worktree settings")}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={closeWorktreeMenu}
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
                className="flex h-full w-full items-center gap-2"
              >
                <Settings className="size-4 shrink-0 text-content/45" strokeWidth={1.75} />
                <span className="flex-1">{t("Worktree settings")}</span>
              </Button>
            </div>
          ) : null}
        </Popover>
      ) : null}
      {open && worktreeMenu ? (
        <Popover
          anchor={worktreeAnchor}
          side="right"
          gap={SUBMENU_GAP}
          width={300}
          maxHeight={320}
          layer={LAYER.submenu}
          role="menu"
          aria-label={t("Existing worktrees")}
          data-existing-worktrees-submenu
          className="flex flex-col overflow-hidden p-1.5"
          onMouseEnter={openWorktreeMenu}
          onMouseLeave={scheduleCloseWorktreeMenu}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              closeWorktreeMenu();
              worktreeAnchor.current?.focus();
            }
          }}
        >
          {!data && !loadError ? (
            <p className="flex items-center gap-2 px-2 py-3 text-[12px] text-content/50">
              <Loader className="size-3.5 animate-spin" />
              {t("Loading worktrees…")}
            </p>
          ) : null}
          <div className="min-h-0 overflow-y-auto">
            {worktrees.map((tree) => (
              <Button
                variant="item"
                motion="none"
                key={tree.path}
                type="button"
                role="menuitem"
                title={tree.path}
                disabled={!!busyPath}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void selectWorktree(tree)}
                className="flex min-h-11 w-full items-center gap-2"
              >
                {busyPath === tree.path ? (
                  <Loader className="size-4 shrink-0 animate-spin text-content/55" />
                ) : (
                  <FolderTree className="size-4 shrink-0 text-content/55" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">
                    {tree.branch ?? t("Detached {p0}", { p0: tree.head.slice(0, 7) })}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-content/40">
                    {prettyCwd(tree.path)}
                  </span>
                </span>
              </Button>
            ))}
            {data && worktrees.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-content/50">{t("No existing worktrees")}</p>
            ) : null}
          </div>
          {pickError || loadError ? (
            <Alert tone="danger" role="alert">
              {pickError || loadError}
            </Alert>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}

type BaseBranch = { name: string; remote: string | null };

function branchRef(branch: BaseBranch): string {
  return branch.remote ? `${branch.remote}/${branch.name}` : branch.name;
}

export function WorktreeBasePicker({
  branches,
  selected,
  loading,
  enabled,
  onChange,
  onClose,
  onOpenChange,
  popoverSide = "top",
  initialOpen = false,
}: {
  branches: BaseBranch[];
  selected: string;
  loading: boolean;
  enabled: boolean;
  onChange: (base: string) => void;
  onClose?: () => void;
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  popoverSide?: "top" | "bottom";
}) {
  useLocale();
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const unique = new Map<string, BaseBranch>();
    for (const branch of branches) unique.set(branchRef(branch), branch);
    return [...unique.values()].filter((branch) =>
      branchRef(branch).toLowerCase().includes(needle),
    );
  }, [branches, query]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    setActive((index) => Math.max(0, Math.min(index, rows.length - 1)));
  }, [rows.length]);
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  const dismiss = () => {
    setOpen(false);
    setQuery("");
    onClose?.();
  };

  return (
    <div ref={anchor} className="relative flex min-w-0 shrink-0">
      <GitPickerTrigger
        disabled={!enabled}
        title={t("Create from {p0}", { p0: selected })}
        aria-label={t("Create worktree from {p0}", { p0: selected })}
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        label={t("From {p0}", { p0: selected })}
        loading={loading}
      />
      {open ? (
        <Popover
          anchor={anchor}
          side={popoverSide}
          width={280}
          minHeight={160}
          maxHeight={280}
          onDismiss={dismiss}
          role="dialog"
          aria-label={t("Worktree base branch")}
          className="flex flex-col overflow-hidden"
        >
          <label className="flex shrink-0 items-center gap-2 border-b border-stroke px-2 py-2.5 text-content/50">
            <Search className="size-3.5 shrink-0" />
            <SearchInput
              ref={search}
              value={query}
              placeholder={t("Search base branches…")}
              aria-label={t("Search base branches")}
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) =>
                    Math.max(
                      0,
                      Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
                    ),
                  );
                }
                if (event.key === "Enter" && rows[active]) {
                  event.preventDefault();
                  onChange(branchRef(rows[active]));
                  dismiss();
                }
              }}
              className="min-w-0 flex-1"
            />
          </label>
          <div
            role="listbox"
            aria-label={t("Base branches")}
            className="min-h-0 flex-1 overflow-y-auto p-1.5"
          >
            {rows.map((branch, index) => {
              const ref = branchRef(branch);
              const selectedRow = ref === selected;
              const highlighted = index === active;
              return (
                <Button
                  selected={highlighted}
                  fullWidth
                  variant="item"
                  motion="none"
                  key={ref}
                  type="button"
                  role="option"
                  aria-selected={selectedRow}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    onChange(ref);
                    dismiss();
                  }}
                  className={`flex w-full items-center gap-2 `}
                >
                  {selectedRow ? (
                    <Check className="size-3.5 shrink-0" />
                  ) : (
                    <GitBranch className="size-3.5 shrink-0 text-content/45" />
                  )}
                  <span className={`min-w-0 flex-1 truncate ${selectedRow ? "font-medium" : ""}`}>
                    {ref}
                  </span>
                </Button>
              );
            })}
            {rows.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-content/45">{t("No matching branches")}</p>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
