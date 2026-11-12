import { Text } from "../../../shared/ui/Text";
import { ShortcutKbd } from "../../../shared/ui/ShortcutKbd";
import { Button } from "../../../shared/ui/Button";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Spinner } from "../../../shared/ui/Spinner";
import { Tooltip } from "../../../shared/ui/Tooltip";
import {
  PickerFooter,
  PickerList,
  PickerPopover,
  PopoverSearchHeader,
  filterPickerOptions,
  usePickerList,
  type PickerOption,
} from "../../../shared/ui/picker";
import { t, useLocale } from "../../../shared/i18n";
import { NativePopupHost } from "../../../shared/ui/NativePopupHost";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useProjectBranchesState } from "../../source-control/hooks/useProjectBranches";
import { useProjectWorktrees } from "../../source-control/hooks/useProjectWorktrees";
import type { Worktree } from "../../source-control/model/worktrees";
import { MOD, SHIFT } from "../../../platform/tauri/platform";
import { prettyCwd } from "../../../shared/lib/paths";
import type { WorkspaceMode } from "../../sessions/model/session";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderTree,
  GitBranch,
  Settings,
} from "../../../shared/ui/icons";
import { GitPickerTrigger } from "../../source-control/ui/GitPickerTrigger";
import { LAYER } from "../../../shared/lib/layers";
import { keybindingPressed, keybindingShortcutTokens } from "../../settings/model/settings";
import { useKeybindingShortcut } from "../../settings/model/useKeybindingShortcut";

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
    <Tooltip label={t(label)} when="overflow">
      <Text
        as="div"
        size="caption"
        tone="secondary"
        aria-label={t("Workspace {p0}", { p0: label })}
        className="flex h-6 min-w-0 shrink-0 items-center gap-1.5"
      >
        <Icon className="icon-sm shrink-0" />
        <Text size="inherit" tone="inherit" truncate>
          {t(label)}
        </Text>
      </Text>
    </Tooltip>
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
  const worktreeAnchor = useRef<HTMLElement | null>(null);
  const listId = useId();
  const existingRowId = `${listId}-option-2`;
  const flyoutListId = `${listId}-worktrees`;
  const [flyoutFocus, setFlyoutFocus] = useState(false);
  const closeWorktreeTimer = useRef<number | null>(null);
  const { data, error: loadError } = useProjectWorktrees(
    cwd,
    enabled && open && worktreeMenu && !!onSelectWorktree,
  );
  const worktrees = data?.worktrees.filter((tree) => !tree.isMain && !tree.missing) ?? [];

  // A disabled picker closes and forgets its transient menu state.
  if (!enabled && (open || worktreeMenu || busyPath !== undefined || pickError !== undefined)) {
    setOpen(false);
    setWorktreeMenu(false);
    setBusyPath(undefined);
    setPickError(undefined);
  }
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
  /** `focus` moves focus into the flyout (keyboard, click); hover leaves it where it is. */
  const openWorktreeMenu = (focus = false) => {
    if (closeWorktreeTimer.current != null) {
      window.clearTimeout(closeWorktreeTimer.current);
      closeWorktreeTimer.current = null;
    }
    worktreeAnchor.current = document.getElementById(existingRowId);
    setFlyoutFocus(focus);
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
  const closeWorktreeMenuAndFocusList = () => {
    closeWorktreeMenu();
    document.getElementById(listId)?.focus({ preventScroll: true });
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
  const shortcut = useKeybindingShortcut("Composer: Toggle Workspace");
  const shortcutTokens = keybindingShortcutTokens(
    "Composer: Toggle Workspace",
    "Meta+Shift+G Control+Shift+G",
  );
  const Icon = mode === "worktree" ? FolderTree : Folder;

  // "Existing worktree…" is an action row of the kit list (it opens the flyout instead of
  // changing the mode); the flyout anchors to that row, found again by its option id.
  const modeOptions: PickerOption[] = [
    { value: "current", title: t("Current checkout"), icon: <Folder className="icon-md" /> },
    { value: "worktree", title: t("New worktree"), icon: <FolderTree className="icon-md" /> },
    ...(onSelectWorktree
      ? [
          {
            value: "existing",
            title: t("Existing worktree…"),
            icon: <FolderTree className="icon-md" />,
            trailing: <ChevronRight aria-hidden className="icon-sm" strokeWidth={1.75} />,
            onAction: () => openWorktreeMenu(true),
          },
        ]
      : []),
  ];
  const worktreeOptions: PickerOption[] = worktrees.map((tree) => ({
    value: tree.path,
    title: tree.branch ?? t("Detached {p0}", { p0: tree.head.slice(0, 7) }),
    description: prettyCwd(tree.path),
    icon: busyPath === tree.path ? <Spinner size="md" /> : <FolderTree className="icon-md" />,
  }));

  // The row keeps the submenu semantics of the flyout it opens.
  useEffect(() => {
    if (!open || !onSelectWorktree) return;
    const row = document.getElementById(existingRowId);
    row?.setAttribute("aria-haspopup", "menu");
    row?.setAttribute("aria-expanded", String(worktreeMenu));
  }, [open, worktreeMenu, onSelectWorktree, existingRowId]);

  const onListMouseOver = (event: ReactMouseEvent<HTMLElement>) => {
    if (!onSelectWorktree || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('[role="option"]');
    if (!row) return;
    if (row.id === existingRowId) openWorktreeMenu(false);
    else closeWorktreeMenu();
  };
  const onListKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!onSelectWorktree) return;
    if (
      event.key === "ArrowRight" &&
      event.target instanceof Element &&
      event.target.getAttribute("aria-activedescendant") === existingRowId
    ) {
      event.preventDefault();
      openWorktreeMenu(true);
    } else if (event.key === "ArrowLeft" && worktreeMenu) {
      event.preventDefault();
      closeWorktreeMenu();
    }
  };

  return (
    <div ref={anchor} className="relative flex min-w-0 shrink-0">
      {!host ? (
        <Button
          variant="ghost"
          motion="none"
          type="button"
          disabled={!enabled}
          tooltip={t("Workspace: {p0}", { p0: label })}
          shortcut={shortcut}
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
          <Icon className="icon-sm shrink-0" />
          <Text size="inherit" tone="inherit" truncate>
            {label}
          </Text>
          <ChevronDown className="icon-xs shrink-0" tone="secondary" />
        </Button>
      ) : null}
      <PickerPopover
        open={open}
        anchor={anchor}
        side={popoverSide}
        width={240}
        maxHeight={400}
        onDismiss={dismiss}
        ignore={WORKSPACE_SURFACES}
        label={t("Workspace")}
        data-workspace-picker=""
        header={
          <div className="px-3">
            <SectionLabel
              as="div"
              actions={shortcut ? <ShortcutKbd size="xs">{shortcut}</ShortcutKbd> : undefined}
            >
              {t("Workspace")}
            </SectionLabel>
          </div>
        }
        footer={
          onOpenSettings ? (
            <PickerFooter align="start">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-label={t("Open worktree settings")}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={closeWorktreeMenu}
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
              >
                <Settings aria-hidden className="icon-sm" strokeWidth={1.75} />
                {t("Worktree settings")}
              </Button>
            </PickerFooter>
          ) : null
        }
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          onMouseOver={onListMouseOver}
          onMouseLeave={onSelectWorktree ? scheduleCloseWorktreeMenu : undefined}
          onKeyDown={onListKeyDown}
        >
          <PickerList
            id={listId}
            label={t("Workspace")}
            options={modeOptions}
            value={mode}
            onChange={(value: string) => {
              onChange(value as WorkspaceMode);
              dismiss();
            }}
          />
        </div>
      </PickerPopover>
      <PickerPopover
        open={open && worktreeMenu}
        anchor={worktreeAnchor}
        side="right"
        gap={SUBMENU_GAP}
        width={300}
        maxHeight={320}
        layer={LAYER.submenu}
        role="presentation"
        restoreFocus={false}
        label={t("Existing worktrees")}
        data-existing-worktrees-submenu=""
        onDismiss={(reason) => {
          // An outside press is the workspace menu to handle; Escape closes only the flyout.
          if (reason === "escape") closeWorktreeMenuAndFocusList();
        }}
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          onMouseEnter={() => openWorktreeMenu(false)}
          onMouseLeave={scheduleCloseWorktreeMenu}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              closeWorktreeMenuAndFocusList();
            }
          }}
        >
          <FocusOnMount enabled={flyoutFocus} id={flyoutListId} />
          <PickerList
            id={flyoutListId}
            label={t("Existing worktrees")}
            options={worktreeOptions}
            value={null}
            onChange={(path: string) => {
              const tree = worktrees.find((item) => item.path === path);
              if (tree) void selectWorktree(tree);
            }}
            disabled={!!busyPath}
            loading={!data && !loadError}
            loadingLabel={t("Loading worktrees…")}
            error={pickError || loadError}
            emptyLabel={t("No existing worktrees")}
          />
        </div>
      </PickerPopover>
    </div>
  );
}

