import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineError } from "../../../../shared/ui/InlineError";
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
        <Sheet
          title={t("Live browser view")}
          onClose={() => {
            setOpen(false);
            setAccountId(undefined);
          }}
        >
          {accountId ? (
            <LiveBrowserPanel
              client={client}
              accountId={accountId}
              onClose={() => setAccountId(undefined)}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {accounts.isPending ? <LoadingText delay={false} /> : null}
              {accounts.isError ? (
                <InlineError
                  retry={{
                    label: t("Try again"),
                    onRetry: () => {
                      void accounts.refetch().catch(() => undefined);
                    },
                  }}
                >
                  {accounts.error.message}
                </InlineError>
              ) : null}
              {accounts.data?.length === 0 ? (
                <p>{t("Live view is available for browser accounts.")}</p>
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
