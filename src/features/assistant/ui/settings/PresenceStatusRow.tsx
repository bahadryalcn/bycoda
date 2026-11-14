import { t } from "../../../../shared/i18n";
import type {
  AssistantProfilePatch,
  AssistantSnapshot,
} from "../../../../shared/model/host-contracts/assistant";
import { Text } from "../../../../shared/ui/Text";
import { Row } from "../../../settings/public/settingsControls";
import { keepAwakeLabel } from "../AssistantKeepAwakeStatus";
import { AssistantPresenceStatus } from "../AssistantPresenceStatus";

/**
 * "Right now" row closing the presence group: the live availability on the control side and what
 * keep-awake is doing (or will do, from the drafted switches) as the row's one muted line.
 */
export function PresenceStatusRow({
  snapshot,
  draft,
}: {
  snapshot: AssistantSnapshot;
  draft: AssistantProfilePatch;
}) {
  const state = snapshot.keepAwake;
  const text = keepAwakeLabel(state, {
    working: draft.keepAwakeWhileWorking ?? false,
    away: draft.keepAwakeWhileAway ?? true,
  });
  return (
    <Row label={t("Right now")} description={state?.error ? `${text} · ${state.error}` : text}>
      <Text as="span" size="caption" tone="inherit" leading="inherit">
        <AssistantPresenceStatus snapshot={snapshot} details />
      </Text>
    </Row>
  );
}
