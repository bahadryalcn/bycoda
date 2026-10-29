import type { AutomationTriggerKind } from "./automations";
import { t } from "../../../shared/i18n";

export const TRIGGER_CATEGORIES: readonly {
  value: AutomationTriggerKind;
  label: string;
}[] = [
  {
    value: "tasks",
    get label() {
      return t("Tasks");
    },
  },
  {
    value: "social",
    get label() {
      return t("Social Media");
    },
  },
  {
    value: "time",
    get label() {
      return t("Scheduled");
    },
  },
  {
    value: "github",
    get label() {
      return t("GitHub");
    },
  },
  {
    value: "linear",
    get label() {
      return t("Linear");
    },
  },
  {
    value: "jira",
    get label() {
      return t("Jira");
    },
  },
  {
    value: "gitlab",
    get label() {
      return t("GitLab");
    },
  },
  {
    value: "azuredevops",
    get label() {
      return t("Azure DevOps");
    },
  },
];

export type TriggerEvent = {
  value: string;
  label: string;
};

export const TRIGGER_EVENTS: Record<AutomationTriggerKind, readonly TriggerEvent[]> = {
  tasks: [
    {
      value: "task_created",
      get label() {
        return t("Task created");
      },
    },
    {
      value: "task_completed",
      get label() {
        return t("Task completed");
      },
    },
    {
      value: "task_blocked",
      get label() {
        return t("Task blocked");
      },
    },
    {
      value: "task_review",
      get label() {
        return t("Task ready for review");
      },
    },
  ],
  social: [
    {
      value: "message_received",
      get label() {
        return t("Message received");
      },
    },
    {
      value: "comment_received",
      get label() {
        return t("Comment received");
      },
    },
  ],
  time: [
    {
      value: "hourly",
      get label() {
        return t("Hourly");
      },
    },
    {
      value: "daily",
      get label() {
        return t("Daily");
      },
    },
    {
      value: "weekdays",
      get label() {
        return t("Weekdays");
      },
    },
    {
      value: "weekly",
      get label() {
        return t("Weekly");
      },
    },
  ],
  github: [
    {
      value: "draft_opened",
      get label() {
        return t("Draft opened");
      },
    },
    {
      value: "pull_request_opened",
      get label() {
        return t("Pull request opened");
      },
    },
    {
      value: "pull_request_ready_for_review",
      get label() {
        return t("Pull request ready for review");
      },
    },
    {
      value: "pull_request_reopened",
      get label() {
        return t("Pull request reopened");
      },
    },
    {
      value: "pull_request_merged",
      get label() {
        return t("Pull request merged");
      },
    },
    {
      value: "pull_request_closed",
      get label() {
        return t("Pull request closed");
      },
    },
    {
      value: "pull_request_labeled",
      get label() {
        return t("Pull request labeled");
      },
    },
    {
      value: "issue_opened",
      get label() {
        return t("Issue opened");
      },
    },
    {
      value: "issue_reopened",
      get label() {
        return t("Issue reopened");
      },
    },
    {
      value: "issue_closed",
      get label() {
        return t("Issue closed");
      },
    },
    {
      value: "issue_labeled",
      get label() {
        return t("Issue labeled");
      },
    },
  ],
  linear: [
    {
      value: "issue_created",
      get label() {
        return t("Issue created");
      },
    },
  ],
  jira: [
    {
      value: "issue_created",
      get label() {
        return t("Issue appeared");
      },
    },
  ],
  gitlab: [
    {
      value: "merge_request_opened",
      get label() {
        return t("Merge request opened");
      },
    },
    {
      value: "issue_opened",
      get label() {
        return t("Issue opened");
      },
    },
  ],
  azuredevops: [
    {
      value: "pull_request_appeared",
      get label() {
        return t("Pull request appeared");
      },
    },
    {
      value: "work_item_appeared",
      get label() {
        return t("Work item appeared");
      },
    },
  ],
};

export function triggerName(kind: AutomationTriggerKind): string {
  return TRIGGER_CATEGORIES.find((option) => option.value === kind)?.label ?? kind;
}

export function findTriggerEvent(
  kind: AutomationTriggerKind,
  value: string,
): TriggerEvent | undefined {
  return TRIGGER_EVENTS[kind].find((event) => event.value === value);
}
