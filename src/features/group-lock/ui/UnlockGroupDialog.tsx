import { t, useLocale } from "../../../shared/i18n";
import { unlockGroup } from "../model/groupLock";
import { PasswordPromptDialog } from "./PasswordPromptDialog";

type Props = {
  groupId: string;
  name: string;
  onClose: () => void;
};

/** Opens a locked group. A correct password unlocks and expands it. */
export function UnlockGroupDialog({ groupId, name, onClose }: Props) {
  useLocale();
  return (
    <PasswordPromptDialog
      title={t("Unlock {p0}", { p0: name })}
      description={t("Enter the lock password to open this group.")}
      submitLabel="Unlock"
      verify={(password) => unlockGroup(groupId, password)}
      onDone={onClose}
      onClose={onClose}
    />
  );
}
