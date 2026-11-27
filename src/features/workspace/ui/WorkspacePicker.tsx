import { Text } from "../../../shared/ui/Text";
import { Button, type ButtonProps } from "../../../shared/ui/Button";
import { ListRow } from "../../../shared/ui/ListRow";
import { Spinner } from "../../../shared/ui/Spinner";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { InlineError } from "../../../shared/ui/InlineError";
import { Tooltip } from "../../../shared/ui/Tooltip";
import {
  PickerFooter,
  PickerList,
  PickerPopover,
  PopoverSearchHeader,
  filterPickerOptions,
  usePickerList,
  usePointerMovement,
  type PickerOption,
} from "../../../shared/ui/picker";
import { PickerChoice } from "../../../shared/ui/picker/PickerChoice";
import { t, useLocale } from "../../../shared/i18n";
import { Popover, useNativePopoverHost } from "../../../shared/ui/Popover";
import {
  useCallback,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useProjectBranchesState } from "../../source-control/public/useProjectBranches";
import { useProjectWorktrees } from "../../source-control/public/useProjectWorktrees";
import type { Worktree } from "../../source-control/model/worktrees";
import { MOD, SHIFT } from "../../../platform/tauri/platform";
import { prettyCwd, projectKey } from "../../../shared/lib/paths";
import { basename } from "../../../platform/tauri/fs";
import { shortSha } from "../../../shared/lib/shortSha";
import type { Session, WorkspaceMode } from "../../sessions";
import {
  previousWorktreeCandidates,
  previousWorktreeFor,
} from "../../workspaces/model/previousWorktree";
import { isProjectlessCwd } from "../../sessions/public/projectless";
import { ChevronRight, Folder, FolderTree, GitBranch, Settings } from "../../../shared/ui/icons";
import { GitPickerTrigger } from "../../source-control/ui/GitPickerTrigger";
import { LAYER } from "../../../shared/lib/layers";
import { keybindingPressed, keybindingShortcutTokens } from "../../settings/model/settings";
import { useKeybindingShortcut } from "../../settings/model/useKeybindingShortcut";

export const WORKSPACE_MODE_SHORTCUT = `${MOD}${SHIFT}G`;
const WORKSPACE_SURFACES = "[data-workspace-picker],[data-existing-worktrees-submenu]";
const SUBMENU_GAP = 4;

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

type WorkspaceChipProps = {
  presentation: "chip";
  label: string;
  content: ReactNode;
  enabled?: boolean;
  worktree?: boolean;
};

export function WorkspacePicker(props: ComposerWorkspaceProps | WorkspaceChipProps) {
  if (props.presentation === "chip") return <WorkspaceChip {...props} />;
  return <ComposerWorkspacePicker {...props} />;
}

function WorkspaceTrigger({
  label,
  worktree,
  pending = false,
  ...props
}: Omit<ButtonProps, "label" | "iconOnly"> & {
  label: string;
  worktree: boolean;
  /** The workspace preview is being prepared. */
  pending?: boolean;
}) {
  const Icon = worktree ? FolderTree : Folder;
  return (
    <Button
      {...props}
      variant="chip"
      motion="none"
      type="button"
      aria-label={t("Workspace {p0}", { p0: label })}
      aria-haspopup="dialog"
      className="flex min-w-0 max-w-48 items-center gap-1.5"
    >
      {pending ? <Spinner size="sm" /> : <Icon aria-hidden className="icon-sm shrink-0" />}
      <Text size="inherit" tone="inherit" truncate>
        {label}
      </Text>
    </Button>
  );
}

/** The caller owns checkout data and keeps its controller mounted outside the popover. */
function WorkspaceChip({ label, content, enabled = true, worktree = false }: WorkspaceChipProps) {
  useLocale();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!enabled && open) setOpen(false);
  return (
    <div className="relative flex min-w-0">
      <WorkspaceTrigger
        ref={anchor}
        label={label}
        worktree={worktree}
        disabled={!enabled}
        expanded={open}
        onClick={() => setOpen(!open)}
      />
      {enabled && open ? (
        <Popover
          anchor={anchor}
          side="bottom"
          size="md"
          maxHeight={400}
          flow="scroll"
          kind="dialog"
          aria-label={t("Workspace")}
          onDismiss={() => setOpen(false)}
          className="grid min-w-0 gap-2"
        >
          {content}
        </Popover>
      ) : null}
    </div>
  );
}

