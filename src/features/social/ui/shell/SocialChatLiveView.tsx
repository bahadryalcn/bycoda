import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../shared/ui/InlineError";
import { presentRemoteError } from "../../../connections/public/remoteFailure";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { Sheet } from "../../../../shared/ui/Sheet";
import { Eye } from "../../../../shared/ui/icons";
import type { SocialClient } from "../../model/socialClient";
import { PlatformIcon } from "../common/PlatformIcon";
import { LiveBrowserPanel } from "../browser/LiveBrowserPanel";

/** Account-bound live view. Reading a frame or entering input uses the existing Host gates. */
export function SocialChatLiveView({
  client,
  machineId,
  projectId,
}: {
  client: SocialClient;
  machineId: string;
  projectId?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string>();
  const accounts = useQuery({
    queryKey: ["social", machineId, "chat-live-accounts", projectId],
    enabled: open,
    retry: false,
    queryFn: async () => {
      const result = await client.sectionSnapshot({
        section: "accounts",
        ...(projectId ? { projectId } : {}),
      });
      if (!result.snapshot) throw new Error(t("Could not read the accounts. Try again."));
      return result.snapshot.accounts.filter((account) => account.connection === "browser");
    },
  });
  // One browser account needs no list step: its panel opens directly, and closing it closes the sheet.
  const only = accounts.data?.length === 1 ? accounts.data[0] : undefined;
  const shownId = accountId ?? only?.id;
  const closeSheet = () => {
    setOpen(false);
    setAccountId(undefined);
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        startIcon={<Eye className="icon-sm" aria-hidden />}
        onClick={() => setOpen(true)}
      >
        {t("Open live view")}
      </Button>
      {open ? (
        <Sheet title={t("Live browser view")} onClose={closeSheet}>
          {shownId ? (
            <LiveBrowserPanel
              client={client}
              accountId={shownId}
              onClose={only ? closeSheet : () => setAccountId(undefined)}
            />
          ) : (
            <div className="social-live-list">
              {accounts.isPending ? <LoadingText delay={false} /> : null}
              {accounts.isError ? (
                <InlineError
                  details={presentRemoteError(accounts.error, { explicit: true })}
                  retry={{
                    label: t("Try again"),
                    onRetry: () => {
                      void accounts.refetch().catch(() => undefined);
                    },
                  }}
                >
                  {t("Could not read the accounts. Try again.")}
                </InlineError>
              ) : null}
              {accounts.data?.length === 0 ? (
                <EmptyState
                  size="inline"
                  kind="empty"
                  description={t("Live view is available for browser accounts.")}
                />
              ) : null}
              {accounts.data?.map((account) => (
                <Button
                  key={account.id}
                  variant="item"
                  startIcon={<PlatformIcon platform={account.platform} />}
                  onClick={() => setAccountId(account.id)}
                >
                  {account.name}
                </Button>
              ))}
            </div>
          )}
        </Sheet>
      ) : null}
    </>
  );
}
