import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Switch } from "../../../shared/ui/Switch";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import type { CrewPolicy } from "../model/crew";

/**
 * Permissions for every member of the crew in one place: the access mode (when the Host
 * supports it) and the two grants that govern how members ask for more.
 */
export function CrewAccessRow({
  policy,
  accessSupported,
  onChange,
}: {
  policy: CrewPolicy;
  accessSupported: boolean;
  onChange: (patch: Partial<CrewPolicy>) => void;
}) {
  useLocale();
  return (
    <section
      aria-label={t("Access for every member")}
      className="grid min-w-0 grid-cols-1 items-start gap-3 @min-[44rem]/crew-editor:grid-cols-3"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Text size="body" tone="inherit" weight="medium">
          {t("Access for every member")}
        </Text>
        {accessSupported ? (
          <AccessPicker
            value={policy.runtimeMode ?? "supervised"}
            onChange={(runtimeMode) => onChange({ runtimeMode })}
          />
        ) : null}
      </div>
      <Text as="div" className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0">{t("Coordinator answers permission requests")}</span>
        <Switch
          aria-label={t("Coordinator answers permission requests")}
          checked={policy.delegateApprovals === true}
          onCheckedChange={(value) => onChange({ delegateApprovals: value })}
        />
        <InfoPopover label={t("About coordinator approvals")}>
          <p>
            {t(
              "This is your grant for this crew's work. It is off until you turn it on and never changes by itself.",
            )}
          </p>
          <p>
            {t(
              "Only the current coordinator can answer, and only for the request that is open now.",
            )}
          </p>
        </InfoPopover>
      </Text>
      <Text as="div" className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0">{t("Allow provider sub-agents")}</span>
        <Switch
          aria-label={t("Allow provider sub-agents")}
          checked={policy.allowSubagents}
          onCheckedChange={(value) => onChange({ allowSubagents: value })}
        />
        <InfoPopover label={t("About provider sub-agents")}>
          <p>
            {t(
              "Provider helper agents run inside the member's own session. This is a separate choice from coordinator approvals.",
            )}
          </p>
        </InfoPopover>
      </Text>
    </section>
  );
}
