import { useState, useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import { projectName } from "../../../shared/lib/paths";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Button } from "../../../shared/ui/Button";
import { useRecents } from "../../projects/public/recents";
import {
  JIRA_DEFAULT_PROJECTS_KEY,
  parseJiraDefaultProjects,
  saveJiraDefaultProject,
  subscribeJiraDefaultProjects,
  type JiraProject,
  type JiraBoard,
} from "../../inbox/public/jiraDefaultProjects";
import { Row, SettingsFeedback } from "./settingsControls";

function snapshot() {
  try {
    return localStorage.getItem(JIRA_DEFAULT_PROJECTS_KEY);
  } catch {
    return "";
  }
}

/** Working-folder defaults do not change Jira visibility or grant agent permissions. */
export function JiraDefaultProjectSettings({
  projects,
  boards,
  disabled,
}: {
  projects: readonly JiraProject[];
  boards: readonly JiraBoard[];
  disabled: boolean;
}) {
  const t = useT();
  const raw = useSyncExternalStore(subscribeJiraDefaultProjects, snapshot, () => null);
  const recents = useRecents();
  const [error, setError] = useState<string | null>(null);
  const [, retry] = useState(0);
  let defaults;
  try {
    defaults = parseJiraDefaultProjects(raw);
  } catch {
    return (
      <SettingsFeedback
        state="error"
        action={<Button onClick={() => retry((n) => n + 1)}>{t("Retry")}</Button>}
      >
        {t("Saved Jira working folders are unavailable.")}
      </SettingsFeedback>
    );
  }
  const fields = [
    {
      scope: "global" as const,
      id: "",
      label: t("Default bycoda project"),
      value: defaults.global ?? "",
      inherit: t("Use current working folder"),
    },
    ...projects.map((project) => ({
      scope: "projects" as const,
      id: project.id,
      label: `${t("Projects")} · ${project.name} (${project.key})`,
      value: defaults.projects[project.id] ?? "",
      inherit: t("Inherit default bycoda project"),
    })),
    ...boards.map((board) => ({
      scope: "boards" as const,
      id: String(board.id),
      label: `${t("Boards")} · ${board.name}`,
      value: defaults.boards[String(board.id)] ?? "",
      inherit: t("Inherit default bycoda project"),
    })),
  ];
  return (
    <Row
      stacked
      label={t("Default bycoda project")}
      info={t(
        "Board defaults override project and global defaults. You can change the working folder for each issue.",
      )}
      persistence={{ mode: "automatic" }}
    >
      <div className="flex flex-col gap-3">
        {fields.map((field) => {
          const paths = [
            ...new Set([
              ...recents.map((project) => project.path),
              ...(field.value ? [field.value] : []),
            ]),
          ];
          return (
            <SearchableSelect
              key={`${field.scope}:${field.id}`}
              label={field.label}
              value={field.value}
              disabled={disabled}
              options={[
                { value: "", label: field.inherit },
                ...paths.map((path) => ({ value: path, label: projectName(path), meta: path })),
              ]}
              onChange={(path) => {
                try {
                  saveJiraDefaultProject(field.scope, field.id, path);
                  setError(null);
                } catch (cause) {
                  setError(String(cause instanceof Error ? cause.message : cause));
                }
              }}
            />
          );
        })}
        {error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null}
      </div>
    </Row>
  );
}
