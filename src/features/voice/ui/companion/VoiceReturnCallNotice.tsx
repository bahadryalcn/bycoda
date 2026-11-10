import { Button } from "../../../../shared/ui/Button";
import { LiveText } from "../../../../shared/ui/LiveText";
import { t } from "../../../../shared/i18n";
import styles from "./VoiceCompanionParts.module.css";

/** A missed return call: what happened, with a way to start talking now. */
export function VoiceReturnCallNotice({ notice, onTalk }: { notice: string; onTalk: () => void }) {
  return (
    <>
      <LiveText className={styles.caption} text={notice} />
      {notice ? <Button onClick={onTalk}>{t("Talk now")}</Button> : null}
    </>
  );
}
