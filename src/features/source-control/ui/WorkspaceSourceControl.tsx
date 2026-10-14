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

export function WorkspaceSourceControl({
  cwd,
  paths,
  enabled,
  textHarness,
  onOpen,
  labels = {},
  worktrees = {},
  checkouts = false,
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
  const active = checkouts
    ? resolveCheckoutSelection(selected, cwd, paths, worktrees)
    : selected === cwd || paths.includes(selected ?? "")
      ? (selected ?? "")
      : "";
  const own = (path: string) => {
    const session = checkouts ? sessionCheckout(cwd, paths) : undefined;
    return session
      ? projectKey(path) === projectKey(session)
      : projectKey(path) === projectKey(cwd);
  };
  const name = (path: string) =>
    labels[path] || resolveTabGroupLabel(projectKey(path), savedLabels, basename(path));
  const callbacks = (path: string) => ({
    onOpenFile: (file: string, kind: GitFileDiffKind, pin?: boolean) =>
      onOpen({ type: "diff", cwd: path, path: file, kind, pin }),
    onOpenInEditor: (file: string, pin?: boolean) =>
      onOpen({ type: "file", cwd: path, path: file, pin }),
    onOpenAllChanges: (kind: GitFileDiffKind) => onOpen({ type: "diff", cwd: path, kind }),
    onOpenCommit: (commit: GitHistoryCommit, pin?: boolean) =>
      onOpen({ type: "commit", cwd: path, commit, pin }),
  });
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      data-workspace-source-control={cwd}
    >
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
              ...paths.map((path) => ({
                value: path,
                label: name(path),
                keywords: path,
              })),
              ...(!checkouts ? [{ value: cwd, label: `${name(cwd)} · ${t("Workspace")}` }] : []),
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
            (active ? [active] : paths).forEach((path) => notifyGitChanged(path, "checkout"));
          }}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      {active ? (
        <GitChangesPanel
          key={active}
          cwd={active}
          enabled={enabled}
          textHarness={textHarness}
          selectedPath={own(active) ? selectedPath : undefined}
          selectedKind={own(active) ? selectedKind : undefined}
          selectedSha={own(active) ? selectedSha : undefined}
          {...callbacks(active)}
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
          {paths.map((path) => (
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
                expanded: expanded[path] ?? false,
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
