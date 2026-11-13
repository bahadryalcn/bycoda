import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { TabStrip } from "../../../shared/ui/Tabs";
import { RefreshCw } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import type { JiraBoard, JiraSprint } from "../model/jiraBoard";

type Props = {
  boards: readonly JiraBoard[];
  boardId: number;
  sprints: readonly JiraSprint[];
  mode: "kanban" | "planning";
  scope: string;
  search: string;
  locked: boolean;
  loading: boolean;
  refreshDisabled: boolean;
  onBoardChange: (id: number) => void;
  onModeChange: (mode: "kanban" | "planning") => void;
  onScopeChange: (scope: string) => void;
  onSearchChange: (search: string) => void;
  onRefresh: () => void;
};

/** Board selection and view controls share one wrapping toolbar. */
export function JiraBoardToolbar(props: Props) {
  useLocale();
  return (
    <div className="jira-board-band flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
      <div className="min-w-40 max-w-64 flex-1">
        <SearchableSelect
          hideLabel
          label={t("Jira board")}
          options={
            props.boards.length
              ? props.boards.map((board) => ({
                  value: String(board.id),
                  label: board.name,
                  description: board.kind,
                }))
              : [{ value: "0", label: t("Select allowed boards in Settings → Inbox → Jira") }]
          }
          disabled={props.locked}
          value={String(props.boardId)}
          onChange={(value) => props.onBoardChange(Number(value))}
        />
      </div>
      <TabStrip
        label={t("Board view")}
        value={props.mode}
        onValueChange={(value) => props.onModeChange(value as "kanban" | "planning")}
        items={[
          { value: "kanban", label: t("Kanban"), disabled: props.locked },
          { value: "planning", label: t("Backlog & sprints"), disabled: props.locked },
        ]}
      />
      {props.mode === "kanban" ? (
        <div className="min-w-36 max-w-64 flex-1">
          <SearchableSelect
            hideLabel
            label={t("Issue scope")}
            disabled={props.locked}
            value={props.scope}
            options={[
              { value: "board", label: t("All board issues") },
              { value: "backlog", label: t("Backlog") },
              ...props.sprints.map((sprint) => ({
                value: `sprint:${sprint.id}`,
                label: sprint.name,
                description: sprint.state === "active" ? t("Active sprint") : t("Future sprint"),
              })),
            ]}
            onChange={props.onScopeChange}
          />
        </div>
      ) : null}
      <div className="min-w-44 flex-1">
        <SearchInput
          appearance="field"
          fieldSize="sm"
          type="search"
          aria-label={t("Filter issues")}
          placeholder={t("Filter issues")}
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
        />
      </div>
      <Button
        iconOnly
        label={t("Refresh")}
        variant="ghost"
        type="button"
        loading={props.loading}
        disabled={props.refreshDisabled}
        onClick={props.onRefresh}
      >
        <RefreshCw className="icon-sm" strokeWidth={1.75} />
      </Button>
    </div>
  );
}
