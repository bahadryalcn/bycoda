import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { DashboardSquare, Zap, Inbox, StickyNote, Globe } from "../../../shared/ui/icons";
import {
  useWorkspaceFeatures,
  workspaceFeatureSettings,
  type WorkspaceFeatureId,
} from "../model/workspaceFeatures";
import { Row, SettingsFeedback, Toggle } from "../../../shared/ui/settings";

/** The workspace tools a user can show or hide, translated for the current language. */
export function workspaceFeatureChoices() {
  return [
    {
      id: "tasks",
      label: t("Tasks"),
      description: t("Plan work and follow your agents' progress."),
      icon: DashboardSquare,
    },
    {
      id: "automations",
      label: t("Automations"),
      description: t("Run recurring work on your schedule."),
      icon: Zap,
    },
    {
      id: "inbox",
      label: t("Inbox"),
      description: t("Bring issues and pull requests into your workspace."),
      icon: Inbox,
    },
    {
      id: "notes",
      label: t("Notes"),
      description: t("Keep project notes and reusable context close by."),
      icon: StickyNote,
    },
    {
      id: "social",
      label: t("Social Media"),
      description: t("Manage social accounts, drafts and conversations."),
      icon: Globe,
    },
  ] satisfies {
    id: WorkspaceFeatureId;
    label: string;
    description: string;
    icon: typeof Globe;
  }[];
}

export function WorkspaceToolsHelp() {
  useLocale();
  return (
    <InfoPopover label={t("About workspace tools")} width={340}>
      <p>
        {t(
          "Controls navigation visibility. Hiding this tool does not stop work or change permissions.",
        )}
      </p>
    </InfoPopover>
  );
}

export function WorkspaceFeatureSettings() {
  useLocale();
  const features = useWorkspaceFeatures();
  const [errors, setErrors] = useState<Partial<Record<WorkspaceFeatureId, boolean>>>({});
  return workspaceFeatureChoices().map(({ id, label }) => (
    <Row
      key={id}
      id={id === "notes" ? "notes" : `workspace-${id}`}
      label={label}
      feedback={
        errors[id] ? (
          <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback>
        ) : undefined
      }
    >
      <Toggle
        label={label}
        on={features[id]}
        onChange={(next) => {
          const setting = workspaceFeatureSettings[id];
          setting.save(next);
          setErrors((current) => ({ ...current, [id]: setting.load() !== next }));
        }}
      />
    </Row>
  ));
}
