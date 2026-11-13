import { useState } from "react";
import { t } from "../../../../shared/i18n";
import type {
  AssistantNotificationTarget,
  AssistantProfilePatch,
} from "../../../../shared/model/host-contracts/assistant";
import { Button } from "../../../../shared/ui/Button";
import { InlineError } from "../../../../shared/ui/InlineError";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { Text } from "../../../../shared/ui/Text";
import type { assistantRequest } from "../../model/assistantClient";
import { ProfileRow } from "./SettingsProfileRow";

/** Chooses an existing conversation on the same Host captured by the settings draft. */
export function AssistantTelegramNotifications({
  request,
  environmentId,
  value,
  onChange,
}: {
  request: typeof assistantRequest;
  environmentId?: string;
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
}) {
  const [targets, setTargets] = useState<AssistantNotificationTarget[]>([]);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const key = (target: NonNullable<AssistantProfilePatch["notificationTelegram"]>) =>
    JSON.stringify([target.accountId, target.conversationId]);
  const selected = value.notificationTelegram ? key(value.notificationTelegram) : "";
  async function load() {
    if (pending) return;
    if (!environmentId) {
      setError(t("Selected Host is unavailable."));
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await request({ op: "notifications.targets" }, environmentId);
      if (!result.notificationTargets)
        throw new Error(t("Telegram conversations are unavailable."));
      setTargets(result.notificationTargets);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <ProfileRow
      label={t("Telegram notifications")}
      description={t("Send updates to an allowed conversation. Message permissions still apply.")}
    >
      {(hideLabel) => (
        <div className="grid min-w-0 gap-2">
          <SearchableSelect
            label={t("Telegram notifications")}
            hideLabel={hideLabel}
            value={selected}
            options={[
              { value: "", label: t("Off") },
              ...(selected && !targets.some((target) => key(target) === selected)
                ? [{ value: selected, label: t("Saved Telegram conversation"), disabled: true }]
                : []),
              ...targets.map((target) => ({
                value: key(target),
                label: target.conversationLabel,
                description: target.accountLabel,
              })),
            ]}
            onChange={(next) => {
              const target = targets.find((target) => key(target) === next);
              if (target)
                onChange({
                  notificationTelegram: {
                    accountId: target.accountId,
                    conversationId: target.conversationId,
                  },
                });
              else if (!next) onChange({ notificationTelegram: null });
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={pending}
            onClick={() => void load()}
          >
            {loaded ? t("Refresh conversations") : t("Choose Telegram conversation")}
          </Button>
          {loaded && !targets.length && !error && (
            <Text size="caption" tone="secondary">
              {t("No allowed Telegram conversations.")}
            </Text>
          )}
          {error && <InlineError>{error}</InlineError>}
        </div>
      )}
    </ProfileRow>
  );
}
