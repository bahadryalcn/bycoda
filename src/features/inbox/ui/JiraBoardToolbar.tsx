import { Button } from "../../../shared/ui/Button";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { SearchInput, SearchInputGroup } from "../../../shared/ui/SearchInput";
import { TabStrip } from "../../../shared/ui/Tabs";
import { RefreshCw, Search } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import type { JiraBoard, JiraSprint } from "../model/jiraBoard";
import type { ReactNode } from "react";

type Props = {
  boards: readonly JiraBoard[];
  boardId: number;
  sprints: readonly JiraSprint[];
  mode: "kanban" | "planning";
  scope: string;
  search: string;
  filterTrigger?: ReactNode;
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
          options={props.boards.map((board) => ({
            value: String(board.id),
            label: board.name,
            description: board.kind,
          }))}
          placeholder={t("Select allowed boards in Settings → Inbox → Jira")}
          disabled={props.locked || props.boards.length === 0}
          value={
            props.boards.some((board) => board.id === props.boardId) ? String(props.boardId) : ""
          }
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
      <div className="flex min-w-44 flex-1 items-center gap-1">
        <SearchInputGroup appearance="field" className="min-w-0 flex-1">
          <Search tone="secondary" className="pointer-events-none icon-xs shrink-0" />
          <SearchInput
            focusOwner="group"
            type="search"
            aria-label={t("Filter issues")}
            placeholder={t("Filter loaded items")}
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </SearchInputGroup>
        {props.filterTrigger}
      </div>
      <Button
        iconOnly
        label={t("Refresh")}
        variant="ghost"
        type="button"
        loading={props.loading}
        disabled={props.refreshDisabled}
        disabledReason={t("Wait for the current action to finish.")}
        onClick={props.onRefresh}
      >
        <RefreshCw className="icon-sm" strokeWidth={1.75} />
      </Button>
    </div>
  );
}
