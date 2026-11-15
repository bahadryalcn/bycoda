import type { ComponentProps, ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import type { QueuedMessage, UsageLimit } from "../model/session";
import { ComposerNoticeStack } from "./ComposerNoticeStack";
import { DeliveryProgressNotice } from "./DeliveryProgressNotice";
import { recheckSessionFolderState } from "./recheckSessionFolderState";
import { UsageLimitNotice } from "./UsageLimitNotice";

type ProviderAccountProvider = NonNullable<ComponentProps<typeof UsageLimitNotice>["provider"]>;

type Props = {
  /** Pane-level notices (interrupted turn, provider retry), rendered first. */
  leading?: ReactNode;
  sessionId?: string;
  queuedMessages: QueuedMessage[];
  usageLimit?: UsageLimit;
  accountProvider?: ProviderAccountProvider;
  providerAccountId?: string;
  /** Runs a parent-owned mutation only while the composer's parent input is still current. */
  guard: (run: () => void) => void;
  onUsageLimitResume?: () => void;
  onUsageLimitResumeAtReset?: (enabled: boolean) => void;
  onUsageLimitDismiss?: () => void;
  onSelectProviderAccount?: (provider: ProviderAccountProvider, accountId: string) => void;
  onSwitchModel: () => void;
  pasteError?: string | null;
  /** Recovery action for the paste error (microphone settings). */
  pasteErrorAction?: ReactNode;
  sessionFolderError: string | null;
  sessionFolderMutationBlocked: boolean;
  sessionFolderPending: boolean;
  sessionFolderSaving: boolean;
  onSessionFolderRecovered: (message: string | null) => void;
};

/** The one stack above the composer card: every composer notice renders here, in stable order. */
export function ComposerNotices({
  leading,
  sessionId,
  queuedMessages,
  usageLimit,
  accountProvider,
  providerAccountId,
  guard,
  onUsageLimitResume,
  onUsageLimitResumeAtReset,
  onUsageLimitDismiss,
  onSelectProviderAccount,
  onSwitchModel,
  pasteError,
  pasteErrorAction,
  sessionFolderError,
  sessionFolderMutationBlocked,
  sessionFolderPending,
  sessionFolderSaving,
  onSessionFolderRecovered,
}: Props) {
  const t = useT();
  return (
    <ComposerNoticeStack>
      {leading}
      {usageLimit ? (
        <UsageLimitNotice
          limit={usageLimit}
          provider={accountProvider}
          accountId={providerAccountId}
          onResume={onUsageLimitResume ? () => guard(onUsageLimitResume) : undefined}
          onResumeAtReset={
            onUsageLimitResumeAtReset
              ? (...args) => guard(() => onUsageLimitResumeAtReset(...args))
              : undefined
          }
          onSwitchAccount={
            accountProvider && onSelectProviderAccount
              ? (accountId) => guard(() => onSelectProviderAccount(accountProvider, accountId))
              : undefined
          }
          onSwitchModel={onSwitchModel}
          onDismiss={onUsageLimitDismiss ? () => guard(onUsageLimitDismiss) : undefined}
        />
      ) : null}
      {queuedMessages.length === 0 ? (
        <DeliveryProgressNotice sessionId={sessionId} messages={queuedMessages} />
      ) : null}
      {pasteError ? (
        <Alert tone="danger" extra={pasteErrorAction}>
          {pasteError}
        </Alert>
      ) : null}
      {sessionFolderError ? (
        <Alert
          tone="danger"
          action={
            sessionFolderMutationBlocked
              ? {
                  label: t("Check again"),
                  onClick: () => {
                    void recheckSessionFolderState()
                      .then(onSessionFolderRecovered)
                      .catch((error: unknown) => onSessionFolderRecovered(String(error)));
                  },
                }
              : undefined
          }
        >
          {sessionFolderError}
        </Alert>
      ) : null}
      {sessionFolderPending ? (
        <Alert>{sessionFolderSaving ? t("Saving…") : t("Loading folders…")}</Alert>
      ) : null}
    </ComposerNoticeStack>
  );
}
