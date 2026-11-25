import { HARNESS_TITLE } from "../../../shared/model/harnessIdentity";
import { HarnessIcon } from "../../../shared/ui/identity/HarnessIcon";
import { t } from "../../../shared/i18n";
import { Text } from "../../../shared/ui/Text";

function knownProvider(provider: string): provider is keyof typeof HARNESS_TITLE {
  return Object.prototype.hasOwnProperty.call(HARNESS_TITLE, provider);
}

/** Keep provider identities canonical without changing model or project names. */
export function usageProviderLabel(provider: string): string {
  return knownProvider(provider) ? HARNESS_TITLE[provider] : provider;
}

/** Labels the usage model emits as English constants; real folder and account names pass through. */
export function usageLabel(label: string): string {
  switch (label) {
    case "Unknown folder":
      return t("Unknown folder");
    case "Not in a group":
      return t("Not in a group");
    case "Other":
      return t("Other");
    case "Default account":
      return t("Default account");
    default:
      return label;
  }
}

export function UsageProviderIdentity({ provider, label }: { provider: string; label?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {knownProvider(provider) && <HarnessIcon harness={provider} size="sm" className="shrink-0" />}
      <Text
        size="inherit"
        tone="inherit"
        truncate={label !== ""}
        className={label === "" ? "sr-only" : undefined}
      >
        {label || usageProviderLabel(provider)}
      </Text>
    </span>
  );
}