/** Where a draft finds the worktree of the project's previous session, and how it binds it. */
type PreviousWorktreeSource = {
  /** The project folder whose sessions are searched. */
  project: string;
  /** The session being drafted; it is never its own previous worktree. */
  sessionId?: string;
  /** Every session of this computer, read when the menu is open. */
  getSessions: () => readonly Session[];
  /** The same binding the branch picker's "Existing worktrees" uses. */
  onSelect: (tree: Worktree) => Promise<void>;
};

type ComposerWorkspaceProps = {
  presentation?: "composer";
  children?: ReactNode;
  alignBase?: "inline" | "end";
  initialPicker?: "workspace" | "base";
  cwd: string;
  mode: WorkspaceMode;
  base?: string;
  enabled?: boolean;
  /** Shows a spinner on the chip while the workspace preview is prepared. */
  pending?: boolean;
  onModeChange: (mode: WorkspaceMode, base?: string) => void;
  onBaseChange: (base: string) => void;
  /** Start the new worktree from the fetched remote base. Needs `onBaseRemoteChange` to show. */
  baseRemote?: boolean;
  onBaseRemoteChange?: (remote: boolean) => void;
  /** Offers "Previous worktree" while the project has a usable one. */
  previousWorktree?: PreviousWorktreeSource;
  onSelectWorktree?: (tree: Worktree) => Promise<void>;
  onOpenSettings?: () => void;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  popoverSide?: "top" | "bottom";
};

