import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ChevronDown } from "../../../shared/ui/icons";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Text } from "../../../shared/ui/Text";
import {
  AUTOMATION_TEMPLATE_CATEGORIES,
  AUTOMATION_TEMPLATES,
  type AutomationTemplate,
} from "../model/automationTemplates";

/** Searchable list of examples by category. Picking one fills the draft's instructions and trigger. */
export function AutomationTemplateMenu({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (template: AutomationTemplate) => void;
}) {
  useLocale();
  const options = AUTOMATION_TEMPLATE_CATEGORIES.flatMap((category) =>
    AUTOMATION_TEMPLATES.filter((template) => template.category === category.id).map(
      (template) => ({
        value: template.id,
        label: t(template.name),
        description: t(template.description),
        group: t(category.label),
      }),
    ),
  );
  return (
    <SearchableSelect
      hideLabel
      label={t("Template")}
      value=""
      disabled={disabled}
      options={options}
      searchPlaceholder={t("Search templates")}
      side="top"
      align="start"
      menuMinWidth={320}
      onChange={(id) => {
        const template = AUTOMATION_TEMPLATES.find((entry) => entry.id === id);
        if (template) onPick(template);
      }}
      renderTrigger={({ props }) => (
        <Button
          {...props}
          variant="ghost"
          className="min-w-0 max-w-full"
          endIcon={<ChevronDown className="icon-xs" aria-hidden />}
        >
          <Text truncate size="inherit" tone="inherit">
            {t("Template")}
          </Text>
        </Button>
      )}
    />
  );
}
