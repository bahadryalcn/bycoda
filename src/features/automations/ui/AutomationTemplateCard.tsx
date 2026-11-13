import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { ClampText } from "../../../shared/ui/ClampText";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  File,
  Gauge,
  GitPullRequest,
  Inbox,
  Lock,
  Search,
  StickyNote,
  Terminal,
} from "../../../shared/ui/icons";
import type { AutomationTemplate, AutomationTemplateIcon } from "../model/automationTemplates";
import { TriggerMark } from "./TriggerEditor";

export function AutomationTemplateCard({
  template,
  onPick,
}: {
  template: AutomationTemplate;
  onPick: (template: AutomationTemplate) => void;
}) {
  const Icon = TEMPLATE_ICONS[template.icon];
  return (
    <Button
      key={template.id}
      type="button"
      onClick={() => onPick(template)}
      variant="item"
      layout="stacked"
      className="automation-template"
      tooltip={t(template.description)}
    >
      <span className="flex gap-3">
        <Text size="inherit" tone="muted" className="grid size-7 shrink-0 place-items-center">
          <Icon className="icon-md" strokeWidth={1.75} />
        </Text>
        <span className="min-w-0 flex-1">
          <ClampText
            as="span"
            lines={2}
            expandable={false}
            size="secondary"
            tone="neutral"
            weight="medium"
          >
            {t(template.name)}
          </ClampText>
          <ClampText
            as="span"
            lines={2}
            expandable={false}
            size="caption"
            tone="muted"
            leading="snug"
            className="mt-1"
          >
            {t(template.description)}
          </ClampText>
        </span>
        <ChevronRight aria-hidden className="icon-sm mt-1 shrink-0" tone="muted" />
      </span>
      <Text
        size="micro"
        tone="muted"
        className="mt-auto flex min-w-0 items-center gap-1.5 ps-10 pt-2"
      >
        <TriggerMark kind={template.trigger.kind} className="icon-xs shrink-0" />
        <Text size="inherit" tone="inherit" truncate className="min-w-0">
          {t(template.triggerLabel)}
        </Text>
      </Text>
    </Button>
  );
}

const TEMPLATE_ICONS: Record<AutomationTemplateIcon, typeof Search> = {
  search: Search,
  alert: AlertCircle,
  file: File,
  check: CheckCircle,
  lock: Lock,
  pr: GitPullRequest,
  inbox: Inbox,
  gauge: Gauge,
  terminal: Terminal,
  note: StickyNote,
};
