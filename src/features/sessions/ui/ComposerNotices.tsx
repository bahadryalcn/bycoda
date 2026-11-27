import { useEffect, type ComponentProps, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { errorText } from "../../../shared/lib/errors";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import type { UsageLimit } from "../model/session";
import { ComposerNoticeStack } from "./ComposerNoticeStack";
import { recheckSessionFolderState } from "./recheckSessionFolderState";
import { NoticeActionButton, TranscriptNotice } from "./TranscriptNotice";
import { UsageLimitNotice } from "./UsageLimitNotice";

type ProviderAccountProvider = NonNullable<ComponentProps<typeof UsageLimitNotice>["provider"]>;

export type ComposerFeedback = string | { title: string; detail: string } | null;

type Props = {
  /** Pane-level notices (interrupted turn, provider retry), rendered first. */
  leading?: ReactNode;
  usageLimit?: UsageLimit;
  accountProvider?: ProviderAccountProvider;
  providerAccountId?: string;
  /** Runs a parent-owned mutation only while the composer's parent input is still current. */
  guard: (run: () => void) => void;
  onUsageLimitResume?: () => void;
  usageLimitResumeDisabled?: boolean;
  onUsageLimitResumeAtReset?: (enabled: boolean) => void;
  onUsageLimitDismiss?: () => void;
  onSelectProviderAccount?: (provider: ProviderAccountProvider, accountId: string) => void;
  onSwitchModel?: () => void;
  pasteError?: ComposerFeedback;
  /** Recovery action for the paste error (microphone settings). */
  pasteErrorAction?: ReactNode;
  sessionFolderError: ComposerFeedback;
  sessionFolderMutationBlocked: boolean;
  onSessionFolderRecovered: (message: ComposerFeedback) => void;
};

/** The one stack above the composer card: every composer notice renders here, in stable order. */
export function ComposerNotices({
  leading,
  usageLimit,
  accountProvider,
  providerAccountId,
  guard,
  onUsageLimitResume,
  usageLimitResumeDisabled,
  onUsageLimitResumeAtReset,
  onUsageLimitDismiss,
  onSelectProviderAccount,
  onSwitchModel,
  pasteError,
  pasteErrorAction,
  sessionFolderError,
  sessionFolderMutationBlocked,
  onSessionFolderRecovered,
}: Props) {
  const t = useT();
  const recovered = useStableCallback(onSessionFolderRecovered);
  // Read a blocked write's outcome twice while leaving manual recovery available.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- polls native folder mutation state while the composer is blocked
  useEffect(() => {
    if (!sessionFolderMutationBlocked) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = (delay: number) => {
      timer = setTimeout(() => {
        void recheckSessionFolderState().then(
          (message) => {
            if (cancelled) return;
            if (message === null) recovered(null);
            else if (delay < 2000) check(2000);
          },
          () => {
            if (!cancelled && delay < 2000) check(2000);
          },
        );
      }, delay);
    };
    check(500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionFolderMutationBlocked, recovered]);
  return (
    <ComposerNoticeStack>
      {leading}
      {usageLimit ? (
        <UsageLimitNotice
          limit={usageLimit}
          provider={accountProvider}
          accountId={providerAccountId}
          onResume={onUsageLimitResume ? () => guard(onUsageLimitResume) : undefined}
          resumeDisabled={usageLimitResumeDisabled}
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
      <ComposerErrorNotice feedback={pasteError} action={pasteErrorAction} />
      <ComposerErrorNotice
        feedback={sessionFolderError}
        action={
          sessionFolderMutationBlocked ? (
            <NoticeActionButton
              action={{
                label: t("Check again"),
                onClick: () => {
                  void recheckSessionFolderState()
                    .then(onSessionFolderRecovered)
                    .catch((error: unknown) =>
                      onSessionFolderRecovered({
                        title: t("Could not refresh the session folders."),
                        detail: errorText(error),
                      }),
                    );
                },
              }}
            />
          ) : undefined
        }
      />
    </ComposerNoticeStack>
  );
}

function ComposerErrorNotice({
  feedback,
  action,
}: {
  feedback?: ComposerFeedback;
  action?: ReactNode;
}) {
  if (!feedback) return null;
  if (typeof feedback === "string")
    return <TranscriptNotice kind="error" title={feedback} actions={action} />;
  return (
    <Alert
      tone="danger"
      title={feedback.title}
      extra={
        <>
          <ErrorDetails title={feedback.title} detail={feedback.detail} />
          {action}
        </>
      }
    />
  );
}
