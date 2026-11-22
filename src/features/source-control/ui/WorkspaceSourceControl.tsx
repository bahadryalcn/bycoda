import { surfaceAttributes } from "../../../shared/ui/Surface";
import { InlineError } from "../../../shared/ui/InlineError";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { Text } from "../../../shared/ui/Text";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import {
  checkoutSelectionScope,
  checkoutRepositoryPaths,
  dropLegacyCheckoutSelections,
  groupCheckouts,
  sessionCheckout,
} from "../model/checkoutSelection";
import { worktreeRowTitle } from "../model/worktreeRows";
import { t, useLocale } from "../../../shared/i18n/git";
import {
  basename,
  notifyGitChanged,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";
import { RefreshCw } from "../../../shared/ui/icons";
import { GitChangesPanel } from "./GitChangesPanel";
import { GitPanelSections } from "./GitPanelSections";
import { useProjectDiffStats } from "../hooks/useProjectDiffStats";
import type { HarnessId } from "../../sessions";
import type { RepositoryReviewRequest } from "../model/workspaceRepositories";
import { loadTabGroupLabels, resolveTabGroupLabel } from "../../workspace/model/tabGroups";
import { isEqualOrInside, projectKey } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { useRetainedScroll } from "../../../shared/hooks/useRetainedScroll";
import { loadRepositorySelection, saveRepositorySelection } from "../model/repositorySelection";
import { subscribeProjectPathsChanged } from "../../projects/public/recents";
import { worktreeDeletedExternally, type Worktree } from "../model/worktrees";
import { Button } from "../../../shared/ui/Button";
import { SearchableSelect, type SearchableSelectOption } from "../../../shared/ui/SearchableSelect";
import { CollapsedWorktreeRow } from "./WorktreeOverviewRow";
import { useGitSubmodules } from "../hooks/useGitSubmodules";
import type { SubmodulePointers } from "../model/submodulePointers";
import { SubmodulePointer } from "./SubmodulePointer";
import styles from "./WorkspaceSourceControl.module.css";

const same = (a: string, b: string) => projectKey(a) === projectKey(b);

export function WorkspaceSourceControl({
  cwd,
  paths: listedPaths,
  enabled,
  textHarness,
  onOpen,
  worktrees = {},
  checkouts = false,
  focusPath,
  singleRepository = false,
  onRefresh,
  selectedPath,
  selectedKind,
  selectedSha,
}: {
  cwd: string;
  paths: readonly string[];
  enabled: boolean;
  textHarness?: HarnessId;
  worktrees?: Readonly<Record<string, Worktree>>;
  /** Lists worktrees: the header focus shows one, otherwise the collapsible overview. */
  checkouts?: boolean;
  /** The worktree the sidebar header is focused on; none means the All-worktrees overview. */
  focusPath?: string;
  /** Preserve the ordinary panel until this repository has initialized submodules. */
  singleRepository?: boolean;
  onRefresh?: () => void;
  selectedPath?: string;
  selectedKind?: GitFileDiffKind;
  selectedSha?: string;
  onOpen: (request: RepositoryReviewRequest) => void;
}) {
  useLocale();
  useEffect(() => {
    // Reason: one-time cleanup of the retired per-session review-target storage.
    if (checkouts) dropLegacyCheckoutSelections();
  }, [checkouts]);
  // Worktrees deleted from another window, found before the worktree list catches up.
  const [gone, setGone] = useState<readonly string[]>([]);
  const paths = checkouts
    ? listedPaths.filter((path) => !gone.includes(projectKey(path)))
    : listedPaths;
  const scope = checkouts ? checkoutSelectionScope(cwd, listedPaths) : projectKey(cwd);
  const stateKey = `source-control:${checkouts ? "checkouts" : "repositories"}:${scope}`;
  const repositoryListId = useId();
  const [listOpen, setListOpen] = useRetainedState(`${stateKey}:list-open`, true);
  // Repository choice of a multi-folder workspace; worktrees follow the header focus instead.
  const [selected, setSelected] = useRetainedState<string | null>(`${stateKey}:selected`, () =>
    checkouts ? null : loadRepositorySelection(scope),
  );
  const choose = (value: string) => {
    setSelected(value);
    setListOpen(true);
    saveRepositorySelection(scope, value);
  };
  const [expanded, setExpanded] = useRetainedState<Record<string, boolean>>(
    `${stateKey}:expanded`,
    {},
  );
  const [cleanOpen, setCleanOpen] = useRetainedState(`${stateKey}:clean-open`, false);
  const [savedLabels, setSavedLabels] = useState(loadTabGroupLabels);
  useEffect(() => subscribeProjectPathsChanged(() => setSavedLabels(loadTabGroupLabels())), []);

  // A focus on a worktree that left the list (deleted elsewhere) quietly shows the overview.
  const focused = checkouts && focusPath ? paths.find((path) => same(path, focusPath)) : undefined;
  const groups = checkouts
    ? groupCheckouts(
        paths.flatMap((path) => (worktrees[path] ? [worktrees[path]] : [])),
        cwd,
      )
    : undefined;
  // Overview rows open by default for the session's worktree and the project folder.
  const rowOpen = (path: string) =>
    expanded[projectKey(path)] ??
    (focused ? same(path, focused) : !!groups?.primary.some((tree) => same(tree.path, path)));
  // Only an open row reads Git: collapsed worktrees are never scanned for child repositories.
  const discoveryRoots = checkouts
    ? focused
      ? [focused]
      : paths.filter(rowOpen)
    : selected === cwd
      ? [...paths, cwd]
      : paths;
  const { modules, limits, error, refresh } = useGitSubmodules(discoveryRoots, enabled, true);
  const connectionShownCentrally = useConnectionErrorShownCentrally(error);
  const repositories = checkoutRepositoryPaths(checkouts ? discoveryRoots : paths, modules);
  const childNames = new Map(
    Object.entries(modules).flatMap(([parent, children]) =>
      children.map(
        (path) => [projectKey(path), path.slice(parent.replace(/[\\/]+$/, "").length + 1)] as const,
      ),
    ),
  );
  // A saved submodule may precede discovery. Keep its target while its parent
  // is loading instead of briefly rendering every repository.
  const pendingSelection =
    !checkouts &&
    selected &&
    paths.some((path) => isEqualOrInside(selected, path) && modules[path] === undefined)
      ? selected
      : "";
  const active = checkouts
    ? ""
    : selected && projectKey(selected) === projectKey(cwd)
      ? cwd
      : (repositories.find((path) => projectKey(path) === projectKey(selected ?? "")) ??
        pendingSelection);
  // The shown worktree's folder can vanish before the worktree list reports it. True when the
  // folder is confirmed deleted (it then leaves the list and the overview shows).
  const confirmGone = async (path: string) => {
    try {
      const deleted = await worktreeDeletedExternally(path);
      if (deleted && paths.length > 1) setGone((current) => [...current, projectKey(path)]);
      if (deleted) onRefresh?.();
      return deleted;
    } catch {
      return false;
    }
  };
  const checkedWorktree = focused ?? "";
  useEffect(() => {
    // Reason: window focus/visibility is when a deletion in another window becomes visible here.
    if (!checkedWorktree) return;
    const check = () => {
      if (!document.hidden) void confirmGone(checkedWorktree);
    };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- confirmGone only closes over the latest list size and refresh callback.
  }, [checkedWorktree]);
  // One focused worktree without child repositories is the plain single-header panel; one
  // repository in a workspace needs no overview row to expand either.
  const target = checkouts
    ? focused && repositories.length <= 1
      ? focused
      : ""
    : active || (repositories.length === 1 && !pendingSelection ? repositories[0] : "");
  const overviewScrollRef = useRetainedScroll<HTMLDivElement>(`${stateKey}:overview`, {
    ready: enabled && !target,
  });
  // Each parent's gitlink rows, shown on the submodule rows listed below it.
  const [pointers, setPointers] = useState<Record<string, SubmodulePointers>>({});
  const submodulesOf = (parent: string) => {
    const children = repositories.filter(
      (path) => path !== parent && isEqualOrInside(path, parent),
    );
    if (children.length === 0) return undefined;
    return {
      paths: children.map((path) => path.slice(parent.replace(/[\\/]+$/, "").length + 1)),
      onPointers: (value: SubmodulePointers) =>
        setPointers((current) =>
          current[parent]?.files === value.files ||
          (!current[parent]?.files.length && !value.files.length)
            ? current
            : { ...current, [parent]: value },
        ),
    };
  };
  const pointerOf = (path: string) => {
    for (const [parent, entry] of Object.entries(pointers)) {
      const file = entry.files.find((item) => projectKey(item.path) === projectKey(path));
      if (file)
        return (
          <SubmodulePointer
            parent={name(parent)}
            file={file}
            onOpen={() =>
              onOpen({
                type: "diff",
                cwd: parent,
                path: file.relative,
                kind: file.unstaged ? "unstaged" : "staged",
              })
            }
            onAct={(action) => entry.act(file, action)}
          />
        );
    }
    return undefined;
  };
  const own = (path: string) => {
    const session = checkouts ? sessionCheckout(cwd, paths) : undefined;
    return session
      ? projectKey(path) === projectKey(session)
      : projectKey(path) === projectKey(cwd);
  };
  const name = (path: string) =>
    (worktrees[path] ? worktreeRowTitle(worktrees[path]) : undefined) ||
    childNames.get(projectKey(path)) ||
    resolveTabGroupLabel(projectKey(path), savedLabels, basename(path));
  const callbacks = (path: string) => ({
    onOpenFile: (file: string, kind: GitFileDiffKind, pin?: boolean) =>
      onOpen({ type: "diff", cwd: path, path: file, kind, pin }),
    onOpenInEditor: (file: string, pin?: boolean) =>
      onOpen({ type: "file", cwd: path, path: file, pin }),
    onOpenAllChanges: (kind: GitFileDiffKind) => onOpen({ type: "diff", cwd: path, kind }),
    onOpenCommit: (commit: GitHistoryCommit, pin?: boolean) =>
      onOpen({ type: "commit", cwd: path, commit, pin }),
  });
  const refreshAll = () => {
    onRefresh?.();
    refresh();
    (target ? [target, ...(modules[target] ?? [])] : repositories).forEach((path) =>
      notifyGitChanged(path, "checkout"),
    );
  };
  const plain = singleRepository && repositories.length === 1 && !pendingSelection;
  // Worktrees have no header of their own: the sidebar header chooses the worktree and each
  // panel carries its refresh. A workspace of repositories keeps its repository selector.
  const showHeader = !checkouts && (!plain || !!error);
  // The overview shows Stashes and Graph once, below every repository row. They follow
  // the repository last used in the list until the user picks one in their selector.
  const overview = !target && !plain;
  const [sectionsChoice, setSectionsChoice] = useRetainedState(`${stateKey}:sections`, "");
  const [lastUsed, setLastUsed] = useRetainedState(`${stateKey}:last-used`, "");
  const listed = (path: string) =>
    path ? repositories.find((item) => projectKey(item) === projectKey(path)) : undefined;
  const followed = listed(lastUsed) ?? repositories.find(own) ?? repositories[0] ?? "";
  const sectionsChosen = listed(sectionsChoice);
  const sectionsCwd = sectionsChosen ?? followed;
  const sectionsStats = useProjectDiffStats(sectionsCwd, enabled && overview);
  const listRef = useRef<HTMLDivElement>(null);
  const targetTitle = target
    ? [name(target), target].join(" · ")
    : `${t("Repository")} · ${t("All repositories")}`;
  const targetOptions: SearchableSelectOption[] = [
    { value: "", label: t("All repositories") },
    ...repositories.map((path) => ({
      value: path,
      label: name(path),
      keywords: path,
      description: path,
    })),
    ...(pendingSelection &&
    !repositories.some((path) => projectKey(path) === projectKey(pendingSelection))
      ? [{ value: pendingSelection, label: name(pendingSelection), keywords: pendingSelection }]
      : []),
    ...(!repositories.includes(cwd)
      ? [{ value: cwd, label: `${name(cwd)} · ${t("Workspace")}` }]
      : []),
  ];
  const childrenOf = (path: string) =>
    repositories.filter(
      (child) =>
        !same(child, path) &&
        isEqualOrInside(child, path) &&
        !paths.some((other) => same(other, child)),
    );
  const renderRepository = (path: string) => (
    <div
      key={path}
      {...surfaceAttributes(
        { separator: "block" },
        childNames.has(projectKey(path)) ? styles.nested : undefined,
      )}
      onPointerDownCapture={() => setLastUsed(path)}
      onFocusCapture={() => setLastUsed(path)}
    >
      <GitChangesPanel
        cwd={path}
        submodules={submodulesOf(path)}
        enabled={enabled}
        textHarness={textHarness}
        selectedPath={own(path) ? selectedPath : undefined}
        selectedKind={own(path) ? selectedKind : undefined}
        selectedSha={own(path) ? selectedSha : undefined}
        checkout={
          worktrees[path]
            ? { onRefresh: refreshAll, onMissing: () => confirmGone(path) }
            : undefined
        }
        repository={{
          name: name(path),
          checkout: worktrees[path],
          current: checkouts && own(path),
          pointer: pointerOf(path),
          expanded: expanded[projectKey(path)] ?? (checkouts ? rowOpen(path) : undefined),
          onToggle: (value) =>
            setExpanded((current) => ({
              ...current,
              [projectKey(path)]: value,
            })),
        }}
        {...callbacks(path)}
      />
    </div>
  );
  // A collapsed worktree is a plain row; opening it mounts its own changes panel (and, below
  // it, the child repositories found for that worktree).
  const renderWorktree = (tree: Worktree) =>
    rowOpen(tree.path) ? (
      <Fragment key={tree.path}>
        {[tree.path, ...childrenOf(tree.path)].map(renderRepository)}
      </Fragment>
    ) : (
      <div key={tree.path} {...surfaceAttributes({ separator: "block" })}>
        <CollapsedWorktreeRow
          tree={tree}
          current={own(tree.path)}
          onExpand={() => setExpanded((current) => ({ ...current, [projectKey(tree.path)]: true }))}
        />
      </div>
    );
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      data-workspace-source-control={cwd}
    >
      {showHeader ? (
        <div className="flex shrink-0 items-center gap-1 px-1.5 pt-1 pb-0.5">
          <Button
            variant="item"
            motion="none"
            className="w-auto shrink-0 gap-1"
            expanded={listOpen}
            chevron="start"
            aria-controls={repositoryListId}
            onClick={() => setListOpen((open) => !open)}
          >
            {t("Repository")}
          </Button>
          <Tooltip label={targetTitle} asChild>
            <div className="min-w-0 flex-1">
              <SearchableSelect
                hideLabel
                label={t("Repository")}
                value={target}
                onChange={choose}
                variant="row"
                options={targetOptions}
              />
            </div>
          </Tooltip>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Refresh source control")}
            disabled={!enabled}
            onClick={refreshAll}
          >
            <RefreshCw className="icon-sm" />
          </Button>
        </div>
      ) : null}
      {error && !connectionShownCentrally ? (
        <Text
          as="div"
          size="caption"
          tone="secondary"
          className="flex shrink-0 flex-wrap items-center gap-x-2 px-2"
        >
          <Tooltip label={error} asChild>
            <InlineError className="min-w-0">
              {t("Could not refresh repositories. Refresh source control to retry.")}
            </InlineError>
          </Tooltip>
          <Button variant="link" size="sm" disabled={!enabled} onClick={refreshAll}>
            {t("Retry")}
          </Button>
        </Text>
      ) : null}
      {Object.keys(limits).length > 0 ? (
        <Text as="div" size="caption" tone="secondary" className="shrink-0 px-2">
          <Tooltip
            label={t("The scan reached a size limit, so repositories beyond it are not listed.")}
            asChild
          >
            <span>{t("Repositories found: {p0} (scan limited)", { p0: repositories.length })}</span>
          </Tooltip>
        </Text>
      ) : null}
      <div
        id={repositoryListId}
        ref={listRef}
        className={!plain && !checkouts && !listOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"}
      >
        {target || plain ? (
          <GitChangesPanel
            key={target || cwd}
            cwd={target || cwd}
            enabled={enabled}
            textHarness={textHarness}
            selectedPath={own(target || cwd) ? selectedPath : undefined}
            selectedKind={own(target || cwd) ? selectedKind : undefined}
            selectedSha={own(target || cwd) ? selectedSha : undefined}
            refreshInTarget={showHeader}
            checkout={
              checkouts
                ? { onRefresh: refreshAll, onMissing: () => confirmGone(target) }
                : undefined
            }
            {...callbacks(target || cwd)}
          />
        ) : (
          <>
            <div
              ref={overviewScrollRef}
              className={`min-h-0 flex-1 overflow-y-auto ${styles.overview}`}
              data-checkout-overview={checkouts || undefined}
            >
              {checkouts && groups && !focused ? (
                <>
                  {[...groups.primary, ...groups.active].map(renderWorktree)}
                  {groups.idle.length > 0 ? (
                    <>
                      <div {...surfaceAttributes({ separator: "block" })}>
                        <Button
                          variant="item"
                          motion="none"
                          size="sm"
                          className="w-auto gap-1"
                          expanded={cleanOpen}
                          chevron="start"
                          onClick={() => setCleanOpen((open) => !open)}
                        >
                          {t("Clean · {p0}", { p0: groups.idle.length })}
                        </Button>
                      </div>
                      {cleanOpen ? groups.idle.map(renderWorktree) : null}
                    </>
                  ) : null}
                </>
              ) : (
                repositories.map(renderRepository)
              )}
            </div>
            {sectionsCwd ? (
              <GitPanelSections
                cwd={sectionsCwd}
                enabled={enabled}
                hasChanges={(sectionsStats?.files ?? 0) > 0}
                selectedSha={own(sectionsCwd) ? selectedSha : undefined}
                onOpenCommit={callbacks(sectionsCwd).onOpenCommit}
                paneRef={listRef}
                repositories={{
                  value: sectionsChosen ?? "",
                  onChange: setSectionsChoice,
                  options: [
                    { value: "", label: `${t("Auto")} · ${name(followed)}` },
                    ...repositories.map((path) => ({
                      value: path,
                      label: name(path),
                      description: path,
                    })),
                  ],
                }}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
