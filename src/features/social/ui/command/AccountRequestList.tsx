import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { InlineError } from "../../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import type { AccountRequestMode, SocialAccountRequest } from "../../model/accountRequests";
import type { SocialBrowserWorkflow } from "../../model/socialBrowser";
import { SOCIAL_PLATFORM_NAMES } from "../../model/social";
import { SignupAccountDialog } from "../accounts/SignupAccountDialog";
import { registrationProfile } from "../accounts/signupModel";
import { useAccountWrite } from "../accounts/useAccountWrite";
import { PlatformMark } from "../common/PlatformIcon";
import type { SocialScreenProps } from "../shell/screens";
import "./account-requests.css";

/** Pending requests are refreshed on this interval while the screen is active. */
const POLL_MS = 15_000;

export type AccountRequestListProps = Pick<SocialScreenProps, "client" | "onNavigate"> & {
  /** False while the screen is retained but hidden: polling pauses. */
  active?: boolean;
  /** Reports how many requests wait, so the host screen can add them to its header count. */
  onCountChange?: (count: number) => void;
};

/**
 * Accounts a project's work needs and does not have, asked for by the AI. The owner creates the
 * account (the existing signup window), connects one they already have (the existing browser
 * sign-in), or dismisses the request. Nothing happens on a platform before the owner chooses.
 */
export function AccountRequestList({
  client,
  active = true,
  onCountChange,
  onNavigate,
}: AccountRequestListProps) {
  const [items, setItems] = useState<SocialAccountRequest[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [signup, setSignup] = useState<{
    request: SocialAccountRequest;
    accountId: string;
    workflow?: SocialBrowserWorkflow;
  }>();
  const [signinFailed, setSigninFailed] = useState<string>();
  const { error, is, write } = useAccountWrite(t("The request could not be updated. Try again."));

  const count = items.length;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reports the waiting count to the screen header after each read.
  useEffect(() => {
    onCountChange?.(count);
  }, [count, onCountChange]);

  const refresh = useCallback(async () => {
    try {
      const result = await client.accountRequests.list();
      setItems(result.items.filter((item) => item.status === "pending"));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [client]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Polls the Host's pending account requests only while the screen is active.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    void tick().catch(() => setLoadFailed(true));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, refresh]);

  const approve = (request: SocialAccountRequest, mode: AccountRequestMode) =>
    write(`${mode}:${request.id}`, async () => {
      const result = await client.accountRequests.approve({ id: request.id, mode });
      await refresh();
      // LinkedIn Pages require a Page target. Reconnect keeps the account's configured driver.
      if (
        request.platform === "linkedin" &&
        mode === "signin" &&
        (request.requestedAccountId || request.accountType === "organization")
      ) {
        onNavigate("accounts", { accountId: result.accountId });
        return;
      }
      if (mode === "create") {
        // The owner already chose to create the account, so its window opens now; if that fails the
        // dialog still offers to open it.
        const workflow = await client
          .browserWorkflowBegin(
            result.accountId,
            "signup",
            undefined,
            registrationProfile(result.request.accountType, {}),
          )
          .catch(() => undefined);
        setSignup({ request: result.request, accountId: result.accountId, workflow });
        return;
      }
      // The request is now approved and leaves this list, so a failed window start keeps a way to its
      // account (where sign-in can be retried) instead of only an error.
      const opened = await client.browserBegin(result.accountId).then(
        () => true,
        () => false,
      );
      if (!opened) {
        setSigninFailed(result.accountId);
        return;
      }
      onNavigate("accounts", { accountId: result.accountId });
    }).catch(() => undefined);

  const dismiss = (request: SocialAccountRequest) =>
    write(`dismiss:${request.id}`, async () => {
      await client.accountRequests.dismiss(request.id);
      await refresh();
    }).catch(() => undefined);

  const busy = items.some(
    (item) => is(`create:${item.id}`) || is(`signin:${item.id}`) || is(`dismiss:${item.id}`),
  );

  return (
    <>
      {loadFailed ? (
        <InlineError retry={{ onRetry: () => void refresh(), label: t("Try again") }}>
          {t("Account requests could not be loaded.")}
        </InlineError>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {signinFailed ? (
        <InlineError
          retry={{
            onRetry: () => {
              setSigninFailed(undefined);
              onNavigate("accounts", { accountId: signinFailed });
            },
            label: t("Open account"),
          }}
        >
          {t("The sign-in window could not be opened.")}
        </InlineError>
      ) : null}
      {items.length ? (
        <ul className="account-request-list">
          {items.map((item, index) => (
            <li
              key={item.id}
              {...surfaceAttributes(
                index ? { frame: "pane", edge: "block-start" } : {},
                "account-request-row",
              )}
            >
              <div className="account-request-head">
                <PlatformMark platform={item.platform} size="md" />
                <div className="account-request-text">
                  <Text size="body" tone="primary" leading="inherit" weight="medium">
                    {t("{p0} account", { p0: SOCIAL_PLATFORM_NAMES[item.platform] })}
                  </Text>
                  {item.projectName ? (
                    <Text size="caption" tone="muted" leading="inherit">
                      {item.projectName}
                    </Text>
                  ) : null}
                </div>
                {item.suggestedName || item.suggestedUsername ? (
                  <InfoPopover label={t("Suggested name")}>
                    <Text as="p">
                      {[item.suggestedName, item.suggestedUsername && `@${item.suggestedUsername}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </InfoPopover>
                ) : null}
              </div>
              <Text
                as="p"
                size="caption"
                tone="secondary"
                leading="snug"
                className="account-request-reason"
              >
                {item.reason}
              </Text>
              <div className="account-request-actions">
                {item.requestedAccountId ? null : (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={is(`create:${item.id}`)}
                    disabled={busy}
                    onClick={() => void approve(item, "create")}
                  >
                    {t("Create account")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={item.requestedAccountId ? "primary" : "secondary"}
                  loading={is(`signin:${item.id}`)}
                  disabled={busy}
                  onClick={() => void approve(item, "signin")}
                >
                  {item.requestedAccountId ? t("Reconnect") : t("I already have one")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={is(`dismiss:${item.id}`)}
                  disabled={busy}
                  onClick={() => void dismiss(item)}
                >
                  {t("Dismiss")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {signup ? (
        <SignupAccountDialog
          client={client}
          platform={signup.request.platform}
          accountType={signup.request.accountType}
          initialName=""
          projectIds={[signup.request.projectId]}
          existingAccountId={signup.accountId}
          initialWorkflow={signup.workflow}
          onClose={() => setSignup(undefined)}
          onCreated={(accountId) => {
            setSignup(undefined);
            onNavigate("accounts", { accountId });
          }}
        />
      ) : null}
    </>
  );
}
