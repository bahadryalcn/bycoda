import { t } from "../../../shared/i18n";
import {
  canRetryRoomPrivacyProjection,
  recoverRoomPrivacyProjection,
} from "../model/roomPrivacyProjection";

/** Notice action for a change refused before admission because privacy protection is held.
 * It only settles privacy; the owner repeats the original change afterwards. */
export function roomPrivacyRetryAction(
  onSettled: () => void,
  onFailed: (error: unknown) => void,
): { label: string; onClick: () => void } | undefined {
  if (!canRetryRoomPrivacyProjection()) return undefined;
  return {
    label: t("Retry"),
    onClick: () => void recoverRoomPrivacyProjection().then(onSettled, onFailed),
  };
}
