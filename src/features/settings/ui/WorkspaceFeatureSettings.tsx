import { t, useLocale } from "../../../shared/i18n";
import { DashboardSquare, Zap, Inbox, StickyNote, Globe } from "../../../shared/ui/icons";
import {
  useWorkspaceFeatures,
  workspaceFeatureSettings,
  type WorkspaceFeatureId,
} from "../model/workspaceFeatures";
import { Row, Toggle } from "./settingsControls";

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
] satisfies { id: WorkspaceFeatureId; label: string; description: string; icon: typeof Globe }[];

export function WorkspaceFeatureSettings() {
  useLocale();
  const features = useWorkspaceFeatures();
  return WORKSPACE_FEATURE_CHOICES.map(({ id, label, description }) => (
    <Row
      key={id}
      id={id === "notes" ? "notes" : `workspace-${id}`}
      label={t(label)}
      description={t(description)}
      scope={
        id === "notes"
          ? t("Controls project notes and note references in the composer.")
          : t(
              "Controls navigation visibility. Hiding this tool does not stop work or change permissions.",
            )
      }
      dependency={!features[id] ? t("Turn this switch on to show this tool again.") : undefined}
    >
      <Toggle label={t(label)} on={features[id]} onChange={workspaceFeatureSettings[id].save} />
    </Row>
  ));
}
