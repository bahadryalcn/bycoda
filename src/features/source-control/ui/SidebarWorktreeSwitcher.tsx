import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PopoverSearchHeader } from "../../../shared/ui/PopoverSearchHeader";
import { Spinner } from "../../../shared/ui/Spinner";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { useWorktreeFocus, type WorktreeFocus } from "../model/worktreeFocus";
import { createWorktree } from "../model/worktrees";
import { pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
import { Popover } from "../../../shared/ui/Popover";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { Check, ChevronsUpDown, FolderTree, GitBranch, Plus } from "../../../shared/ui/icons";

/** The sidebar title. Picking a worktree narrows the sidebar, and the
 * sessions opened from it, to that working copy and names it here. */
export function SidebarWorktreeSwitcher({
  cwd,
  projectLabel,
  projectIcon,
  tabStats,
  onSelect,
  pending = false,
  switchError,
}: {
  cwd: string;
  /** The project's saved display name; defaults to its folder name. */
  projectLabel?: string;
  /** The project's saved identity (logo or mascot), shown before its name. */
  projectIcon?: ReactNode;
  onSelect?: (focus?: WorktreeFocus) => void;
  pending?: boolean;
  switchError?: string;
  /** Open tabs per worktree path key; hidden worktrees can still hold some. */
  tabStats?: ReadonlyMap<string, { tabs: number; busy: boolean }>;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [reportedSwitchError, setReportedSwitchError] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState<string>();
  const creatingRef = useRef(false);
  const currentCwd = useRef(cwd);
  currentCwd.current = cwd;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const anchor = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const focus = useWorktreeFocus(cwd);
  const { data, error, loading, refresh } = useProjectWorktrees(cwd);
  // The project folder is the default, unfocused entry; missing worktrees
  // cannot be opened, so they are left out.
  const main = data?.worktrees.find((tree) => tree.isMain);
  const worktrees = data?.worktrees.filter((tree) => !tree.isMain && !tree.missing) ?? [];
  const createName = query.trim();
  const normalizedQuery = createName.toLocaleLowerCase();
  const rows = [
    {
      path: main?.path ?? cwd,
      branch: main?.branch ?? null,
      isMain: true,
      label: main?.branch ?? "Project folder",
      detail: "Project folder · all sessions",
    },
    ...worktrees.map((tree) => ({
      path: tree.path,
      branch: tree.branch,
      isMain: false,
      label: tree.branch ?? `Detached ${tree.head.slice(0, 7)}`,
      detail: prettyCwd(tree.path),
    })),
  ].filter((tree) =>
    `${tree.label}\n${tree.detail}\n${tree.path}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  const activeIndex = Math.min(active, Math.max(0, rows.length - 1));
  const activePath = rows[activeIndex]?.path;
  const canCreate = !!data && !error && !!createName && rows.length === 0;

  const closePicker = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
    setCreationError(undefined);
  };

  const openPicker = () => {
    setOpen(true);
    setQuery("");
    setActive(0);
    setCreationError(undefined);
    void refresh();
  };

  useEffect(() => {
    if (!open || creating) return;
    search.current?.focus();
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, creating]);

  useEffect(() => {
    if (open) activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, activePath]);

  const pick = (tree: (typeof rows)[number]) => {
    if (creating) return;
    onSelect?.(tree.isMain ? undefined : { path: tree.path, branch: tree.branch });
    closePicker();
  };

  const create = async () => {
    if (!canCreate || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreationError(undefined);
    try {
      const tree = await createWorktree(focus?.path ?? cwd, createName, "HEAD", false);
      await refresh();
      // Finishing a creation for a previous project must not navigate this one.
      if (!mounted.current || currentCwd.current !== cwd) return;
      onSelect?.({ path: tree.path, branch: tree.branch });
      closePicker();
    } catch (err) {
      if (mounted.current && currentCwd.current === cwd)
        setCreationError(err instanceof Error ? err.message : String(err));
    } finally {
      creatingRef.current = false;
      if (mounted.current) setCreating(false);
    }
  };

  // A deleted worktree cannot stay focused, or new sessions would start there.
  useEffect(() => {
    if (
      focus &&
      !pending &&
      !switchError &&
      data &&
      !data.worktrees.some(
        (tree) => !tree.isMain && !tree.missing && pathKey(tree.path) === pathKey(focus.path),
      )
    )
      onSelect?.(undefined);
  }, [cwd, data, focus, onSelect, pending, switchError]);

  // A newly reported switch error opens the picker so it is seen; closing it
  // afterwards stays possible while the same error is still shown.
  if (reportedSwitchError !== switchError) {
    setReportedSwitchError(switchError);
    if (switchError) setOpen(true);
  }

  const focused = focus && worktrees.find((tree) => pathKey(tree.path) === pathKey(focus.path));
  // The working copy shown after the project name: the focused worktree, or the project folder's branch when known.
  const copyName = focus
    ? (focused?.branch ?? focus.branch ?? "Detached worktree")
    : (main?.branch ?? undefined);
  const project = projectLabel ?? projectName(cwd);
  const fullTitle = copyName ? `${project} · ${copyName}` : project;
  return (
    <>
      <Button
        variant="item"
        motion="none"
        ref={anchor}
        type="button"
        data-tauri-drag-region="false"
        aria-label={t("Switch working copy")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={pending || creating}
        disabled={creating}
        tooltip={fullTitle}
        tooltipDetails={focus ? [prettyCwd(focus.path)] : undefined}
        tooltipWhen={focus ? "always" : "overflow"}
        onClick={() => {
          if (open) closePicker();
          else openPicker();
        }}
        onKeyDown={(event) => {
          if (open || event.key !== "ArrowDown") return;
          event.preventDefault();
          openPicker();
        }}
        className="flex h-6.5 w-fit min-w-0 max-w-full items-center gap-2"
      >
        {projectIcon ? (
          <span className="grid size-4 shrink-0 place-items-center">{projectIcon}</span>
        ) : null}
        <MiddleTruncate mode="text" className="min-w-0">
          {project}
        </MiddleTruncate>
        {copyName ? (
          <MiddleTruncate mode="text" tone="muted" className="min-w-0">
            {copyName}
          </MiddleTruncate>
        ) : null}
        {pending || creating ? (
          <Spinner
            label={creating ? t("Creating worktree") : t("Switching working copy")}
            className="shrink-0"
            tone="muted"
          />
        ) : (
          <ChevronsUpDown className="icon-sm shrink-0" tone="muted" />
        )}
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          side="bottom"
          align="start"
          width={280}
          maxHeight={360}
          onDismiss={() => {
            if (!creating) closePicker();
          }}
          role="dialog"
          aria-label={t("Working copies")}
          className="flex flex-col overflow-hidden"
        >
          <PopoverSearchHeader
            ref={search}
            size="md"
            label={t("Search working copies")}
            placeholder={t("Search or create a worktree...")}
            value={query}
            disabled={creating}
            onValueChange={(value) => {
              setQuery(value);
              setActive(0);
              setCreationError(undefined);
            }}
            onMove={(move) => {
              if (move !== "next" && move !== "previous") return;
              setActive(
                Math.max(0, Math.min(rows.length - 1, activeIndex + (move === "next" ? 1 : -1))),
              );
            }}
            onSubmit={() => {
              const tree = rows[activeIndex];
              if (tree) pick(tree);
              else if (canCreate) void create();
            }}
          />
          <div
            role="listbox"
            aria-label={t("Working copies")}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1.5"
          >
            {!data && !error ? (
              <LoadingText className="p-2">{t("Loading working copies…")}</LoadingText>
            ) : null}
            {rows.map((tree, index) => {
              const selected = tree.isMain
                ? !focus
                : !!focus && pathKey(focus.path) === pathKey(tree.path);
              return (
                <Button
                  selected={index === activeIndex}
                  variant="item"
                  motion="none"
                  key={tree.path}
                  ref={index === activeIndex ? activeOption : undefined}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tooltip={tree.path}
                  disabled={creating}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(tree)}
                  className={`  flex w-full items-center gap-2 text-left  ${
                    index === activeIndex ? "" : ""
                  }   `}
                >
                  {tree.isMain ? (
                    <GitBranch className="icon-sm shrink-0" tone="secondary" />
                  ) : (
                    <FolderTree className="icon-sm shrink-0" tone="secondary" />
                  )}
                  <span className="min-w-0 flex-1">
                    <MiddleTruncate mode="text" size="body">
                      {tree.label}
                    </MiddleTruncate>
                    <MiddleTruncate mode="path" size="caption" tone="secondary">
                      {tree.detail}
                    </MiddleTruncate>
                  </span>
                  <OpenTabs stats={tabStats?.get(pathKey(tree.path))} />
                  {selected ? <Check className="icon-sm shrink-0" /> : null}
                </Button>
              );
            })}
            {data && rows.length === 0 ? (
              <EmptyState
                size="inline"
                kind="filtered"
                className="px-2.5 py-3"
                description={t("No matching working copies")}
              />
            ) : null}
          </div>
          {creationError || switchError || error ? (
            <InlineError
              className="shrink-0 px-2 py-2"
              retry={
                error
                  ? {
                      onRetry: () => void refresh(),
                      pending: loading,
                      disabled: creating || pending,
                    }
                  : undefined
              }
            >
              {creationError || switchError || error}
            </InlineError>
          ) : null}
          {canCreate ? (
            <div className="shrink-0 border-t border-stroke p-1.5">
              <Button
                variant="item"
                motion="none"
                type="button"
                fullWidth
                align="start"
                loading={creating}
                startIcon={<Plus className="icon-md" strokeWidth={1.75} />}
                disabled={creating}
                onClick={() => void create()}
                tooltip={t("Create worktree {p0}", { p0: createName })}
                tooltipWhen="overflow"
              >
                <Text size="inherit" tone="inherit" truncate className="min-w-0">
                  {t("Create worktree ")}
                  {createName}
                </Text>
              </Button>
            </div>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}

/** Tabs a worktree keeps open while another one is shown. */
function OpenTabs({ stats }: { stats?: { tabs: number; busy: boolean } }) {
  useLocale();
  if (!stats?.tabs) return null;
  const label = `${stats.tabs} open tab${stats.tabs === 1 ? "" : "s"}${stats.busy ? ", working" : ""}`;
  return (
    <Tooltip label={label}>
      <Text
        aria-label={label}
        size="caption"
        tone="secondary"
        className="flex shrink-0 items-center gap-1 tabular-nums"
      >
        {stats.busy ? <Spinner size="xs" /> : null}
        {stats.tabs}
      </Text>
    </Tooltip>
  );
}
