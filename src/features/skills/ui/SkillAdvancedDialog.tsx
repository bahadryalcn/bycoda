import { Modal } from "../../../shared/ui/Modal";
import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import styles from "./SkillsPage.module.css";

export function SkillAdvancedDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t("Advanced: skill controls and folders")} size="md" onClose={onClose}>
      <Text
        as="p"
        size="secondary"
        leading="relaxed"
        id="setting-skill-folders"
        data-setting-id="skill-folders"
        tabIndex={-1}
        className={styles.message}
      >
        {t(
          "Disabled skills stay on disk. {p0} blocks their names across all sources on the selected machine, including search, reads and explicit invocations. Project skills live in {p1}, personal skills in {p2}; harness folders are also included.",
          {
            p0: PRODUCT_IDENTITY.displayName,
            p1: ".agents/skills",
            p2: "~/.agents/skills",
          },
        )}
      </Text>
      <Text as="p" size="secondary" leading="relaxed" className={styles.message}>
        {t(
          "Changes apply to subsequent turns. Running turns and previously loaded context cannot be erased. Enabling in bycoda does not override provider restrictions.",
        )}
      </Text>
      <Text as="p" size="secondary" leading="relaxed" className={styles.message}>
        {t(
          "Native skill controls: Codex, Claude, OpenCode, Pi and OMP. Cursor, Grok, FX, Hermes, Antigravity and generic ACP receive current restrictions as instructions; their native skill loading cannot be controlled individually through the connected protocol.",
        )}
      </Text>
    </Modal>
  );
}
