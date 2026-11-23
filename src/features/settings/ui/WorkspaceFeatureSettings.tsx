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

export const WORKSPACE_FEATURE_CHOICES = [
  {
    id: "tasks",
    label: "Tasks",
    description: "Plan work and follow your agents' progress.",
    icon: DashboardSquare,
  },
  {
    id: "automations",
    label: "Automations",
    description: "Run recurring work on your schedule.",
    icon: Zap,
  },
  {
    id: "inbox",
    label: "Inbox",
    description: "Bring issues and pull requests into your workspace.",
    icon: Inbox,
  },
  {
    id: "notes",
    label: "Notes",
    description: "Keep project notes and reusable context close by.",
    icon: StickyNote,
  },
  {
    id: "social",
    label: "Social Media",
    description: "Manage social accounts, drafts and conversations.",
    icon: Globe,
  },
] satisfies {
  id: WorkspaceFeatureId;
  label: string;
  description: string;
  icon: typeof Globe;
}[];

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
  return WORKSPACE_FEATURE_CHOICES.map(({ id, label }) => (
    <Row
      key={id}
      id={id === "notes" ? "notes" : `workspace-${id}`}
      label={t(label)}
      feedback={
        errors[id] ? (
          <SettingsFeedback state="error">{t("Could not save changes")}</SettingsFeedback>
        ) : undefined
      }
    >
      <Toggle
        label={t(label)}
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
