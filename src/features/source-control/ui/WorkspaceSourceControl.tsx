import { useEffect, useId, useState } from "react";
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

export function WorkspaceSourceControl({
  cwd,
  paths,
  enabled,
  textHarness,
  onOpen,
  labels = {},
}: {
  cwd: string;
  paths: readonly string[];
  enabled: boolean;
  textHarness?: HarnessId;
  labels?: Readonly<Record<string, string>>;
  onOpen: (request: RepositoryReviewRequest) => void;
}) {
  useLocale();
  const id = useId();
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
        <label htmlFor={id} className="text-xs text-content/65">
          {t("Repository")}
        </label>
        <select
          id={id}
          value={active}
          onChange={(event) => setSelected(event.target.value)}
          className="min-w-0 flex-1 rounded border border-stroke bg-background-base px-1 py-1 text-xs text-content focus-visible:outline-2 focus-visible:outline-accent"
        >
          <option value="">{t("All repositories")}</option>
          {paths.map((path) => (
            <option key={path} value={path}>
              {name(path)}
            </option>
          ))}
          <option value={cwd}>
            {name(cwd)} · {t("Workspace")}
          </option>
        </select>
        <button
          type="button"
          disabled={!enabled}
          title={t("Refresh source control")}
          aria-label={t("Refresh source control")}
          onClick={() =>
            (active ? [active] : paths).forEach((path) => notifyGitChanged(path, "checkout"))
          }
          className="grid size-6 shrink-0 place-items-center rounded text-content/60 hover:bg-content/10 active:bg-selection focus-visible:outline-2 focus-visible:outline-accent"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      {active ? (
        <GitChangesPanel
          key={active}
          cwd={active}
          enabled={enabled}
          textHarness={textHarness}
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