function ComposerWorkspacePicker({
  cwd,
  mode,
  base,
  enabled = true,
  pending = false,
  onModeChange,
  onBaseChange,
  baseRemote = false,
  onBaseRemoteChange,
  previousWorktree,
  onSelectWorktree,
  onOpenSettings,
  onClose,
  onOpenChange,
  popoverSide = "top",
  initialPicker,
  alignBase = "inline",
  children,
}: ComposerWorkspaceProps) {
  useLocale();
  const [modeOpen, setModeOpen] = useState(false);
  const [baseOpen, setBaseOpen] = useState(false);
  const reportMode = useCallback((open: boolean) => setModeOpen(open), []);
  const reportBase = useCallback((open: boolean) => setBaseOpen(open), []);
  useEffect(() => {
    onOpenChange?.(modeOpen || baseOpen);
  }, [modeOpen, baseOpen, onOpenChange]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  // Without a project folder there is no checkout to choose, so the chip does not exist.
  const projectless = !cwd || isProjectlessCwd(cwd);
  const { branches, settled } = useProjectBranchesState(cwd, enabled && !projectless);
  const resolvedBase = base || branches?.current || undefined;
  const effectiveBase = resolvedBase || "HEAD";
  if (projectless) return <>{children}</>;

  return (
    <>
      <WorkspaceModePicker
        initialOpen={initialPicker === "workspace"}
        cwd={cwd}
        mode={mode}
        pending={pending}
        enabled={enabled && !!resolvedBase}
        // A busy composer disables the chip for its own reason, which the chip needs no sentence for.
        disabledReason={
          enabled && !resolvedBase
            ? settled
              ? t("No base branch available")
              : t("Loading branches…")
            : undefined
        }
        onChange={(next) => onModeChange(next, next === "worktree" ? effectiveBase : undefined)}
        onSelectWorktree={onSelectWorktree}
        previousWorktree={previousWorktree}
        onOpenSettings={onOpenSettings}
        onClose={onClose}
        onOpenChange={reportMode}
        popoverSide={popoverSide}
      />
      {children}
      {mode === "worktree" ? (
        <div className={alignBase === "end" ? "ms-auto flex min-w-0 justify-end" : "flex min-w-0"}>
          <WorktreeBasePicker
            initialOpen={initialPicker === "base"}
            branches={branches?.branches ?? []}
            selected={effectiveBase}
            loading={!settled}
            enabled={enabled && !!branches}
            onChange={onBaseChange}
            remote={baseRemote}
            onRemoteChange={onBaseRemoteChange}
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
  const label = worktree ? t("Worktree") : t("Current checkout");
  return (
    <Tooltip label={label} when="overflow">
      <Text
        as="div"
        size="caption"
        tone="secondary"
        aria-label={t("Workspace {p0}", { p0: label })}
        className="flex h-6 min-w-0 shrink-0 items-center gap-1.5"
      >
        <Icon className="icon-sm shrink-0" />
        <Text size="inherit" tone="inherit" truncate>
          {label}
        </Text>
      </Text>
    </Tooltip>
  );
}

function WorkspaceModePicker({
  cwd,
  mode,
  pending,
  enabled,
  disabledReason,
  onChange,
  onSelectWorktree,
  previousWorktree,
  onOpenSettings,
  onClose,
  onOpenChange,
  popoverSide = "top",
  initialOpen = false,
}: {
  cwd: string;
  mode: WorkspaceMode;
  pending: boolean;
  enabled: boolean;
  disabledReason?: string;
  onChange: (mode: WorkspaceMode) => void;
  onSelectWorktree?: (tree: Worktree) => Promise<void>;
  previousWorktree?: PreviousWorktreeSource;
  onOpenSettings?: () => void;
  onClose?: () => void;
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  popoverSide?: "top" | "bottom";
}) {
  useLocale();
  const host = useNativePopoverHost();
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
  const existingRowId = `${listId}-option-${encodeURIComponent("existing")}`;
  const flyoutListId = `${listId}-worktrees`;
  const [flyoutFocus, setFlyoutFocus] = useState(false);
  const pointerMoved = usePointerMovement();
  const { data, error: loadError } = useProjectWorktrees(
    cwd,
    enabled && open && ((worktreeMenu && !!onSelectWorktree) || !!previousWorktree),
  );
  const worktrees = data?.worktrees.filter((tree) => !tree.isMain && !tree.missing) ?? [];
  const previous =
    open && previousWorktree && data
      ? previousWorktreeFor(
          previousWorktreeCandidates(
            previousWorktree.getSessions(),
            previousWorktree.sessionId,
            previousWorktree.project,
          ),
          projectKey(previousWorktree.project),
          cwd,
          data.worktrees,
        )
      : null;

  // A disabled picker closes and forgets its transient menu state.
  if (!enabled && (open || worktreeMenu || busyPath !== undefined || pickError !== undefined)) {
    setOpen(false);
    setWorktreeMenu(false);
    setBusyPath(undefined);
    setPickError(undefined);
  }

  const dismiss = () => {
    setOpen(false);
    setWorktreeMenu(false);
    setBusyPath(undefined);
    setPickError(undefined);
    onClose?.();
  };
  const selectWorktree = async (
    tree: Worktree,
    select: ((tree: Worktree) => Promise<void>) | undefined = onSelectWorktree,
  ) => {
    if (!select || busyPath) return;
    setBusyPath(tree.path);
    setPickError(undefined);
    try {
      await select(tree);
      dismiss();
    } catch (error) {
      setPickError(String(error));
      setBusyPath(undefined);
    }
  };
  // Pointer hover leaves focus on the parent list. Explicit activation enters the flyout.
  const openWorktreeMenu = (focus = true) => {
    worktreeAnchor.current = document.getElementById(existingRowId);
    setFlyoutFocus(focus);
    setWorktreeMenu(true);
  };
  const closeWorktreeMenu = () => {
    setWorktreeMenu(false);
    setPickError(undefined);
  };
  const closeWorktreeMenuAndFocusList = () => {
    closeWorktreeMenu();
    document.getElementById(listId)?.focus({ preventScroll: true });
  };
  const label = mode === "worktree" ? t("New worktree") : t("Current checkout");
  const shortcut = useKeybindingShortcut("Composer: Toggle Workspace");
  const shortcutTokens = keybindingShortcutTokens(
    "Composer: Toggle Workspace",
    "Meta+Shift+G Control+Shift+G",
  );

  // "Existing worktree…" is an action row of the kit list (it opens the flyout instead of
  // changing the mode); the flyout anchors to that row, found again by its option id.
  const modeOptions: PickerOption[] = [
    {
      value: "current",
      title: t("Current checkout"),
      description: t("Edit {p0} directly", {
        p0: basename(cwd) || prettyCwd(cwd),
      }),
      icon: <Folder className="icon-md" />,
    },
    {
      value: "worktree",
      title: t("New worktree"),
      description: t("Isolated copy, created on first send"),
      icon: <FolderTree className="icon-md" />,
    },
    ...(previous && previousWorktree
      ? [
          {
            value: "previous",
            title: t("Previous worktree"),
            description: previous.branch ?? t("Detached {p0}", { p0: shortSha(previous.head) }),
            icon:
              busyPath === previous.path ? (
                <Spinner size="md" />
              ) : (
                <FolderTree className="icon-md" />
              ),
            onAction: () => void selectWorktree(previous, previousWorktree.onSelect),
          },
        ]
      : []),
    ...(onSelectWorktree
      ? [
          {
            value: "existing",
            title: t("Existing worktree…"),
            icon: <FolderTree className="icon-md" />,
            trailing: <ChevronRight aria-hidden className="icon-sm" strokeWidth={1.75} />,
            onAction: () => openWorktreeMenu(),
            popup: { listId: flyoutListId, expanded: worktreeMenu },
          },
        ]
      : []),
  ];
  const worktreeOptions: PickerOption[] = worktrees.map((tree) => ({
    value: tree.path,
    title: tree.branch ?? t("Detached {p0}", { p0: shortSha(tree.head) }),
    description: prettyCwd(tree.path),
    icon: busyPath === tree.path ? <Spinner size="md" /> : <FolderTree className="icon-md" />,
  }));

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!onSelectWorktree) return;
    if (
      event.key === "ArrowRight" &&
      event.target instanceof Element &&
      event.target.getAttribute("aria-activedescendant") === existingRowId
    ) {
      event.preventDefault();
      openWorktreeMenu();
    } else if (event.key === "ArrowLeft" && worktreeMenu) {
      event.preventDefault();
      closeWorktreeMenu();
    }
  };

  return (
    <div ref={anchor} className="relative flex min-w-0 shrink-0">
      {!host ? (
        <WorkspaceTrigger
          label={label}
          worktree={mode === "worktree"}
          pending={pending}
          disabled={!enabled}
          disabledReason={disabledReason}
          tooltip={t("Workspace")}
          shortcut={shortcut}
          aria-keyshortcuts={shortcutTokens ?? undefined}
          data-composer-chip="checkout"
          expanded={open}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              dismiss();
              return;
            }
            setOpen(true);
          }}
        />
      ) : null}
      <PickerPopover
        open={open}
        anchor={anchor}
        side={popoverSide}
        size="lg"
        maxHeight={400}
        onDismiss={dismiss}
        ignore={WORKSPACE_SURFACES}
        label={t("Workspace")}
        data-workspace-picker=""
        footer={
          onOpenSettings ? (
            <PickerFooter align="start">
              <ListRow
                aria-label={t("Open worktree settings")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
              >
                <PickerChoice
                  selected={false}
                  icon={<Settings className="icon-md" />}
                  label={t("Worktree settings")}
                />
              </ListRow>
            </PickerFooter>
          ) : null
        }
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={onListKeyDown}
          onPointerMove={(event) => {
            if (event.pointerType !== "mouse" || !pointerMoved(event)) return;
            if (!(event.target instanceof Element)) return;
            const option = event.target.closest('[role="option"]');
            if (!worktreeMenu && onSelectWorktree && option?.id === existingRowId) {
              openWorktreeMenu(false);
            }
          }}
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
          {pickError && !worktreeMenu ? (
            <div className="px-2 py-1">
              <InlineError live="off" details={pickError}>
                {t("Could not use the previous worktree.")}
              </InlineError>
            </div>
          ) : null}
        </div>
      </PickerPopover>
      <PickerPopover
        open={open && worktreeMenu}
        anchor={worktreeAnchor}
        side="right"
        gap={SUBMENU_GAP}
        size="lg"
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
  remote = false,
  onRemoteChange,
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
  /** Starts from the base's fetched upstream; the checkbox shows only with `onRemoteChange`. */
  remote?: boolean;
  onRemoteChange?: (remote: boolean) => void;
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
        label={
          remote && onRemoteChange
            ? t("From {p0} (remote)", { p0: selected })
            : t("From {p0}", { p0: selected })
        }
        loading={loading}
      />
      <PickerPopover
        open={open}
        anchor={anchor}
        side={popoverSide}
        size="md"
        minHeight={160}
        maxHeight={280}
        onDismiss={dismiss}
        label={t("Worktree base branch")}
        footer={
          onRemoteChange ? (
            <PickerFooter align="start">
              <Checkbox
                size="caption"
                label={t("Start from remote")}
                checked={remote}
                onChange={(event) => onRemoteChange(event.currentTarget.checked)}
              />
            </PickerFooter>
          ) : null
        }
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
          emptyLabel={t("No matching branches")}
        />
      </PickerPopover>
    </div>
  );
}