/** Moves focus to a list after the popover has placed itself (its first pass is hidden). */
function FocusOnMount({ enabled, id }: { enabled: boolean; id: string }) {
  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(id)?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [enabled, id]);
  return null;
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
  const anchor = useRef<HTMLDivElement>(null);
  const options = useMemo<PickerOption[]>(() => {
    const unique = new Map<string, BaseBranch>();
    for (const branch of branches) unique.set(branchRef(branch), branch);
    return [...unique.keys()].map((ref) => ({
      value: ref,
      title: ref,
      icon: <GitBranch className="icon-md" />,
    }));
  }, [branches]);
  const rows = useMemo(() => filterPickerOptions(options, query), [options, query]);

  // A disabled picker closes.
  if (!enabled && open) setOpen(false);

  const dismiss = () => {
    setOpen(false);
    setQuery("");
    onClose?.();
  };
  const picker = usePickerList({
    options: rows,
    value: selected,
    onChange: (ref) => {
      onChange(ref);
      dismiss();
    },
    resetKey: `${open}:${query}`,
  });

  return (
    <div ref={anchor} className="relative flex min-w-0 shrink-0">
      <GitPickerTrigger
        disabled={!enabled}
        aria-label={t("Create worktree from {p0}", { p0: selected })}
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        label={t("From {p0}", { p0: selected })}
        loading={loading}
      />
      <PickerPopover
        open={open}
        anchor={anchor}
        side={popoverSide}
        width={280}
        minHeight={160}
        maxHeight={280}
        onDismiss={dismiss}
        label={t("Worktree base branch")}
        header={
          <PopoverSearchHeader
            label={t("Search base branches")}
            placeholder={t("Search base branches…")}
            value={query}
            onValueChange={setQuery}
            {...picker.searchProps}
          />
        }
      >
        <PickerList
          label={t("Base branches")}
          controller={picker}
          query={query}
          checkPlacement="icon"
          emptyLabel={t("No matching branches")}
        />
      </PickerPopover>
    </div>
  );
}
