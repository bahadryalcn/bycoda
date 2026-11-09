import { t } from "../../../../shared/i18n";
import { DEFAULT_SOCIAL_POLICIES } from "../../model/socialPolicy";
import type { SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { ActivityHistory } from "./ActivityHistory";
import { AiModelSettings } from "./AiModelSettings";
import { CharacterLimits } from "./CharacterLimits";
import { InboxSettings } from "./InboxSettings";
import { SendingSettings } from "./SendingSettings";
import "./accounts.css";

export type GeneralSettingsProps = {
  client: SocialClient;
  snapshot: SocialSnapshot;
  hostOnline: boolean;
  projectId?: string;
  onChanged(): void;
};

/** Settings that apply to every account, then the activity log of what was sent and what AI did. */
export function GeneralSettings({
  client,
  snapshot,
  hostOnline,
  projectId,
  onChanged,
}: GeneralSettingsProps) {
  const policies = snapshot.policies ?? DEFAULT_SOCIAL_POLICIES;
  return (
    <section className="settings-topics" aria-label={t("Settings")}>
      <SendingSettings
        client={client}
        snapshot={snapshot}
        hostOnline={hostOnline}
        onChanged={onChanged}
      />
      <InboxSettings client={client} enabled={snapshot.pollingEnabled} onChanged={onChanged} />
      <AiModelSettings client={client} policies={policies} onChanged={onChanged} />
      <CharacterLimits client={client} policies={policies} onChanged={onChanged} />
      <ActivityHistory client={client} accounts={snapshot.accounts} projectId={projectId} />
    </section>
  );
}
