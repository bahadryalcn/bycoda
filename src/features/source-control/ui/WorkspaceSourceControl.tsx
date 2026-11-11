import { useEffect, useId, useRef, useState } from "react";
import {
  checkoutTitle,
  checkoutSelectionScope,
  checkoutRepositoryPaths,
  loadCheckoutSelection,
  resolveCheckoutSelection,
  sessionCheckout,
  saveCheckoutSelection,
} from "../model/checkoutSelection";
import { t, useLocale } from "../../../shared/i18n/git";
import {
  basename,
  notifyGitChanged,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";
import { ChevronDown, ChevronRight, FolderTree, RefreshCw } from "../../../shared/ui/icons";
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
import type { Worktree } from "../model/worktrees";
import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { useGitSubmodules } from "../hooks/useGitSubmodules";
import { requestWorktreeManagement } from "../model/worktreeManagement";
import type { SubmodulePointers } from "../model/submodulePointers";
import { SubmodulePointer } from "./SubmodulePointer";
import styles from "./WorkspaceSourceControl.module.css";

export function WorkspaceSourceControl({
  cwd,
  paths,
  enabled,
  textHarness,
  onOpen,
  labels = {},
  worktrees = {},
  checkouts = false,
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
  labels?: Readonly<Record<string, string>>;
  worktrees?: Readonly<Record<string, Worktree>>;
  checkouts?: boolean;
  /** Preserve the ordinary panel until this repository has initialized submodules. */
  singleRepository?: boolean;
  onRefresh?: () => void;
  selectedPath?: string;
  selectedKind?: GitFileDiffKind;
  selectedSha?: string;
  onOpen: (request: RepositoryReviewRequest) => void;
}) {
  useLocale();
  const scope = checkouts ? checkoutSelectionScope(cwd, paths) : projectKey(cwd);
  // Checkouts: null until the user (or storage) chooses; "" is the explicit "All checkouts".
  const stateKey = `source-control:${checkouts ? "checkouts" : "repositories"}:${scope}`;
  const repositoryListId = useId();
  const [listOpen, setListOpen] = useRetainedState(`${stateKey}:list-open`, true);
  const [selected, setSelected] = useRetainedState<string | null>(`${stateKey}:selected`, () =>
    checkouts ? loadCheckoutSelection(scope) : loadRepositorySelection(scope),
  );
  const choose = (value: string) => {
    setSelected(value);
    setListOpen(true);
    if (checkouts) saveCheckoutSelection(scope, value);
    else saveRepositorySelection(scope, value);
  };
  const [expanded, setExpanded] = useRetainedState<Record<string, boolean>>(
    `${stateKey}:expanded`,
    {},
  );
  const [savedLabels, setSavedLabels] = useState(loadTabGroupLabels);
  useEffect(() => subscribeProjectPathsChanged(() => setSavedLabels(loadTabGroupLabels())), []);
  const discoveryRoots = checkouts ? paths : selected === cwd ? [...paths, cwd] : paths;
  const { modules, error, refresh } = useGitSubmodules(discoveryRoots, enabled, true);
  const repositories = checkoutRepositoryPaths(paths, modules);
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
    selected && paths.some((path) => isEqualOrInside(selected, path) && modules[path] === undefined)
      ? selected
      : "";
  const active = checkouts
    ? resolveCheckoutSelection(selected, cwd, paths, worktrees, modules)
    : selected && projectKey(selected) === projectKey(cwd)
      ? cwd
      : (repositories.find((path) => projectKey(path) === projectKey(selected ?? "")) ??
        pendingSelection);
  // One repository needs no overview row to expand: show its panel, named in the selector.
  const target = active || (repositories.length === 1 && !pendingSelection ? repositories[0] : "");
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
    childNames.get(projectKey(path)) ||
    resolveTabGroupLabel(projectKey(path), savedLabels, basename(path));
  const optionName = (path: string) => labels[path] || name(path);
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
  const showHeader = !plain || !!error;
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
  // Checkout, path and session ownership are stated once, in the target selector
  // (visible label plus this tooltip), instead of a second "Reviewing" row.
  const targetTitle = target
    ? [name(target), !checkouts && own(target) ? t("This session") : "", target]
        .filter(Boolean)
        .join(" · ")
    : `${checkouts ? t("Working copy") : t("Repository")} · ${
        checkouts ? t("All checkouts") : t("All repositories")
      }`;
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      data-workspace-source-control={cwd}
    >
      {showHeader ? (
        <div className="flex shrink-0 items-center gap-1 px-1.5 pt-1 pb-0.5">
          {!checkouts ? (
            <Button
              variant="item"
              motion="none"
              className="w-auto shrink-0 gap-1"
              aria-expanded={listOpen}
              aria-controls={repositoryListId}
              onClick={() => setListOpen((open) => !open)}
            >
              {listOpen ? (
                <ChevronDown className="icon-xs" />
              ) : (
                <ChevronRight className="icon-xs" />
              )}
              {t("Repository")}
            </Button>
          ) : null}
          <div className="min-w-0 flex-1" title={targetTitle}>
            <SearchableSelect
              hideLabel
              label={checkouts ? t("Working copy") : t("Repository")}
              value={target}
              onChange={choose}
              variant="row"
              options={[
                {
                  value: "",
                  label: checkouts ? t("All checkouts") : t("All repositories"),
                },
                ...repositories.map((path) => {
                  const branch = worktrees[path] ? checkoutTitle(worktrees[path]) : undefined;
                  return {
                    value: path,
                    label: optionName(path),
                    keywords: branch ? `${path} ${branch}` : path,
                    // The branch leads the second line; a side column squeezed long paths.
                    description: branch ? `${branch} · ${path}` : path,
                  };
                }),
                ...(pendingSelection &&
                !repositories.some((path) => projectKey(path) === projectKey(pendingSelection))
                  ? [
                      {
                        value: pendingSelection,
                        label: name(pendingSelection),
                        keywords: pendingSelection,
                      },
                    ]
                  : []),
                ...(!checkouts && !repositories.includes(cwd)
                  ? [{ value: cwd, label: `${name(cwd)} · ${t("Workspace")}` }]
                  : []),
              ]}
            />
          </div>
          {checkouts ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              label={t("Manage worktrees…")}
              disabled={!enabled}
              onClick={() => requestWorktreeManagement(target || cwd)}
            >
              <FolderTree aria-hidden className="icon-sm" />
            </Button>
          ) : null}
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
      {error ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 px-2 text-ui-caption text-(--ui-text-secondary)">
          <p role="status" className="min-w-0" title={error}>
            {t("Could not refresh repositories. Refresh source control to retry.")}
          </p>
          <Button variant="link" size="sm" disabled={!enabled} onClick={refreshAll}>
            {t("Retry")}
          </Button>
        </div>
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
            worktreesInTarget={checkouts && showHeader}
            {...callbacks(target || cwd)}
          />
        ) : (
          <>
            <div
              ref={overviewScrollRef}
              className={`min-h-0 flex-1 overflow-y-auto ${styles.overview}`}
              data-checkout-overview={checkouts || undefined}
            >
              {repositories.map((path) => (
                <div
                  key={path}
                  className={childNames.has(projectKey(path)) ? styles.nested : undefined}
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
                    repository={{
                      name: name(path),
                      checkout: worktrees[path],
                      current: checkouts && own(path),
                      pointer: pointerOf(path),
                      expanded: expanded[projectKey(path)] ?? (checkouts ? own(path) : undefined),
                      onToggle: (value) =>
                        setExpanded((current) => ({
                          ...current,
                          [projectKey(path)]: value,
                        })),
                    }}
                    {...callbacks(path)}
                  />
                </div>
              ))}
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
                    { value: "", label: `${t("Auto")} · ${optionName(followed)}` },
                    ...repositories.map((path) => ({
                      value: path,
                      label: optionName(path),
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
