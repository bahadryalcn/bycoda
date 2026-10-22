import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import {
  DashboardSquare,
  Zap,
  Inbox,
  StickyNote,
  Globe,
  CircleHelp,
} from "../../../shared/ui/icons";
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
] satisfies {
  id: WorkspaceFeatureId;
  label: string;
  description: string;
  icon: typeof Globe;
}[];

export function WorkspaceToolsHelp() {
  useLocale();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        iconOnly
        label={t("About workspace tools")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <CircleHelp size={16} />
      </Button>
      {open ? (
        <Popover
          anchor={anchor}
          role="dialog"
          aria-label={t("About workspace tools")}
          align="end"
          width={340}
          autoFocus
          onDismiss={() => setOpen(false)}
          className="workspace-tools-help"
        >
          <p>
            {t(
              "Controls navigation visibility. Hiding this tool does not stop work or change permissions.",
            )}
          </p>
          <dl>
            {WORKSPACE_FEATURE_CHOICES.map(({ id, label, description }) => (
              <div key={id}>
                <dt>{t(label)}</dt>
                <dd>{t(description)}</dd>
              </div>
            ))}
          </dl>
          <p>{t("Controls project notes and note references in the composer.")}</p>
        </Popover>
      ) : null}
    </>
  );
}

export function WorkspaceFeatureSettings() {
  useLocale();
  const features = useWorkspaceFeatures();
  return WORKSPACE_FEATURE_CHOICES.map(({ id, label }) => (
    <Row key={id} id={id === "notes" ? "notes" : `workspace-${id}`} label={t(label)}>
      <Toggle label={t(label)} on={features[id]} onChange={workspaceFeatureSettings[id].save} />
    </Row>
  ));
}
