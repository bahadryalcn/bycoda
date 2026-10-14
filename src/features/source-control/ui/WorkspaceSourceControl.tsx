import { useEffect, useState } from "react";
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
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [savedLabels, setSavedLabels] = useState(loadTabGroupLabels);
  useEffect(() => subscribeProjectPathsChanged(() => setSavedLabels(loadTabGroupLabels())), []);
  const active = selected === cwd || paths.includes(selected) ? selected : "";
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
        <span className="text-xs text-content/65">
          {checkouts ? t("Working copy") : t("Repository")}
        </span>
        <div className="min-w-0 flex-1">
          <SearchableSelect
            label={checkouts ? t("Working copy") : t("Repository")}
            value={active}
            onChange={setSelected}
            variant="transparent"
            options={[
              { value: "", label: checkouts ? t("All checkouts") : t("All repositories") },
              ...paths.map((path) => ({ value: path, label: name(path), keywords: path })),
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
          selectedPath={projectKey(active) === projectKey(cwd) ? selectedPath : undefined}
          selectedKind={projectKey(active) === projectKey(cwd) ? selectedKind : undefined}
          selectedSha={projectKey(active) === projectKey(cwd) ? selectedSha : undefined}
          {...callbacks(active)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {paths.map((path) => (
            <GitChangesPanel
              key={path}
              cwd={path}
              enabled={enabled}
              textHarness={textHarness}
              selectedPath={projectKey(path) === projectKey(cwd) ? selectedPath : undefined}
              selectedKind={projectKey(path) === projectKey(cwd) ? selectedKind : undefined}
              selectedSha={projectKey(path) === projectKey(cwd) ? selectedSha : undefined}
              embedded
              repository={{
                name: name(path),
                checkout: worktrees[path],
                current: checkouts && projectKey(path) === projectKey(cwd),
                expanded: expanded[path] ?? (checkouts && projectKey(path) === projectKey(cwd)),
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
