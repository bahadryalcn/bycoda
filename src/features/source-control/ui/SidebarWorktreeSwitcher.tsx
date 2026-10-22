import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useRef, useState } from "react";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { useWorktreeFocus, type WorktreeFocus } from "../model/worktreeFocus";
import { createWorktree } from "../model/worktrees";
import { pathKey, prettyCwd } from "../../../shared/lib/paths";
import { Popover } from "../../../shared/ui/Popover";
import {
  Check,
  ChevronsUpDown,
  FolderTree,
  GitBranch,
  Loader,
  Plus,
  Search,
} from "../../../shared/ui/icons";

/** The sidebar title. Picking a worktree narrows the sidebar, and the
 * sessions opened from it, to that working copy and names it here. */
export function SidebarWorktreeSwitcher({
  cwd,
  tabStats,
  onSelect,
  pending = false,
  switchError,
}: {
  cwd: string;
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
  const { data, error, refresh } = useProjectWorktrees(cwd);
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

  useEffect(() => {
    if (switchError) setOpen(true);
  }, [switchError]);

  const focused = focus && worktrees.find((tree) => pathKey(tree.path) === pathKey(focus.path));
  const title = focus ? (focused?.branch ?? focus.branch ?? "Detached worktree") : "Workspace";
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
        title={
          focus
            ? `${focus.branch ?? "detached"}\n${prettyCwd(focus.path)}`
            : (main?.branch ?? t("Project folder"))
        }
        onClick={() => {
          if (open) closePicker();
          else openPicker();
        }}
        onKeyDown={(event) => {
          if (open || event.key !== "ArrowDown") return;
          event.preventDefault();
          openPicker();
        }}
        className="-ml-1.5 flex h-6.5 min-w-0 max-w-full items-center gap-2 leading-tight"
      >
        <span className="min-w-0 truncate">{title}</span>
        {pending || creating ? (
          <Loader
            aria-label={creating ? t("Creating worktree") : t("Switching working copy")}
            className="size-3.5 shrink-0 animate-spin text-[var(--ui-text-muted)]"
          />
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 text-[var(--ui-text-muted)]" />
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
          <label className="flex h-11 shrink-0 items-center gap-2.5 border-b border-stroke px-3 text-[var(--ui-text-muted)] focus-within:text-[var(--ui-text-secondary)]">
            <Search className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="sr-only">{t("Search working copies")}</span>
            <SearchInput
              ref={search}
              value={query}
              disabled={creating}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("Search or create a worktree...")}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
                setCreationError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive(
                    Math.max(
                      0,
                      Math.min(rows.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1)),
                    ),
                  );
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  const tree = rows[activeIndex];
                  if (tree) pick(tree);
                  else if (canCreate) void create();
                }
              }}
              className="min-w-0 flex-1"
            />
          </label>
          <div
            role="listbox"
            aria-label={t("Working copies")}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1.5"
          >
            {!data && !error ? (
              <div className="flex items-center gap-2 p-2 text-[12px] text-[var(--ui-text-secondary)]">
                <Loader className="size-3.5 animate-spin" />
                {t("Loading working copies…")}
              </div>
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
                  title={tree.path}
                  disabled={creating}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(tree)}
                  className={`  flex w-full items-center gap-2 text-left  ${
                    index === activeIndex ? "" : ""
                  }   `}
                >
                  {tree.isMain ? (
                    <GitBranch className="size-3.5 shrink-0 text-[var(--ui-text-secondary)]" />
                  ) : (
                    <FolderTree className="size-3.5 shrink-0 text-[var(--ui-text-secondary)]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px]">{tree.label}</span>
                    <span className="block truncate text-(length:--ui-font-caption) text-(--ui-text-secondary)">
                      {tree.detail}
                    </span>
                  </span>
                  <OpenTabs stats={tabStats?.get(pathKey(tree.path))} />
                  {selected ? <Check className="size-3.5 shrink-0" /> : null}
                </Button>
              );
            })}
            {data && rows.length === 0 ? (
              <p className="px-2.5 py-5 text-center text-[12px] text-(--ui-text-secondary)">
                {t("No matching working copies")}
              </p>
            ) : null}
          </div>
          {creationError || switchError || error ? (
            <p role="alert" className="px-2 py-2 text-[11px] text-danger">
              {creationError || switchError || error}
            </p>
          ) : null}
          {canCreate ? (
            <div className="shrink-0 border-t border-stroke p-1.5">
              <Button
                variant="item"
                motion="none"
                type="button"
                disabled={creating}
                onClick={() => void create()}
                title={t("Create worktree {p0}", { p0: createName })}
                className="flex h-9 w-full items-center gap-2.5 text-left"
              >
                {creating ? (
                  <Loader className="size-4 shrink-0 animate-spin" />
                ) : (
                  <Plus className="size-4 shrink-0" strokeWidth={1.75} />
                )}
                <span className="min-w-0 truncate">
                  {t("Create worktree ")}
                  {createName}
                </span>
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
    <span
      title={label}
      aria-label={label}
      className="flex shrink-0 items-center gap-1 text-(length:--ui-font-caption) tabular-nums text-(--ui-text-secondary)"
    >
      {stats.busy ? <span className="size-1.5 animate-pulse rounded-full bg-accent" /> : null}
      {stats.tabs}
    </span>
  );
}
