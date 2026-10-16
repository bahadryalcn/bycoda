import { useEffect, useState } from "react";
import { CheckoutList } from "./CheckoutList";
import {
  checkoutSelectionScope,
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
import { RefreshCw } from "../../../shared/ui/icons";
import { GitChangesPanel } from "./GitChangesPanel";
import type { HarnessId } from "../../sessions/model/session";
import type { RepositoryReviewRequest } from "../model/workspaceRepositories";
import { loadTabGroupLabels, resolveTabGroupLabel } from "../../workspace/model/tabGroups";
import { projectKey } from "../../../shared/lib/paths";
import { subscribeProjectPathsChanged } from "../../projects/model/recents";
import type { Worktree } from "../model/worktrees";
import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { useGitSubmodules } from "../hooks/useGitSubmodules";

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
  const scope = checkoutSelectionScope(cwd, paths);
  // Checkouts: null until the user (or storage) chooses; "" is the explicit "All checkouts".
  const [selected, setSelected] = useState<string | null>(() =>
    checkouts ? loadCheckoutSelection(scope) : "",
  );
  const choose = (value: string) => {
    setSelected(value);
    if (checkouts) saveCheckoutSelection(scope, value);
  };
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [savedLabels, setSavedLabels] = useState(loadTabGroupLabels);
  useEffect(() => subscribeProjectPathsChanged(() => setSavedLabels(loadTabGroupLabels())), []);
  const checkout = checkouts ? resolveCheckoutSelection(selected, cwd, paths, worktrees) : "";
  const discoveryRoots = checkouts
    ? checkout
      ? [checkout]
      : []
    : selected === cwd
      ? [...paths, cwd]
      : paths;
  const { modules, error, refresh } = useGitSubmodules(discoveryRoots, enabled);
  const seen = new Set<string>();
  const repositories = paths
    .flatMap((path) => [path, ...(modules[path] ?? [])])
    .filter((path) => {
      const key = projectKey(path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const submoduleNames = new Map(
    Object.entries(modules).flatMap(([parent, children]) =>
      children.map(
        (path) =>
          [
            projectKey(path),
            `${t("Submodule")} · ${path.slice(parent.replace(/[\\/]+$/, "").length + 1)}`,
          ] as const,
      ),
    ),
  );
  const active = checkouts
    ? checkout
    : selected === cwd || repositories.includes(selected ?? "")
      ? (selected ?? "")
      : "";
  const own = (path: string) => {
    const session = checkouts ? sessionCheckout(cwd, paths) : undefined;
    return session
      ? projectKey(path) === projectKey(session)
      : projectKey(path) === projectKey(cwd);
  };
  const name = (path: string) =>
    submoduleNames.get(projectKey(path)) ||
    labels[path] ||
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
  const plain = singleRepository && repositories.length === 1;
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      data-workspace-source-control={cwd}
    >
      {!plain || error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-stroke px-2 py-1.5">
          {!checkouts ? <span className="text-xs text-content/65">{t("Repository")}</span> : null}
          <div
            className="min-w-0 flex-1"
            title={checkouts ? `${t("Working copy")} · ${active || t("All checkouts")}` : undefined}
          >
            <SearchableSelect
              label={checkouts ? t("Working copy") : t("Repository")}
              value={active}
              onChange={choose}
              variant="transparent"
              options={[
                {
                  value: "",
                  label: checkouts ? t("All checkouts") : t("All repositories"),
                },
                ...(checkouts ? paths : repositories).map((path) => ({
                  value: path,
                  label: name(path),
                  keywords: path,
                })),
                ...(!checkouts && !repositories.includes(cwd)
                  ? [{ value: cwd, label: `${name(cwd)} · ${t("Workspace")}` }]
                  : []),
              ]}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Refresh source control")}
            disabled={!enabled}
            title={t("Refresh source control")}
            aria-label={t("Refresh source control")}
            onClick={() => {
              onRefresh?.();
              refresh();
              (active ? [active, ...(modules[active] ?? [])] : repositories).forEach((path) =>
                notifyGitChanged(path, "checkout"),
              );
            }}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      ) : null}
      {error ? (
        <p
          role="status"
          className="shrink-0 px-2 py-1 text-xs text-[var(--ui-text-secondary)]"
          title={error}
        >
          {t("Could not refresh submodules. Refresh source control to retry.")}
        </p>
      ) : null}
      {checkouts && active && modules[active]?.length ? (
        <WorkspaceSourceControl
          key={active}
          cwd={active}
          paths={[active]}
          enabled={enabled}
          textHarness={textHarness}
          selectedPath={own(active) ? selectedPath : undefined}
          selectedKind={own(active) ? selectedKind : undefined}
          selectedSha={own(active) ? selectedSha : undefined}
          onOpen={onOpen}
        />
      ) : active || plain ? (
        <GitChangesPanel
          key={active || cwd}
          cwd={active || cwd}
          enabled={enabled}
          textHarness={textHarness}
          selectedPath={own(active || cwd) ? selectedPath : undefined}
          selectedKind={own(active || cwd) ? selectedKind : undefined}
          selectedSha={own(active || cwd) ? selectedSha : undefined}
          {...callbacks(active || cwd)}
        />
      ) : checkouts ? (
        <CheckoutList
          enabled={enabled}
          cwd={cwd}
          worktrees={paths.flatMap((path) => (worktrees[path] ? [worktrees[path]] : []))}
          onSelect={choose}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {repositories.map((path) => (
            <GitChangesPanel
              key={path}
              cwd={path}
              enabled={enabled}
              textHarness={textHarness}
              selectedPath={own(path) ? selectedPath : undefined}
              selectedKind={own(path) ? selectedKind : undefined}
              selectedSha={own(path) ? selectedSha : undefined}
              embedded
              repository={{
                name: name(path),
                expanded: expanded[path],
                onToggle: (value) => setExpanded((current) => ({ ...current, [path]: value })),
              }}
              {...callbacks(path)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
