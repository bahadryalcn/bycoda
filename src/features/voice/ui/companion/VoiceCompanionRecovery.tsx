import { Button } from "../../../../shared/ui/Button";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LiveText } from "../../../../shared/ui/LiveText";
import { t } from "../../../../shared/i18n";
import { MicrophoneRecoveryAction } from "../MicrophoneRecoveryAction";
import { VoiceReturnCallNotice } from "./VoiceReturnCallNotice";
import styles from "./VoiceCompanionParts.module.css";

/** Recovery actions under the transcript: retry saves, history, briefings, rules, missed calls. */
export function VoiceCompanionRecovery({
  error,
  shownError,
  historyNotice,
  ruleNotice,
  returnNotice,
  briefing,
  rulePending,
  savingRule,
  onSaveConversation,
  onRetryHistory,
  onSaveRule,
  onTalkNow,
}: {
  error: string;
  shownError: string;
  historyNotice: string;
  ruleNotice: string;
  returnNotice: string;
  briefing: { retryable: boolean; canRetry: boolean; retry: () => void };
  rulePending: boolean;
  savingRule: boolean;
  onSaveConversation: () => void;
  onRetryHistory: () => void;
  onSaveRule: () => void;
  onTalkNow: () => void;
}) {
  const notSaved = t("Conversation was not saved. Retry.");
  const historyFailed = t("Conversation history could not be loaded.");
  return (
    <>
      {error === notSaved || historyNotice === notSaved ? (
        <Button onClick={onSaveConversation}>{t("Save conversation")}</Button>
      ) : historyNotice === historyFailed ? (
        <InlineError live="polite" retry={{ onRetry: onRetryHistory }}>
          {historyNotice}
        </InlineError>
      ) : null}
      <VoiceReturnCallNotice notice={returnNotice} onTalk={onTalkNow} />
      {briefing.retryable && (
        <Button disabled={!briefing.canRetry} onClick={briefing.retry}>
          {t("Retry briefing")}
        </Button>
      )}
      {shownError ? <MicrophoneRecoveryAction message={shownError} /> : null}
      <LiveText
        className={styles.caption}
        size="caption"
        tone="secondary"
        leading="snug"
        text={historyNotice !== shownError && historyNotice !== historyFailed ? historyNotice : ""}
      />
      <LiveText
        className={styles.caption}
        size="caption"
        tone="secondary"
        leading="snug"
        text={ruleNotice}
      />
      {rulePending && (
        <Button loading={savingRule} onClick={onSaveRule}>
          {t("Retry rule save")}
        </Button>
      )}
    </>
  );
}
